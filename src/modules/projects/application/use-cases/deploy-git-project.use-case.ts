import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { GitRepoUrlVO } from '../../domain/value-objects/git-repo-url.vo';
import { ContainerRuntimePort } from '../ports/container-runtime.port';
import { GitRepositoryPort } from '../ports/git-repository.port';
import {
  getCleanComposeEnv,
  runDockerComposeSafe,
} from './manage-container-power.use-case';
import { domainsService } from '../../../domains/application/use-cases/manage-domains.use-case';

const execAsync = promisify(exec);

export class DeployGitProjectUseCase {
  constructor(
    private readonly gitAdapter: GitRepositoryPort,
    private readonly runtime: ContainerRuntimePort,
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly onInvalidateCache?: (projectDir?: string) => void
  ) {}

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
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const isSelfPanel = ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir);
    const logs: string[] = [];
    let prevHead = '';

    try {
      const headRes = await execAsync('git rev-parse HEAD', {
        cwd: projectDir,
      }).catch(() => ({ stdout: '' }));
      prevHead = headRes.stdout.trim();

      logs.push(
        `==> Ejecutando git pull origin main en ${projectName} (HEAD actual: ${
          prevHead.slice(0, 7) || 'N/A'
        })...`
      );
      await execAsync('git fetch origin && git checkout main', {
        cwd: projectDir,
        timeout: 30000,
      }).catch(() => null);
      const pullRes = await execAsync('git pull origin main', {
        cwd: projectDir,
        timeout: 60000,
      });
      await execAsync(
        `chmod -R a+rwX "${path.join(projectDir, '.git')}" 2>/dev/null || true`
      ).catch(() => null);
      this.onInvalidateCache?.(projectDir);
      logs.push(pullRes.stdout.trim() || 'Already up to date.');
      if (pullRes.stderr) logs.push(pullRes.stderr.trim());

      logs.push(
        `\n✅ Cambios de GitHub (rama main) descargados exitosamente en ${projectName} (sin reiniciar contenedores; usa "Restart Docker" o "Rebuild" cuando desees aplicar reinicio).`
      );

      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      const errorDetails = [error?.stdout, error?.stderr, error?.message]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join('\n');
      logs.push(`\n❌ Error o conflicto durante git pull: ${errorDetails}`);
      if (prevHead) {
        try {
          logs.push(
            `⏪ Ejecutando Rollback de Git al commit estable ${prevHead.slice(
              0,
              7
            )}...`
          );
          await execAsync(`git reset --hard ${prevHead}`, { cwd: projectDir });
          await execAsync(
            `chmod -R a+rwX "${path.join(
              projectDir,
              '.git'
            )}" 2>/dev/null || true`
          ).catch(() => null);
          this.onInvalidateCache?.(projectDir);
          logs.push(
            `✅ Rollback de Git completado. El repositorio y sus contenedores siguen intactos en la versión estable anterior.`
          );
        } catch {
          logs.push(`⚠️ No se pudo completar el rollback automático de Git.`);
        }
      }
      return { success: false, output: logs.join('\n') };
    }
  }

  async cloneNewProject(payload: {
    name: string;
    repoUrl: string;
    branch?: string;
    envContent?: string;
    autoStart?: boolean;
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

    const logs: string[] = [];
    try {
      const branchArg = safeBranch ? `-b "${safeBranch}"` : '';
      logs.push(`==> Clonando ${safeRepoUrl} en ${targetDir}...`);
      const cloneRes = await execAsync(
        `git clone ${branchArg} "${safeRepoUrl}" "${targetDir}"`,
        { timeout: 180000 }
      );
      await execAsync(
        `chmod -R a+rwX "${path.join(targetDir, '.git')}" 2>/dev/null || true`
      ).catch(() => null);
      this.onInvalidateCache?.();
      if (cloneRes.stdout) logs.push(cloneRes.stdout.trim());
      if (cloneRes.stderr) logs.push(cloneRes.stderr.trim());

      let finalEnvContent = (payload.envContent || '').trim();
      const envExamplePath = path.join(targetDir, '.env.example');
      const envSamplePath = path.join(targetDir, '.env.sample');

      if (!finalEnvContent) {
        if (fs.existsSync(envExamplePath)) {
          finalEnvContent = fs.readFileSync(envExamplePath, 'utf-8').trim();
          logs.push(
            '==> 📋 Se detectó .env.example en el repositorio y se usó como base para .env.'
          );
        } else if (fs.existsSync(envSamplePath)) {
          finalEnvContent = fs.readFileSync(envSamplePath, 'utf-8').trim();
          logs.push(
            '==> 📋 Se detectó .env.sample en el repositorio y se usó como base para .env.'
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
          logs.push(
            '==> 🔑 JWT_SECRET seguro (256-bit hex) generado automáticamente por ALpanel.'
          );
        }

        const envFile = path.join(targetDir, '.env');
        fs.writeFileSync(envFile, finalEnvContent + '\n', 'utf-8');
        fs.chmodSync(envFile, 0o600);
        logs.push('==> Archivo .env creado con permisos restringidos (0600).');
      }

      if (
        payload.autoStart &&
        (fs.existsSync(path.join(targetDir, 'docker-compose.yml')) ||
          fs.existsSync(path.join(targetDir, 'docker-compose.yaml')))
      ) {
        logs.push(
          '==> Construyendo y levantando contenedores Docker (docker compose up -d --build)...'
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
      logs.push(`✅ Proyecto ${cleanName} creado exitosamente.`);
      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      logs.push(`❌ Error: ${error?.stderr || error?.message}`);
      return { success: false, output: logs.join('\n') };
    }
  }
}
