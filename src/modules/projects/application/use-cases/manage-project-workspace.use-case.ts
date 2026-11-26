import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { GitRepoUrlVO } from '../../domain/value-objects/git-repo-url.vo';
import { manageServersUseCase } from '../../../servers/application/use-cases/manage-servers.use-case';
import { remoteExecutorService } from '../../../servers/infrastructure/services/remote-executor.service';
import {
  runDockerComposeSafe,
  upsertEnvFileVariables,
} from './manage-container-power.use-case';
import { taskTelemetryService } from '../../../../shared/infrastructure/services/task-telemetry.service';
import { hostService } from '../../../../shared/infrastructure/services/host-metrics.service';

const execAsync = promisify(exec);

export interface ProjectLinkedUpstream {
  id: string;
  serviceName: string;
  containerName: string;
  serverId: string;
  serverName: string;
  host: string;
  port: string;
  pathPrefix: string;
  envVarName?: string;
  linkedAt: string;
}

export interface ProjectWorkspaceManifest {
  projectName: string;
  description?: string;
  serverId: string;
  serverName: string;
  isolatedNetwork: string;
  linkedUpstreams: ProjectLinkedUpstream[];
  createdAt: string;
}

export interface AddContainerToProjectPayload {
  source: 'git' | 'server' | 'image';
  serviceName: string;
  targetServerId?: string;
  // source === 'git'
  repoUrl?: string;
  branch?: string;
  gitCredentialId?: string;
  // source === 'server'
  sourceServerId?: string;
  sourceContainerName?: string;
  sourcePort?: string;
  linkMode?: 'link' | 'clone';
  pathPrefix?: string;
  syncGatewayEnvVar?: boolean;
  applyFirewallRule?: boolean;
  // source === 'image'
  image?: string;
  internalPort?: string;
  hostPort?: string;
  dockerfileContent?: string;
  envLines?: string;
  autoStart?: boolean;
}

export class ManageProjectWorkspaceUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  private getManifestPath(projectDir: string): string {
    return path.join(projectDir, '.alpanel-project.json');
  }

  readManifest(projectDir: string): ProjectWorkspaceManifest | null {
    const manifestPath = this.getManifestPath(projectDir);
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  writeManifest(projectDir: string, manifest: ProjectWorkspaceManifest): void {
    const manifestPath = this.getManifestPath(projectDir);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async createEmptyWorkspace(payload: {
    projectName: string;
    description?: string;
    serverId?: string;
  }): Promise<{ success: boolean; output: string; manifest: ProjectWorkspaceManifest }> {
    const cleanName = new ProjectNameVO(payload.projectName).value;
    const server = await manageServersUseCase.getStoredServerById(
      payload.serverId || 'local'
    );
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const isolatedNetwork = `alpanel_isolated_${slug}_net`;

    const manifest: ProjectWorkspaceManifest = {
      projectName: cleanName,
      description: (payload.description || '').trim(),
      serverId: server.id,
      serverName: server.name,
      isolatedNetwork,
      linkedUpstreams: [],
      createdAt: new Date().toISOString(),
    };

    const baseCompose = [
      `# Workspace aislado generado por ALpanel — Proyecto: ${cleanName}`,
      `services: {}`,
      ``,
      `networks:`,
      `  ${isolatedNetwork}:`,
      `    name: ${isolatedNetwork}`,
      `    driver: bridge`,
      ``,
    ].join('\n');

    if (server.isLocal) {
      const targetDir = path.join(this.projectsRoot, cleanName);
      if (fs.existsSync(targetDir)) {
        throw new Error(`Ya existe un proyecto llamado "${cleanName}" en este servidor.`);
      }
      fs.mkdirSync(path.join(targetDir, 'services'), { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'docker-compose.yml'), baseCompose, 'utf-8');
      fs.writeFileSync(
        path.join(targetDir, '.env'),
        `COMPOSE_PROJECT_NAME=${slug}\nPROJECT_SERVER_ID=${server.id}\n`,
        { encoding: 'utf-8', mode: 0o600 }
      );
      this.writeManifest(targetDir, manifest);
      await execAsync(`docker network create "${isolatedNetwork}" 2>/dev/null || true`).catch(
        () => null
      );

      return {
        success: true,
        output: `✅ Proyecto aislado "${cleanName}" creado en ${server.name} (${targetDir}) con red privada ${isolatedNetwork}. Ya puedes agregar contenedores, repositorios o módulos desde Administrar.`,
        manifest,
      };
    }

    // Creación en servidor remoto vía SSH
    const remoteDir = `${(server.projectsRoot || '/opt/projects').replace(/\/+$/, '')}/${cleanName}`;
    const b64Compose = Buffer.from(baseCompose, 'utf-8').toString('base64');
    const b64Manifest = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8').toString('base64');
    const remoteScript = [
      `if [ -d "${remoteDir}" ]; then echo "ERROR: Ya existe ${remoteDir}" >&2; exit 1; fi`,
      `mkdir -p "${remoteDir}/services"`,
      `echo "${b64Compose}" | base64 -d > "${remoteDir}/docker-compose.yml"`,
      `echo "${b64Manifest}" | base64 -d > "${remoteDir}/.alpanel-project.json"`,
      `printf "COMPOSE_PROJECT_NAME=%s\\nPROJECT_SERVER_ID=%s\\n" "${slug}" "${server.id}" > "${remoteDir}/.env" && chmod 600 "${remoteDir}/.env"`,
      `docker network create "${isolatedNetwork}" 2>/dev/null || true`,
      `echo "✅ Workspace remoto ${cleanName} creado en ${remoteDir}"`,
    ].join('\n');

    const res = await remoteExecutorService.execOnServer(server, remoteScript, {
      timeoutMs: 30000,
    });

    // Crear espejo local ligero del manifiesto para descubrimiento inmediato en ALpanel Central
    const mirrorDir = path.join(this.projectsRoot, cleanName);
    if (!fs.existsSync(mirrorDir)) {
      fs.mkdirSync(mirrorDir, { recursive: true });
      this.writeManifest(mirrorDir, manifest);
    }

    return {
      success: true,
      output: res.stdout.trim() || `✅ Proyecto "${cleanName}" creado en ${server.name}.`,
      manifest,
    };
  }

  private appendServiceToCompose(
    projectDir: string,
    serviceName: string,
    serviceBlockYaml: string,
    networkName: string
  ): void {
    const composePath = path.join(projectDir, 'docker-compose.yml');
    let content = '';
    if (fs.existsSync(composePath)) {
      content = fs.readFileSync(composePath, 'utf-8');
    } else {
      content = `services:\n\nnetworks:\n  ${networkName}:\n    name: ${networkName}\n    driver: bridge\n`;
    }

    if (new RegExp(`^  ${serviceName}\\s*:`, 'm').test(content)) {
      throw new Error(
        `El servicio "${serviceName}" ya existe en docker-compose.yml.`
      );
    }

    if (/^services\s*:\s*\{\s*\}\s*$/m.test(content)) {
      content = content.replace(
        /^services\s*:\s*\{\s*\}\s*$/m,
        `services:\n${serviceBlockYaml}`
      );
    } else if (/^networks\s*:/m.test(content)) {
      content = content.replace(
        /^networks\s*:/m,
        `${serviceBlockYaml}\nnetworks:`
      );
    } else {
      content = `${content.trimEnd()}\n\n${serviceBlockYaml}\n`;
    }

    fs.writeFileSync(composePath, content, 'utf-8');
  }

  async addContainerToProject(
    projectName: string,
    payload: AddContainerToProjectPayload
  ): Promise<{ success: boolean; output: string }> {
    const cleanProject = new ProjectNameVO(projectName).value;
    const projectDir = new ProjectNameVO(cleanProject).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    if (!fs.existsSync(projectDir)) {
      throw new Error(`El proyecto "${cleanProject}" no existe.`);
    }

    const cleanSvc = String(payload.serviceName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
    if (!cleanSvc) {
      throw new Error('Debes indicar un nombre válido para el servicio/contenedor.');
    }

    const slug = cleanProject.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const existingManifest = this.readManifest(projectDir) || {
      projectName: cleanProject,
      serverId: 'local',
      serverName: 'Nodo Central (Local)',
      isolatedNetwork: `alpanel_isolated_${slug}_net`,
      linkedUpstreams: [],
      createdAt: new Date().toISOString(),
    };

    const logs: string[] = [];

    // MODO 1: Enlazar o Clonar un contenedor que corre en otro servidor
    if (payload.source === 'server') {
      const sourceServer = await manageServersUseCase.getStoredServerById(
        payload.sourceServerId || 'local'
      );
      const sourceContainer = (payload.sourceContainerName || '').replace(
        /[^a-zA-Z0-9._-]/g,
        ''
      );
      if (!sourceContainer) {
        throw new Error('Debes seleccionar el contenedor de origen.');
      }

      const mode = payload.linkMode || 'link';
      const targetPort = (payload.sourcePort || '3000').replace(/[^0-9]/g, '') || '3000';
      const targetHost = sourceServer.isLocal
        ? sourceContainer
        : sourceServer.privateIp || sourceServer.host;

      if (mode === 'link') {
        const envKey = `MS_${cleanSvc.replace(/^ms[-_]/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`;
        const upstream: ProjectLinkedUpstream = {
          id: `up-${Date.now().toString(36)}`,
          serviceName: cleanSvc,
          containerName: sourceContainer,
          serverId: sourceServer.id,
          serverName: sourceServer.name,
          host: targetHost,
          port: targetPort,
          pathPrefix: payload.pathPrefix || `/api/${cleanSvc.replace(/^ms[-_]/, '')}/*`,
          envVarName: envKey,
          linkedAt: new Date().toISOString(),
        };

        existingManifest.linkedUpstreams = [
          ...(existingManifest.linkedUpstreams || []).filter(
            (u) => u.serviceName !== cleanSvc
          ),
          upstream,
        ];
        this.writeManifest(projectDir, existingManifest);
        logs.push(
          taskTelemetryService.emitTaskStep(
            `==> Enlazado contenedor remoto "${sourceContainer}" (${sourceServer.name}) -> ${targetHost}:${targetPort}`,
            'Enlace Cross-Server'
          )
        );

        if (payload.syncGatewayEnvVar !== false) {
          upsertEnvFileVariables(projectDir, {
            [envKey]: `http://${targetHost}:${targetPort}`,
          });
          logs.push(`   -> Variable inyectada en .env: ${envKey}=http://${targetHost}:${targetPort}`);
        }

        if (payload.applyFirewallRule && !sourceServer.isLocal) {
          const centralIp = await hostService.getPublicIp().catch(() => '');
          if (centralIp) {
            const fwRes = await remoteExecutorService.allowPortFromGateway(
              sourceServer,
              Number(targetPort),
              centralIp
            );
            logs.push(`   -> ${fwRes.output}`);
          }
        }

        return {
          success: true,
          output: logs.join('\n') + `\n✅ Microservicio remoto "${cleanSvc}" integrado al proyecto ${cleanProject}.`,
        };
      }

      // mode === 'clone': inspeccionar imagen del contenedor remoto y crear servicio en este proyecto
      const inspectOut = await remoteExecutorService.execOnServer(
        sourceServer,
        `docker inspect --format '{{.Config.Image}}' "${sourceContainer}" 2>/dev/null || true`
      );
      const imageName = inspectOut.stdout.trim();
      if (!imageName) {
        throw new Error(`No se pudo inspeccionar la imagen de "${sourceContainer}" en ${sourceServer.name}.`);
      }

      const svcDir = path.join(projectDir, 'services', cleanSvc);
      fs.mkdirSync(svcDir, { recursive: true });
      const yamlBlock = [
        `  ${cleanSvc}:`,
        `    image: ${imageName}`,
        `    container_name: ${slug}_${cleanSvc}`,
        `    restart: unless-stopped`,
        `    environment:`,
        `      PORT: "${targetPort}"`,
        `    networks:`,
        `      - ${existingManifest.isolatedNetwork}`,
      ].join('\n');

      this.appendServiceToCompose(
        projectDir,
        cleanSvc,
        yamlBlock,
        existingManifest.isolatedNetwork
      );
      logs.push(`==> Servicio "${cleanSvc}" clonado desde imagen ${imageName} en ${projectDir}/docker-compose.yml`);
    } else if (payload.source === 'git') {
      // MODO 2: Agregar contenedor desde repositorio GitHub / GitLab
      const safeRepoUrl = new GitRepoUrlVO(payload.repoUrl || '').value;
      const safeBranch = GitRepoUrlVO.sanitizeBranch(payload.branch);
      const authedUrl = await manageServersUseCase.injectGitAuthInUrl(
        safeRepoUrl,
        payload.gitCredentialId
      );
      const svcDir = path.join(projectDir, 'services', cleanSvc);
      if (fs.existsSync(svcDir)) {
        throw new Error(`Ya existe una carpeta services/${cleanSvc} en ${cleanProject}.`);
      }
      fs.mkdirSync(path.dirname(svcDir), { recursive: true });

      const branchFlag = safeBranch ? `-b "${safeBranch}"` : '';
      logs.push(
        taskTelemetryService.emitTaskStep(
          `==> Clonando módulo "${cleanSvc}" desde ${safeRepoUrl} en services/${cleanSvc}...`,
          `Clonando ${cleanSvc}`
        )
      );
      await execAsync(
        `git -c core.hooksPath=/dev/null clone --progress ${branchFlag} "${authedUrl}" "${svcDir}"`,
        { timeout: 180000 }
      );
      // Limpiar credenciales del remote origin si se usó PAT temporal
      if (authedUrl !== safeRepoUrl) {
        await execAsync(`git remote set-url origin "${safeRepoUrl}"`, {
          cwd: svcDir,
        }).catch(() => null);
      }

      const internalPort = (payload.internalPort || '3000').replace(/[^0-9]/g, '') || '3000';
      const portLines = payload.hostPort
        ? [`    ports:`, `      - "${payload.hostPort.replace(/[^0-9]/g, '')}:${internalPort}"`]
        : [];
      const yamlBlock = [
        `  ${cleanSvc}:`,
        `    build:`,
        `      context: ./services/${cleanSvc}`,
        `      dockerfile: Dockerfile`,
        `    container_name: ${slug}_${cleanSvc}`,
        `    restart: unless-stopped`,
        ...portLines,
        `    environment:`,
        `      PORT: "${internalPort}"`,
        `    networks:`,
        `      - ${existingManifest.isolatedNetwork}`,
      ].join('\n');

      this.appendServiceToCompose(
        projectDir,
        cleanSvc,
        yamlBlock,
        existingManifest.isolatedNetwork
      );
      logs.push(`✅ Servicio "${cleanSvc}" agregado a docker-compose.yml (./services/${cleanSvc}).`);
    } else {
      // MODO 3: Crear contenedor directo por Imagen Docker o Dockerfile
      const svcDir = path.join(projectDir, 'services', cleanSvc);
      fs.mkdirSync(svcDir, { recursive: true });

      const internalPort = (payload.internalPort || '80').replace(/[^0-9]/g, '') || '80';
      const hasCustomDockerfile = Boolean(payload.dockerfileContent?.trim());
      if (hasCustomDockerfile) {
        fs.writeFileSync(
          path.join(svcDir, 'Dockerfile'),
          payload.dockerfileContent!.trim() + '\n',
          'utf-8'
        );
      }

      const safeImage = (payload.image || 'nginx:alpine').replace(/[^a-zA-Z0-9._:/-]/g, '');
      const portLines = payload.hostPort
        ? [`    ports:`, `      - "${payload.hostPort.replace(/[^0-9]/g, '')}:${internalPort}"`]
        : [];

      const extraEnvLines = (payload.envLines || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const idx = l.indexOf('=');
          const k = l.slice(0, idx).trim().replace(/[^A-Za-z0-9_]/g, '');
          const v = l.slice(idx + 1).trim();
          return k ? `      ${k}: "${v.replace(/"/g, '\\"')}"` : '';
        })
        .filter(Boolean);

      const yamlBlock = [
        `  ${cleanSvc}:`,
        ...(hasCustomDockerfile
          ? [
              `    build:`,
              `      context: ./services/${cleanSvc}`,
              `      dockerfile: Dockerfile`,
            ]
          : [`    image: ${safeImage}`]),
        `    container_name: ${slug}_${cleanSvc}`,
        `    restart: unless-stopped`,
        ...portLines,
        `    environment:`,
        `      PORT: "${internalPort}"`,
        ...extraEnvLines,
        `    networks:`,
        `      - ${existingManifest.isolatedNetwork}`,
      ].join('\n');

      this.appendServiceToCompose(
        projectDir,
        cleanSvc,
        yamlBlock,
        existingManifest.isolatedNetwork
      );
      logs.push(
        `✅ Servicio "${cleanSvc}" (${hasCustomDockerfile ? 'Dockerfile propio' : safeImage}) creado en services/${cleanSvc} y agregado a docker-compose.yml.`
      );
    }

    if (payload.autoStart !== false) {
      logs.push(
        taskTelemetryService.emitTaskStep(
          `==> Levantando nuevo contenedor "${cleanSvc}" en ${cleanProject}...`,
          `Iniciando ${cleanSvc}`
        )
      );
      const upArgs = payload.source === 'git' || payload.dockerfileContent
        ? `up -d --build ${cleanSvc}`
        : `up -d ${cleanSvc}`;
      const res = await runDockerComposeSafe(projectDir, upArgs, 300000);
      if (res.stdout) logs.push(res.stdout.trim());
      if (res.stderr) logs.push(res.stderr.trim());
    }

    return {
      success: true,
      output: logs.join('\n') + `\n✅ Contenedor "${cleanSvc}" listo en ${cleanProject}.`,
    };
  }
}

export const manageProjectWorkspaceUseCase = new ManageProjectWorkspaceUseCase();
