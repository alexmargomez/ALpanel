import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { ContainerRuntimePort } from '../ports/container-runtime.port';

const execAsync = promisify(exec);

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

      const { stdout, stderr } = await execAsync('docker compose restart', {
        cwd: projectDir,
        timeout: 120000,
      });
      return {
        success: true,
        output: `Proyecto ${projectName} reiniciado correctamente.\n${stdout}\n${stderr}`.trim(),
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
      const { stdout, stderr } = await execAsync('docker compose up -d', {
        cwd: projectDir,
        timeout: 180000,
      });
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

      const { stdout, stderr } = await execAsync(
        'docker compose up -d --build --force-recreate',
        {
          cwd: projectDir,
          timeout: 600000,
        }
      );
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
