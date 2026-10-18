import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DevModeState } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { ContainerRuntimePort } from '../ports/container-runtime.port';
import { DomainsService as ProxyService } from '../../../domains/domains.service';

const execAsync = promisify(exec);

export class ToggleDevModeUseCase {
  private readonly devModeFile: string;

  constructor(
    private readonly runtime: ContainerRuntimePort,
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly onInvalidateCache?: () => void
  ) {
    const dataDir =
      process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.devModeFile = path.join(dataDir, 'dev-mode.json');
  }

  resolveDevSubdomain(): string {
    if (process.env.DEV_SUBDOMAIN && process.env.DEV_SUBDOMAIN.trim()) {
      return process.env.DEV_SUBDOMAIN.trim().toLowerCase();
    }
    try {
      const dataDir =
        process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
      const domainsFile = path.join(dataDir, 'domains.json');
      if (fs.existsSync(domainsFile)) {
        const routes = JSON.parse(fs.readFileSync(domainsFile, 'utf-8'));
        if (Array.isArray(routes)) {
          for (const r of routes) {
            const d = String(r?.domain || '')
              .trim()
              .toLowerCase();
            const parts = d.split('.');
            if (parts.length >= 3 && parts[0] !== 'develop') {
              return `develop.${parts.slice(1).join('.')}`;
            }
          }
        }
      }
    } catch {}
    return 'develop.localhost';
  }

  getDevModeState(): DevModeState {
    const fallbackDomain = this.resolveDevSubdomain();
    try {
      if (fs.existsSync(this.devModeFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.devModeFile, 'utf-8'));
        return {
          active: Boolean(parsed.active),
          projectName: parsed.projectName || null,
          branch: parsed.branch || 'develop',
          commitHash: parsed.commitHash || '-',
          commitMessage: parsed.commitMessage || '-',
          domain: parsed.domain || fallbackDomain,
          containerName: parsed.containerName || 'alpanel_dev_app',
          internalTarget: parsed.internalTarget || '',
          activatedAt: parsed.activatedAt || null,
        };
      }
    } catch {}
    return {
      active: false,
      projectName: null,
      branch: 'develop',
      commitHash: '-',
      commitMessage: '-',
      domain: fallbackDomain,
      containerName: 'alpanel_dev_app',
      internalTarget: '',
      activatedAt: null,
    };
  }

  async activateDevMode(
    projectName: string,
    proxyService: ProxyService
  ): Promise<{ success: boolean; output: string; state: DevModeState }> {
    const cleanName = new ProjectNameVO(projectName).value;
    const projectDir = new ProjectNameVO(cleanName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const devDomain = this.resolveDevSubdomain();
    const logs: string[] = [];

    const prevState = this.getDevModeState();
    if (
      prevState.active &&
      prevState.projectName &&
      prevState.projectName.toLowerCase() !== cleanName.toLowerCase()
    ) {
      logs.push(
        `==> Desactivando y eliminando archivos de Modo Desarrollador anterior [${prevState.projectName}]...`
      );
    }

    try {
      await execAsync('docker rm -f alpanel_dev_app 2>/dev/null || true');

      const devRoot = path.join(this.projectsRoot, '.alpanel_dev');
      await execAsync(`rm -rf "${devRoot}" && mkdir -p "${devRoot}"`);
      const devDir = path.join(devRoot, cleanName);

      const remoteRes = await execAsync('git config --get remote.origin.url', {
        cwd: projectDir,
      }).catch(() => ({ stdout: '' }));
      const remoteUrl = remoteRes.stdout.trim();
      if (!remoteUrl) {
        throw new Error(
          `El proyecto ${cleanName} no tiene un repositorio Git remoto configurado.`
        );
      }

      logs.push(
        `==> Creando carpeta temporal aislada (${devDir}) y clonando rama [origin/develop]...`
      );
      await execAsync(`git clone "${projectDir}" "${devDir}"`, {
        timeout: 120000,
      });
      await execAsync(`git remote set-url origin "${remoteUrl}"`, {
        cwd: devDir,
      });
      await execAsync('git fetch origin', { cwd: devDir, timeout: 60000 });
      await execAsync(
        'git checkout -B develop origin/develop && git reset --hard origin/develop',
        { cwd: devDir, timeout: 60000 }
      );

      const logRes = await execAsync('git log -n 1 --pretty=format:"%h|%s"', {
        cwd: devDir,
      }).catch(() => ({ stdout: '-|-' }));
      const [commitHash, ...msgParts] = logRes.stdout.trim().split('|');
      const commitMessage = msgParts.join('|') || '-';
      logs.push(`==> Commit en develop: ${commitHash} — ${commitMessage}`);

      const prodEnvPath = path.join(projectDir, '.env');
      const devEnvPath = path.join(devDir, '.env');
      let envContent = fs.existsSync(prodEnvPath)
        ? fs.readFileSync(prodEnvPath, 'utf-8')
        : '';
      envContent += `\n# Overrides autogenerados por ALpanel Modo Desarrollador\nALLOWED_HOSTS=*\nCSRF_TRUSTED_ORIGINS=https://${devDomain},http://${devDomain}\n`;
      fs.writeFileSync(devEnvPath, envContent, 'utf-8');
      fs.chmodSync(devEnvPath, 0o600);

      if (fs.existsSync(path.join(projectDir, 'docker-compose.yml'))) {
        await execAsync(
          'docker compose up -d db 2>/dev/null || docker compose up -d panel_db 2>/dev/null || true',
          { cwd: projectDir, timeout: 60000 }
        ).catch(() => null);
      }

      const isSelf = ProjectNameVO.isSelfPanel(cleanName, this.panelSelfDir);
      let internalPort = '8000';
      let networkName = isSelf
        ? 'alpanel_proxy_net'
        : `${path.basename(projectDir).toLowerCase()}_default`;

      if (
        fs.existsSync(path.join(devDir, 'package.json')) &&
        !fs.existsSync(path.join(devDir, 'manage.py'))
      ) {
        internalPort = isSelf ? '9000' : '3000';
      }

      const allContainers = await this.runtime.listAllContainers();
      const projectContainers = allContainers.filter((c) => {
        const wDir = c.Labels?.['com.docker.compose.project.working_dir'] || '';
        const cName = (c.Names?.[0] || '').replace(/^\//, '');
        if (cName === 'alpanel_dev_app') return false;
        const wDirBase = path.basename(wDir).toLowerCase();
        return (
          wDirBase === cleanName.toLowerCase() ||
          (isSelf && ProjectNameVO.isSelfPanel(wDirBase, this.panelSelfDir))
        );
      });

      const prodAppContainer = projectContainers.find((c) => {
        const cName = (c.Names?.[0] || '').replace(/^\//, '');
        const role = this.runtime.detectRole(
          c.Labels?.['com.docker.compose.service'] || cName,
          c.Image
        );
        return role === 'backend' || role === 'frontend';
      });
      const prodDbContainer = projectContainers.find((c) => {
        const cName = (c.Names?.[0] || '').replace(/^\//, '');
        const role = this.runtime.detectRole(
          c.Labels?.['com.docker.compose.service'] || cName,
          c.Image
        );
        return role === 'database';
      });

      if (prodAppContainer) {
        const pPort = (prodAppContainer.Ports || []).find(
          (p) => p.PrivatePort
        )?.PrivatePort;
        if (pPort) internalPort = String(pPort);
      }

      const refContainer = prodDbContainer || prodAppContainer;
      if (refContainer) {
        const netKeys = Object.keys(
          refContainer.NetworkSettings?.Networks || {}
        );
        const projectNet =
          netKeys.find((n) => n !== 'alpanel_proxy_net' && n !== 'bridge') ||
          netKeys[0];
        if (projectNet) {
          networkName = projectNet;
        }
      }

      const imageTag = `alpanel_dev_${cleanName.toLowerCase()}:develop`;
      logs.push(`==> Construyendo imagen Docker de pruebas (${imageTag})...`);
      await execAsync(`docker build -t ${imageTag} "${devDir}"`, {
        timeout: 600000,
      });

      logs.push(
        `==> Levantando contenedor aislado [alpanel_dev_app] en red [${networkName}] (puerto ${internalPort})...`
      );
      const isDjango = fs.existsSync(path.join(devDir, 'manage.py'));
      const runCmd = isDjango
        ? `docker run -d --name alpanel_dev_app --restart unless-stopped --network ${networkName} --env-file "${devEnvPath}" -e ALLOWED_HOSTS=* -v "${devDir}:/app" ${imageTag} sh -c "python manage.py migrate --noinput && gunicorn --bind 0.0.0.0:${internalPort} core.wsgi:application"`
        : `docker run -d --name alpanel_dev_app --restart unless-stopped --network ${networkName} --env-file "${devEnvPath}" -v /var/run/docker.sock:/var/run/docker.sock -v "${this.panelSelfDir}:${this.panelSelfDir}" -v "${this.projectsRoot}:${this.projectsRoot}" ${imageTag}`;

      await execAsync(runCmd, { timeout: 120000 });
      if (networkName !== 'alpanel_proxy_net') {
        await execAsync(
          'docker network connect alpanel_proxy_net alpanel_dev_app 2>/dev/null || true'
        ).catch(() => null);
      }

      const internalTarget = `alpanel_dev_app:${internalPort}`;
      logs.push(
        `==> Enrutando https://${devDomain} -> ${internalTarget} en Caddy SSL...`
      );
      await proxyService.saveRoute({
        id: 'route-dev-mode',
        domain: devDomain,
        projectName: `${cleanName} (develop)`,
        frontendTarget: internalTarget,
        apiPathPrefix: '',
        backendTarget: '',
        sslEnabled: true,
      });
      await proxyService.reloadCaddy();

      const newState: DevModeState = {
        active: true,
        projectName: cleanName,
        branch: 'develop',
        commitHash: commitHash || '-',
        commitMessage,
        domain: devDomain,
        containerName: 'alpanel_dev_app',
        internalTarget,
        activatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        this.devModeFile,
        JSON.stringify(newState, null, 2),
        'utf-8'
      );
      this.onInvalidateCache?.();

      logs.push(
        `\n✅ Modo Desarrollador ACTIVO para [${cleanName}] (rama develop) en: https://${devDomain}`
      );
      return { success: true, output: logs.join('\n'), state: newState };
    } catch (error: any) {
      logs.push(
        `\n❌ Error activando Modo Desarrollador: ${
          error?.stderr || error?.message
        }`
      );
      return {
        success: false,
        output: logs.join('\n'),
        state: this.getDevModeState(),
      };
    }
  }

  async deactivateDevMode(
    proxyService: ProxyService
  ): Promise<{ success: boolean; output: string; state: DevModeState }> {
    const prev = this.getDevModeState();
    const logs: string[] = [];
    try {
      logs.push(
        `==> Deteniendo y eliminando contenedor de Modo Desarrollador (alpanel_dev_app)...`
      );
      await execAsync('docker rm -f alpanel_dev_app 2>/dev/null || true');

      const devRoot = path.join(this.projectsRoot, '.alpanel_dev');
      logs.push(
        `==> Eliminando carpeta temporal de archivos develop (${devRoot})...`
      );
      await execAsync(`rm -rf "${devRoot}" 2>/dev/null || true`);

      if (prev.projectName) {
        const imageTag = `alpanel_dev_${prev.projectName.toLowerCase()}:develop`;
        await execAsync(`docker rmi ${imageTag} 2>/dev/null || true`).catch(
          () => null
        );
      }

      logs.push(`==> Desvinculando subdominio ${prev.domain} en Caddy...`);
      await proxyService.deleteRoute('route-dev-mode');
      await proxyService.reloadCaddy();

      const newState: DevModeState = {
        active: false,
        projectName: null,
        branch: 'develop',
        commitHash: '-',
        commitMessage: '-',
        domain: prev.domain || this.resolveDevSubdomain(),
        containerName: 'alpanel_dev_app',
        internalTarget: '',
        activatedAt: null,
      };
      fs.writeFileSync(
        this.devModeFile,
        JSON.stringify(newState, null, 2),
        'utf-8'
      );
      this.onInvalidateCache?.();

      logs.push(
        `✅ Modo Desarrollador apagado y carpeta temporal eliminada correctamente.`
      );
      return { success: true, output: logs.join('\n'), state: newState };
    } catch (error: any) {
      return {
        success: false,
        output:
          error?.stderr ||
          error?.message ||
          'Error al apagar Modo Desarrollador',
        state: this.getDevModeState(),
      };
    }
  }
}
