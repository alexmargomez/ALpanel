import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { ContainerRuntimePort } from '../ports/container-runtime.port';

import { domainsService } from '../../../domains/application/use-cases/manage-domains.use-case';

const execAsync = promisify(exec);

export const PROTECTED_PANEL_CONTAINERS = new Set([
  'alpanel_server',
  'alpanel_db',
  'alpanel_caddy',
  'sm_server_panel',
  'sm_panel_caddy',
  'panel_db',
]);

export function getCleanComposeEnv(projectDir: string): NodeJS.ProcessEnv {
  const cleanProjectName = path
    .basename(projectDir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return {
    PATH:
      process.env.PATH ||
      '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env.HOME || '/root',
    USER: process.env.USER || 'root',
    DOCKER_HOST: process.env.DOCKER_HOST || '',
    COMPOSE_PROJECT_NAME: cleanProjectName || 'app',
  };
}

export function extractComposeContainerNames(projectDir: string): string[] {
  const names = new Set<string>();
  for (const file of ['docker-compose.yml', 'docker-compose.yaml']) {
    const composePath = path.join(projectDir, file);
    if (!fs.existsSync(composePath)) continue;
    try {
      const content = fs.readFileSync(composePath, 'utf-8');
      const regex =
        /^\s*container_name\s*:\s*['"]?([a-zA-Z0-9._-]+)['"]?\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const cName = match[1].trim();
        if (cName && !PROTECTED_PANEL_CONTAINERS.has(cName)) {
          names.add(cName);
        }
      }
    } catch {
      // ignore read errors
    }
  }
  return Array.from(names);
}

async function reconcileProjectComposeContainers(
  projectDir: string,
  expectedComposeProject: string
): Promise<void> {
  const candidateNames = new Set<string>(
    extractComposeContainerNames(projectDir)
  );

  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=com.docker.compose.project.working_dir=${projectDir}" --format "{{.Names}}"`,
      { timeout: 10000 }
    );
    for (const line of stdout.split('\n')) {
      const name = line.trim();
      if (name && !PROTECTED_PANEL_CONTAINERS.has(name)) {
        candidateNames.add(name);
      }
    }
  } catch {
    // ignore
  }

  for (const containerName of candidateNames) {
    // Limpiar contenedores temporales <12-hex>_<nombre> dejados por un --force-recreate interrumpido
    if (/^[0-9a-f]{12}_/i.test(containerName)) {
      await execAsync(`docker rm -f "${containerName}" 2>/dev/null || true`, {
        timeout: 15000,
      }).catch(() => null);
      continue;
    }

    try {
      const { stdout } = await execAsync(
        `docker inspect "${containerName}" --format '{{index .Config.Labels "com.docker.compose.project"}}||{{.Config.Image}}||{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}},{{end}}{{end}}'`,
        { timeout: 10000 }
      );
      const [currentProjectRaw, imageRaw, mountsRaw] = stdout.trim().split('||');
      const currentProject = (currentProjectRaw || '').trim();
      const image = (imageRaw || '').trim();
      const mounts = (mountsRaw || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

      if (currentProject !== expectedComposeProject) {
        await execAsync(`docker stop "${containerName}" 2>/dev/null || true`, {
          timeout: 20000,
        }).catch(() => null);

        if (currentProject && image && mounts.length > 0) {
          for (const volName of mounts) {
            if (volName.startsWith(`${currentProject}_`)) {
              const suffix = volName.slice(currentProject.length + 1);
              const targetVol = `${expectedComposeProject}_${suffix}`;
              if (targetVol !== volName) {
                await execAsync(
                  `docker volume create "${targetVol}" >/dev/null 2>&1 || true`,
                  { timeout: 10000 }
                ).catch(() => null);
                await execAsync(
                  `docker run --rm --entrypoint sh -v "${volName}:/from:ro" -v "${targetVol}:/to" "${image}" -c 'if [ -z "$(ls -A /to 2>/dev/null)" ] && [ -n "$(ls -A /from 2>/dev/null)" ]; then cp -a /from/. /to/; fi' 2>/dev/null || true`,
                  { timeout: 60000 }
                ).catch(() => null);
              }
            }
          }
        }

        await execAsync(`docker rm -f "${containerName}" 2>/dev/null || true`, {
          timeout: 15000,
        }).catch(() => null);
      }
    } catch {
      // Container does not exist yet
    }
  }
}

export async function runDockerComposeSafe(
  projectDir: string,
  composeArgs: string,
  timeout = 180000
): Promise<{ stdout: string; stderr: string }> {
  const env = getCleanComposeEnv(projectDir);
  const expectedProject = env.COMPOSE_PROJECT_NAME || 'app';

  let finalArgs = composeArgs.trim();
  if (finalArgs.startsWith('up') && !finalArgs.includes('--remove-orphans')) {
    finalArgs = `${finalArgs} --remove-orphans`;
  }

  if (finalArgs.startsWith('up')) {
    await reconcileProjectComposeContainers(projectDir, expectedProject);
  }

  try {
    return await execAsync(`docker compose ${finalArgs}`, {
      cwd: projectDir,
      env,
      timeout,
    });
  } catch (error: any) {
    const errText = `${error?.stderr || ''}\n${error?.stdout || ''}\n${
      error?.message || ''
    }`;
    if (errText.includes('is already in use by container')) {
      const toRemove = new Set<string>(extractComposeContainerNames(projectDir));
      const conflictRegex =
        /The container name "\/([^"]+)" is already in use/g;
      let match: RegExpExecArray | null;
      while ((match = conflictRegex.exec(errText)) !== null) {
        const cName = match[1].trim();
        if (cName && !PROTECTED_PANEL_CONTAINERS.has(cName)) {
          toRemove.add(cName);
        }
      }

      for (const cName of toRemove) {
        await execAsync(`docker rm -f "${cName}" 2>/dev/null || true`, {
          timeout: 15000,
        }).catch(() => null);
      }

      return await execAsync(`docker compose ${finalArgs}`, {
        cwd: projectDir,
        env,
        timeout,
      });
    }

    const portMatch = /Bind for 0\.0\.0\.0:(\d+) failed: port is already allocated/.exec(
      errText
    );
    if (portMatch) {
      const busyPort = Number(portMatch[1]);
      if (busyPort >= 5170 && busyPort <= 5199) {
        const { stdout: portsOut } = await execAsync(
          `docker ps --format "{{.Ports}}"`,
          { timeout: 10000 }
        ).catch(() => ({ stdout: '' }));
        let nextPort = 5174;
        while (portsOut.includes(`:${nextPort}->`) && nextPort < 5199) {
          nextPort++;
        }
        env.FRONTEND_PORT = String(nextPort);
        await reconcileProjectComposeContainers(projectDir, expectedProject);
        return await execAsync(`docker compose ${finalArgs}`, {
          cwd: projectDir,
          env,
          timeout,
        });
      }
    }

    throw error;
  }
}

export class ManageContainerPowerUseCase {
  constructor(
    private readonly runtime: ContainerRuntimePort,
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly onInvalidateCache?: (projectDir: string) => void
  ) {}

  async restartProject(
    projectName: string,
    containerName?: string
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const isSelfPanel = ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir);
    this.onInvalidateCache?.(projectDir);

    try {
      if (containerName) {
        const cleanContainer = containerName.replace(/[^a-zA-Z0-9._-]/g, '');
        if (
          cleanContainer === 'alpanel_server' ||
          cleanContainer === 'alpanel_caddy' ||
          cleanContainer === 'sm_server_panel' ||
          cleanContainer === 'sm_panel_caddy'
        ) {
          setTimeout(() => {
            exec(`docker restart ${cleanContainer}`, () => {});
          }, 1500);
          return {
            success: true,
            output: `==> Reinicio programado para [${cleanContainer}]...\n✅ El contenedor se reiniciará en 1.5 segundos tras entregar esta respuesta para no cortar la conexión del navegador.`,
          };
        }
        const { stdout, stderr } = await execAsync(
          `docker restart ${cleanContainer}`,
          { timeout: 60000 }
        );
        return {
          success: true,
          output: `Contenedor ${cleanContainer} reiniciado.\n${stdout}\n${stderr}`.trim(),
        };
      }

      if (isSelfPanel) {
        await this.runtime.ensureAlpanelContainerNames();
        setTimeout(() => {
          exec(
            'docker restart alpanel_server 2>/dev/null || docker restart sm_server_panel',
            () => {}
          );
        }, 1500);
        return {
          success: true,
          output: `==> Reiniciando servicio principal de ALpanel (alpanel_server)...\n✅ Se mantienen activos alpanel_db (MariaDB) y alpanel_caddy (SSL Proxy) sin interrupción.\n🔄 El panel se reconectará automáticamente en 2 segundos.`,
        };
      }

      const { stdout, stderr } = await runDockerComposeSafe(
        projectDir,
        'up -d --force-recreate',
        180000
      );
      await domainsService.reloadCaddy().catch(() => null);
      return {
        success: true,
        output: `Proyecto ${projectName} reiniciado y variables .env sincronizadas correctamente.\n${stdout}\n${stderr}`.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        output:
          error?.stderr || error?.message || 'Error al reiniciar el proyecto',
      };
    }
  }

  async startProject(
    projectName: string
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    this.onInvalidateCache?.(projectDir);
    try {
      const { stdout, stderr } = await runDockerComposeSafe(
        projectDir,
        'up -d',
        180000
      );
      await domainsService.reloadCaddy().catch(() => null);
      return {
        success: true,
        output:
          [stdout, stderr].filter(Boolean).join('\n').trim() ||
          `Proyecto ${projectName} iniciado.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error iniciando proyecto',
      };
    }
  }

  async stopProject(
    projectName: string
  ): Promise<{ success: boolean; output: string }> {
    if (ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir)) {
      return {
        success: false,
        output:
          'Por seguridad no puedes detener ALpanel porque es el servidor principal que administra el panel y el proxy SSL.',
      };
    }
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    this.onInvalidateCache?.(projectDir);
    try {
      const { stdout, stderr } = await execAsync('docker compose stop', {
        cwd: projectDir,
        env: getCleanComposeEnv(projectDir),
        timeout: 120000,
      });
      return {
        success: true,
        output:
          [stdout, stderr].filter(Boolean).join('\n').trim() ||
          `Proyecto ${projectName} detenido.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error deteniendo proyecto',
      };
    }
  }

  async rebuildProject(
    projectName: string
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const isSelfPanel = ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir);
    this.onInvalidateCache?.(projectDir);

    try {
      if (isSelfPanel) {
        const logs: string[] = [];
        logs.push(
          `==> [1/3] Sincronizando código fuente (Frontend Vue 3 + Backend Fastify + Prisma) en /app...`
        );
        await execAsync(
          `rm -rf /app/public/js /app/public/views && cp -rf "${projectDir}/public/"* /app/public/ && cp -rf "${projectDir}/src/"* /app/src/ && (cp -rf "${projectDir}/frontend" /app/ 2>/dev/null || true) && (cp -f "${projectDir}/vite.config.ts" /app/vite.config.ts 2>/dev/null || true) && (cp -f "${projectDir}/tsconfig.frontend.json" /app/tsconfig.frontend.json 2>/dev/null || true) && (cp -f "${projectDir}/tsconfig.json" /app/tsconfig.json 2>/dev/null || true) && (cp -rf "${projectDir}/prisma" /app/ 2>/dev/null || true) && (cp -f "${projectDir}/package.json" /app/package.json 2>/dev/null || true)`,
          { timeout: 30000 }
        );

        logs.push(
          `==> [2/3] Instalando dependencias y reconstruyendo (vite build && prisma generate && tsc)...`
        );
        await this.runtime.ensureAlpanelContainerNames();
        await execAsync('npm install --no-audit --no-fund', {
          cwd: '/app',
          timeout: 180000,
        }).catch(() => null);
        const { stdout, stderr } = await execAsync('npm run build', {
          cwd: '/app',
          timeout: 180000,
        });
        if (stdout) logs.push(stdout.trim());
        if (stderr) logs.push(stderr.trim());

        logs.push(
          `\n==> [3/3] Rebuild completado exitosamente. Reiniciando contenedor alpanel_server de forma atómica en 1.5s...`
        );

        setTimeout(() => {
          exec(
            'docker restart alpanel_server 2>/dev/null || docker restart sm_server_panel',
            () => {}
          );
        }, 1500);

        return {
          success: true,
          output: logs.join('\n'),
        };
      }

      const { stdout, stderr } = await runDockerComposeSafe(
        projectDir,
        'up -d --build --force-recreate',
        600000
      );
      await domainsService.reloadCaddy().catch(() => null);
      return {
        success: true,
        output:
          [stdout, stderr].filter(Boolean).join('\n').trim() ||
          `Rebuild de ${projectName} completado.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output:
          error?.stderr || error?.message || 'Error en rebuild del proyecto',
      };
    }
  }

  async clearProjectCache(
    projectName: string,
    listProjectsFn: () => Promise<ProjectInfo[]>
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const isSelfPanel = ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir);
    const logs: string[] = [];
    try {
      logs.push(`==> Limpiando caché de aplicación en ${projectName}...`);
      if (isSelfPanel) {
        await execAsync('npm cache clean --force 2>/dev/null || true');
        await execAsync(
          `cp -rf "${projectDir}/public/"* /app/public/ 2>/dev/null || true`
        );
        logs.push(
          '==> Caché de npm y archivos estáticos de ALpanel refrescados en memoria.'
        );
        logs.push(
          '✅ Limpieza de caché de ALpanel completada sin interrumpir la conexión.'
        );
        return { success: true, output: logs.join('\n') };
      }

      await execAsync(
        `find "${projectDir}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true`
      );

      const projects = await listProjectsFn();
      const proj = projects.find(
        (p) => p.name.toLowerCase() === projectName.toLowerCase()
      );
      const appContainer = proj?.containers.find(
        (c) => c.role === 'backend' && c.state === 'running'
      );

      if (appContainer) {
        const cName = appContainer.name;
        const { stdout } = await execAsync(
          `docker exec ${cName} sh -c "if [ -f artisan ]; then php artisan optimize:clear; elif [ -f symfony ]; then php symfony cc; elif [ -f manage.py ]; then find . -name '*.pyc' -delete && echo 'Archivos .pyc y __pycache__ de Django eliminados.'; fi" 2>/dev/null || true`
        );
        if (stdout && stdout.trim()) {
          logs.push(stdout.trim());
        }
      }

      logs.push(
        '==> Reiniciando contenedores de aplicación para recargar memoria...'
      );
      const { stdout, stderr } = await execAsync('docker compose restart', {
        cwd: projectDir,
        env: getCleanComposeEnv(projectDir),
        timeout: 120000,
      });
      if (stdout) logs.push(stdout.trim());
      if (stderr) logs.push(stderr.trim());
      logs.push(`✅ Caché limpiada y servicios de ${projectName} recargados.`);

      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      return {
        success: false,
        output:
          error?.stderr ||
          error?.message ||
          'Error limpiando caché del proyecto',
      };
    }
  }

  async getContainerLogs(containerName: string, tail = 150): Promise<string> {
    const clean = containerName.replace(/[^a-zA-Z0-9._-]/g, '');
    try {
      const { stdout } = await execAsync(
        `docker logs --tail ${Number(tail) || 150} ${clean} 2>&1`,
        { timeout: 15000 }
      );
      return stdout.trim() || 'Sin logs recientes.';
    } catch (error: any) {
      return (
        error?.stdout ||
        error?.stderr ||
        error?.message ||
        'No se pudieron obtener los logs.'
      );
    }
  }
}
