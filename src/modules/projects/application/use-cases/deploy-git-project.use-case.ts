import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { GitRepoUrlVO } from '../../domain/value-objects/git-repo-url.vo';
import { InsufficientServerMemoryException } from '../../domain/exceptions/project.exception';
import { ContainerRuntimePort } from '../ports/container-runtime.port';
import { GitRepositoryPort } from '../ports/git-repository.port';
import {
  getCleanComposeEnv,
  runDockerComposeSafe,
} from './manage-container-power.use-case';
import { domainsService } from '../../../domains/application/use-cases/manage-domains.use-case';
import { manageProjectMicroservicesUseCase } from './manage-project-microservices.use-case';
import { resourceGuardService } from '../../../../shared/infrastructure/services/resource-guard.service';
import { taskTelemetryService } from '../../../../shared/infrastructure/services/task-telemetry.service';

const execAsync = promisify(exec);

export class DeployGitProjectUseCase {
  /**
   * Mutex en memoria por proyecto para impedir colisiones en .git/index.lock
   * cuando dos administradores solicitan despliegue simultáneo del mismo proyecto.
   */
  private static readonly activeDeployments = new Set<string>();

  constructor(
    private readonly gitAdapter: GitRepositoryPort,
    private readonly runtime: ContainerRuntimePort,
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly onInvalidateCache?: (projectDir?: string) => void
  ) {}

  private async hardenGitDirPermissions(projectDir: string): Promise<void> {
    const gitDir = path.join(projectDir, '.git');
    const hooksDir = path.join(gitDir, 'hooks');
    await execAsync(
      `chmod -R u+rwX,go+rX "${gitDir}" 2>/dev/null && find "${hooksDir}" -type f -exec chmod a-wx {} + 2>/dev/null || true`
    ).catch(() => null);
  }

  async checkProjectUpdates(projectName: string): Promise<{
    success: boolean;
    behindCount: number;
    output: string;
  }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const res = await this.gitAdapter.checkRemoteUpdates(projectDir);
    this.onInvalidateCache?.(projectDir);
    return res;
  }

  async gitPullAndRestart(
    projectName: string
  ): Promise<{ success: boolean; output: string }> {
    const cleanVo = new ProjectNameVO(projectName);
    const projectDir = cleanVo.resolvePath(this.projectsRoot, this.panelSelfDir);
    const lockKey = cleanVo.value.toLowerCase();

    if (DeployGitProjectUseCase.activeDeployments.has(lockKey)) {
      return {
        success: false,
        output: `⏳ Ya existe una operación de despliegue en curso para '${cleanVo.value}'. Espera a que termine para evitar corrupción en .git/index.lock.`,
      };
    }

    DeployGitProjectUseCase.activeDeployments.add(lockKey);
    const logs: string[] = [];
    let prevHead = '';

    try {
      const headRes = await execAsync('git -c core.hooksPath=/dev/null rev-parse HEAD', {
        cwd: projectDir,
      }).catch(() => ({ stdout: '' }));
      prevHead = headRes.stdout.trim();

      const headMsg = `[Paso 1/2] Verificando estado del repositorio ${projectName} (HEAD actual: ${
        prevHead.slice(0, 7) || 'N/A'
      })...`;
      logs.push(`==> ${headMsg}`);
      taskTelemetryService.emitTaskStep(headMsg, 'git pull');

      await execAsync(
        'git -c core.hooksPath=/dev/null fetch origin && git -c core.hooksPath=/dev/null checkout main',
        {
          cwd: projectDir,
          timeout: 30000,
        }
      ).catch(() => null);

      taskTelemetryService.emitTaskStep(
        `[Paso 2/2] Descargando últimos commits desde origin/main en ${projectName}...`,
        'git pull'
      );
      const pullRes = await resourceGuardService.execWithMemoryWatchdog(
        'git -c core.hooksPath=/dev/null pull --progress origin main',
        {
          cwd: projectDir,
          timeout: 60000,
          operation: 'git pull',
          targetProject: projectName,
        }
      );
      await this.hardenGitDirPermissions(projectDir);
      this.onInvalidateCache?.(projectDir);
      logs.push(pullRes.stdout.trim() || 'Already up to date.');
      if (pullRes.stderr) logs.push(pullRes.stderr.trim());

      const okMsg = `✅ Cambios de GitHub (rama main) descargados exitosamente en ${projectName} (sin reiniciar contenedores; usa "Restart Docker" o "Rebuild" cuando desees aplicar reinicio).`;
      logs.push(`\n${okMsg}`);
      taskTelemetryService.emitTaskStep(okMsg, 'Completado');

      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      const errorDetails = [error?.stdout, error?.stderr, error?.message]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join('\n');
      const errMsg = `❌ Error o conflicto durante git pull: ${errorDetails}`;
      logs.push(`\n${errMsg}`);
      taskTelemetryService.emitTaskLog(errMsg, {
        isError: true,
        phase: 'Error en git pull',
      });
      if (prevHead) {
        try {
          logs.push(
            `⏪ Ejecutando Rollback de Git al commit estable ${prevHead.slice(
              0,
              7
            )}...`
          );
          await execAsync(`git -c core.hooksPath=/dev/null reset --hard ${prevHead}`, {
            cwd: projectDir,
          });
          await this.hardenGitDirPermissions(projectDir);
          this.onInvalidateCache?.(projectDir);
          logs.push(
            `✅ Rollback de Git completado. El repositorio y sus contenedores siguen intactos en la versión estable anterior.`
          );
        } catch {
          logs.push(`⚠️ No se pudo completar el rollback automático de Git.`);
        }
      }
      return { success: false, output: logs.join('\n') };
    } finally {
      DeployGitProjectUseCase.activeDeployments.delete(lockKey);
    }
  }

  async cloneNewProject(payload: {
    name: string;
    repoUrl: string;
    branch?: string;
    envContent?: string;
    autoStart?: boolean;
    selectedMicroservices?: string[];
  }): Promise<{ success: boolean; output: string }> {
    const cleanName = new ProjectNameVO(payload.name).value;
    const targetDir = new ProjectNameVO(cleanName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    if (fs.existsSync(targetDir)) {
      return {
        success: false,
        output: `La carpeta ${targetDir} ya existe en el servidor.`,
      };
    }

    let safeRepoUrl: string;
    let safeBranch: string;
    try {
      safeRepoUrl = new GitRepoUrlVO(payload.repoUrl).value;
      safeBranch = GitRepoUrlVO.sanitizeBranch(payload.branch);
    } catch (err: any) {
      return { success: false, output: err?.message || 'URL de repositorio Git inválida.' };
    }

    const lockKey = cleanName.toLowerCase();
    if (DeployGitProjectUseCase.activeDeployments.has(lockKey)) {
      return {
        success: false,
        output: `⏳ Ya existe una clonación en curso para '${cleanName}'.`,
      };
    }

    const estimatedInitialContainers = Array.isArray(payload.selectedMicroservices)
      ? payload.selectedMicroservices.length + 2
      : 2;

    // 1. Validación preventiva de RAM ANTES de clonar siquiera el repositorio
    resourceGuardService.assertMemoryAvailableForOperation({
      operation: 'clonar y desplegar nuevo proyecto',
      targetProject: cleanName,
      requiresBuild: Boolean(payload.autoStart),
      additionalContainersCount: payload.autoStart ? estimatedInitialContainers : 0,
    });

    DeployGitProjectUseCase.activeDeployments.add(lockKey);
    const logs: string[] = [];
    const pushStep = (msg: string, phase?: string) => {
      logs.push(taskTelemetryService.emitTaskStep(msg, phase));
    };
    let clonedOnDisk = false;
    try {
      const branchArg = safeBranch ? `-b "${safeBranch}"` : '';
      pushStep(`==> [Paso 1] Clonando ${safeRepoUrl} en ${targetDir}...`, 'Clonando repositorio Git');
      const cloneRes = await resourceGuardService.execWithMemoryWatchdog(
        `git -c core.hooksPath=/dev/null clone --progress ${branchArg} "${safeRepoUrl}" "${targetDir}"`,
        {
          timeout: 180000,
          operation: 'git clone --progress',
          targetProject: cleanName,
        }
      );
      clonedOnDisk = true;
      await this.hardenGitDirPermissions(targetDir);
      this.onInvalidateCache?.();
      if (cloneRes.stdout) logs.push(cloneRes.stdout.trim());
      if (cloneRes.stderr) logs.push(cloneRes.stderr.trim());

      let finalEnvContent = (payload.envContent || '').trim();
      const envExamplePath = path.join(targetDir, '.env.example');
      const envSamplePath = path.join(targetDir, '.env.sample');

      if (!finalEnvContent) {
        if (fs.existsSync(envExamplePath)) {
          finalEnvContent = fs.readFileSync(envExamplePath, 'utf-8').trim();
          pushStep(
            '==> 📋 Se detectó .env.example en el repositorio y se usó como base para .env.',
            'Configurando variables .env'
          );
        } else if (fs.existsSync(envSamplePath)) {
          finalEnvContent = fs.readFileSync(envSamplePath, 'utf-8').trim();
          pushStep(
            '==> 📋 Se detectó .env.sample en el repositorio y se usó como base para .env.',
            'Configurando variables .env'
          );
        }
      }

      if (finalEnvContent) {
        finalEnvContent = finalEnvContent.replace(
          /^NODE_ENV\s*=\s*development\s*$/m,
          'NODE_ENV=production'
        );

        const hasJwtSecret = /^JWT_SECRET\s*=\s*(.+)$/m.exec(finalEnvContent);
        if (
          !hasJwtSecret ||
          !hasJwtSecret[1].trim() ||
          ['auto', 'secret', 'changeme', 'secret_key_123'].includes(
            hasJwtSecret[1].trim()
          )
        ) {
          const generatedJwtSecret = crypto.randomBytes(32).toString('hex');
          if (/^JWT_SECRET\s*=.*$/m.test(finalEnvContent)) {
            finalEnvContent = finalEnvContent.replace(
              /^JWT_SECRET\s*=.*$/m,
              `JWT_SECRET=${generatedJwtSecret}`
            );
          } else {
            finalEnvContent += `\nJWT_SECRET=${generatedJwtSecret}`;
          }
          pushStep(
            '==> 🔑 JWT_SECRET seguro (256-bit hex) generado automáticamente por ALpanel.',
            'Generando secretos'
          );
        }

        const envFile = path.join(targetDir, '.env');
        const tmpEnvFile = `${envFile}.${process.pid}.${Date.now()}.tmp`;
        try {
          fs.writeFileSync(tmpEnvFile, finalEnvContent + '\n', {
            encoding: 'utf-8',
            mode: 0o600,
          });
          fs.chmodSync(tmpEnvFile, 0o600);
          fs.renameSync(tmpEnvFile, envFile);
        } catch (err) {
          try {
            if (fs.existsSync(tmpEnvFile)) fs.unlinkSync(tmpEnvFile);
          } catch {
            // Ignore cleanup error
          }
          throw err;
        }
        pushStep(
          '==> [Paso 2] Archivo .env creado atómicamente con permisos restringidos (0600).',
          'Archivo .env listo'
        );
      }

      let activeServicesToStart = 2;
      if (Array.isArray(payload.selectedMicroservices)) {
        const msSummary =
          manageProjectMicroservicesUseCase.saveSelectionToProjectDir(
            targetDir,
            payload.selectedMicroservices
          );
        if (msSummary.isMicroservicesArchitecture) {
          activeServicesToStart =
            msSummary.coreServices.length + msSummary.enabledMicroservicesCount;
          pushStep(
            `==> 🧩 Arquitectura de Microservicios configurada (${
              msSummary.enabledMicroservicesCount
            }/${msSummary.totalMicroservices} integrados): ${
              msSummary.enabledServiceNames.join(', ') || 'Solo Servicios Core'
            }`,
            'Topología de microservicios'
          );
        }
      } else {
        const msSummary =
          manageProjectMicroservicesUseCase.detectMicroservicesInDirectory(
            targetDir,
            []
          );
        if (msSummary.isMicroservicesArchitecture) {
          if (msSummary.totalMicroservices > 5) {
            const essentialKeywords = [
              'facturacion',
              'clientes',
              'inventario',
              'caja',
              'crm',
              'inventory',
              'invoicing',
              'billing',
              'auth',
            ];
            const essentials = msSummary.microservices
              .filter((m) =>
                essentialKeywords.some(
                  (kw) =>
                    m.domainCode.toLowerCase().includes(kw) ||
                    m.serviceName.toLowerCase().includes(kw)
                )
              )
              .map((m) => m.serviceName);
            const fallbackSelection =
              essentials.length > 0
                ? essentials
                : msSummary.microservices.slice(0, 3).map((m) => m.serviceName);
            const savedMs =
              manageProjectMicroservicesUseCase.saveSelectionToProjectDir(
                targetDir,
                fallbackSelection
              );
            activeServicesToStart =
              savedMs.coreServices.length + savedMs.enabledMicroservicesCount;
            pushStep(
              `==> 🛡️ Protección Anti-OOM activada: Clúster grande detectado (${msSummary.totalMicroservices} microservicios). Integrando automáticamente Core + ${savedMs.enabledMicroservicesCount} esenciales (${savedMs.enabledServiceNames.join(', ')}).`,
              'Selección Anti-OOM'
            );
          } else {
            activeServicesToStart =
              msSummary.coreServices.length + msSummary.totalMicroservices;
            pushStep(
              `==> 🧩 Clúster de Microservicios detectado (${msSummary.totalMicroservices} microservicios de dominio + ${msSummary.coreServices.length} servicios core).`,
              'Detección de arquitectura'
            );
          }
        }
      }

      if (
        payload.autoStart &&
        (fs.existsSync(path.join(targetDir, 'docker-compose.yml')) ||
          fs.existsSync(path.join(targetDir, 'docker-compose.yaml')))
      ) {
        resourceGuardService.assertMemoryAvailableForOperation({
          operation: `desplegar ${activeServicesToStart} contenedores`,
          targetProject: cleanName,
          requiresBuild: true,
          additionalContainersCount: activeServicesToStart,
        });

        pushStep(
          `==> [Paso 3] Compilando e iniciando ${activeServicesToStart} contenedores Docker con telemetría top en vivo...`,
          'Docker Compose Build & Up'
        );
        const upRes = await runDockerComposeSafe(
          targetDir,
          'up -d --build',
          600000
        );
        await domainsService.reloadCaddy().catch(() => null);
        if (upRes.stdout) logs.push(upRes.stdout.trim());
        if (upRes.stderr) logs.push(upRes.stderr.trim());
      }

      this.onInvalidateCache?.(targetDir);
      pushStep(`✅ Proyecto ${cleanName} desplegado exitosamente.`, 'Completado');
      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      if (error instanceof InsufficientServerMemoryException) {
        // Si falló por memoria tras clonar, detener cualquier contenedor parcial para liberar la RAM de inmediato
        if (clonedOnDisk && fs.existsSync(targetDir)) {
          await execAsync(`docker compose down --remove-orphans 2>/dev/null || true`, {
            cwd: targetDir,
            env: getCleanComposeEnv(targetDir),
            timeout: 30000,
          }).catch(() => null);
          this.onInvalidateCache?.(targetDir);
        }
        throw error;
      }
      logs.push(`❌ Error: ${error?.stderr || error?.message}`);
      return { success: false, output: logs.join('\n') };
    } finally {
      DeployGitProjectUseCase.activeDeployments.delete(lockKey);
    }
  }
}
