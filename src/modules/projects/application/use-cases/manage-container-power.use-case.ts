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

export function isDatabaseContainerName(name: string): boolean {
  return /\b(db|mariadb|mysql|postgres|postgresql|mongo)\b|[_-](db|mariadb|mysql|postgres)/i.test(
    name
  );
}

async function resolveExistingDbComposeProject(
  projectDir: string
): Promise<string | null> {
  const dbCandidates = extractComposeContainerNames(projectDir).filter((c) =>
    isDatabaseContainerName(c)
  );
  for (const dbName of dbCandidates) {
    try {
      const { stdout } = await execAsync(
        `docker inspect "${dbName}" --format '{{index .Config.Labels "com.docker.compose.project"}}'`,
        { timeout: 5000 }
      );
      const proj = (stdout || '').trim();
      if (proj) return proj;
    } catch {
      // Container does not exist yet
    }
  }
  return null;
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

    // NUNCA detener ni eliminar contenedores de Base de Datos para preservar intactos los datos y el uptime
    if (isDatabaseContainerName(containerName)) {
      continue;
    }

    try {
      const { stdout } = await execAsync(
        `docker inspect "${containerName}" --format '{{index .Config.Labels "com.docker.compose.project"}}||{{.Config.Image}}||{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}},{{end}}{{end}}'`,
        { timeout: 10000 }
      );
      const [currentProjectRaw] = stdout.trim().split('||');
      const currentProject = (currentProjectRaw || '').trim();

      if (currentProject && currentProject !== expectedComposeProject) {
        await execAsync(`docker rm -f "${containerName}" 2>/dev/null || true`, {
          timeout: 15000,
        }).catch(() => null);
      }
    } catch {
      // Container does not exist yet
    }
  }
}

export function upsertEnvFileVariables(
  projectDir: string,
  updates: Record<string, string>
): boolean {
  const entries = Object.entries(updates).filter(
    ([k, v]) => Boolean(k) && Boolean(v)
  );
  if (entries.length === 0 || !fs.existsSync(projectDir)) return false;

  const envPath = path.join(projectDir, '.env');
  const examplePath = path.join(projectDir, '.env.example');
  let content = '';

  try {
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    } else if (fs.existsSync(examplePath)) {
      content = fs.readFileSync(examplePath, 'utf-8');
    }
  } catch {
    return false;
  }

  let changed = false;
  for (const [key, val] of entries) {
    const lineRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm');
    const match = lineRegex.exec(content);
    if (match) {
      const currentVal = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (currentVal !== val) {
        content = content.replace(lineRegex, `${key}=${val}`);
        changed = true;
      }
    } else {
      content = `${content.trimEnd()}\n${key}=${val}\n`;
      changed = true;
    }
  }

  if (updates.BACKEND_PORT) {
    const proxyRegex =
      /^(\s*VITE_BACKEND_PROXY\s*=\s*https?:\/\/[^:\s#]+):\d+(.*)$/m;
    if (proxyRegex.test(content)) {
      const replaced = content.replace(
        proxyRegex,
        `$1:${updates.BACKEND_PORT}$2`
      );
      if (replaced !== content) {
        content = replaced;
        changed = true;
      }
    }
  }

  if (changed || !fs.existsSync(envPath)) {
    try {
      fs.writeFileSync(
        envPath,
        content.endsWith('\n') ? content : `${content}\n`,
        { encoding: 'utf-8', mode: 0o600 }
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function normalizeDomainRouteTargets<
  T extends {
    domain?: string;
    projectName?: string;
    frontendTarget?: string;
    backendTarget?: string;
    apiPathPrefix?: string;
  }
>(
  route: T,
  projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
  panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
): T {
  const copy = { ...route };
  const frontLower = (copy.frontendTarget || '').toLowerCase();
  const backLower = (copy.backendTarget || '').toLowerCase();

  // 1. Si se seleccionaron al revés (ej. backend en Frontend y frontend en Backend), intercambiarlos
  if (
    copy.frontendTarget &&
    copy.backendTarget &&
    !frontLower.includes('front') &&
    backLower.includes('front')
  ) {
    const tmp = copy.frontendTarget;
    copy.frontendTarget = copy.backendTarget;
    copy.backendTarget = tmp;
    copy.apiPathPrefix = copy.apiPathPrefix || '/api*';
  }

  // 2. Si el proyecto tiene contenedores separados de Frontend y Backend en docker-compose.yml,
  // pero la ruta quedó apuntando solo a uno de los dos (ej. cuando migró de monolito a separado), autocompletar ambos
  const projectName = (copy.projectName || '').trim();
  if (projectName && !ProjectNameVO.isSelfPanel(projectName, panelSelfDir)) {
    try {
      const projectDir = new ProjectNameVO(projectName).resolvePath(
        projectsRoot,
        panelSelfDir
      );
      if (fs.existsSync(projectDir)) {
        const containerNames = extractComposeContainerNames(projectDir);
        const frontContainer = containerNames.find((c) =>
          c.toLowerCase().includes('front')
        );
        const backContainer = containerNames.find((c) => {
          const l = c.toLowerCase();
          return (
            !l.includes('front') &&
            !l.includes('db') &&
            !l.includes('mariadb') &&
            !l.includes('mysql') &&
            !l.includes('postgres') &&
            !l.includes('redis') &&
            !l.includes('caddy')
          );
        });

        if (frontContainer && backContainer) {
          const envMap = readEnvMap(projectDir);
          const frontPort = envMap.FRONTEND_PORT || '5174';
          const backPort = envMap.BACKEND_PORT || envMap.PORT || '8000';

          const currentFront = (copy.frontendTarget || '').trim();
          const currentBack = (copy.backendTarget || '').trim();

          if (!currentBack && currentFront.startsWith(`${backContainer}:`)) {
            copy.backendTarget = currentFront;
            copy.frontendTarget = `${frontContainer}:${frontPort}`;
            copy.apiPathPrefix = copy.apiPathPrefix || '/api*';
          } else if (
            !currentBack &&
            currentFront.startsWith(`${frontContainer}:`)
          ) {
            copy.backendTarget = `${backContainer}:${backPort}`;
            copy.apiPathPrefix = copy.apiPathPrefix || '/api*';
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return copy;
}

export function syncDomainRoutePortsToProjectEnv(
  route: {
    domain?: string;
    projectName?: string;
    frontendTarget?: string;
    backendTarget?: string;
    apiPathPrefix?: string;
  },
  projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
  panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
): Record<string, string> {
  const normalizedRoute = normalizeDomainRouteTargets(
    route,
    projectsRoot,
    panelSelfDir
  );
  const projectName = (normalizedRoute.projectName || '').trim();
  if (!projectName || ProjectNameVO.isSelfPanel(projectName, panelSelfDir)) {
    return {};
  }

  let projectDir = '';
  try {
    projectDir = new ProjectNameVO(projectName).resolvePath(
      projectsRoot,
      panelSelfDir
    );
  } catch {
    return {};
  }

  if (!fs.existsSync(projectDir)) return {};

  const extractPort = (target?: string): string | null => {
    const m = /:(\d+)\s*$/.exec((target || '').trim());
    return m ? m[1] : null;
  };

  const frontPort = extractPort(normalizedRoute.frontendTarget);
  const backPort = extractPort(normalizedRoute.backendTarget);
  const cleanDomain = (normalizedRoute.domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

  if (!frontPort && !backPort && !cleanDomain) return {};

  let combinedText = '';
  for (const f of ['.env', '.env.example', 'docker-compose.yml', 'docker-compose.yaml']) {
    const p = path.join(projectDir, f);
    if (fs.existsSync(p)) {
      try {
        combinedText += '\n' + fs.readFileSync(p, 'utf-8');
      } catch {
        // ignore
      }
    }
  }

  const envMap = readEnvMap(projectDir);
  const updates: Record<string, string> = {};
  if (frontPort && backPort) {
    updates.FRONTEND_PORT = frontPort;
    updates.BACKEND_PORT = backPort;
    if (/^\s*PORT\s*=/m.test(combinedText)) {
      updates.PORT = backPort;
    }
  } else if (frontPort && !backPort) {
    const isFrontendContainer = (route.frontendTarget || '')
      .toLowerCase()
      .includes('front');
    if (isFrontendContainer) {
      updates.FRONTEND_PORT = frontPort;
    } else {
      if (/\bBACKEND_PORT\b/.test(combinedText)) {
        updates.BACKEND_PORT = frontPort;
      }
      if (/\bPORT\b/.test(combinedText) || !updates.BACKEND_PORT) {
        updates.PORT = frontPort;
      }
    }
  } else if (backPort && !frontPort) {
    updates.BACKEND_PORT = backPort;
    if (/^\s*PORT\s*=/m.test(combinedText)) {
      updates.PORT = backPort;
    }
  }

  if (cleanDomain) {
    if (/\bAPP_DOMAIN\b/.test(combinedText)) {
      updates.APP_DOMAIN = cleanDomain;
    }
    if (/\bCADDY_DOMAIN\b/.test(combinedText)) {
      updates.CADDY_DOMAIN = cleanDomain;
    }
    if (/\bAPP_URL\b/.test(combinedText)) {
      updates.APP_URL = `https://${cleanDomain}`;
    }
    if (/\bALLOWED_HOSTS\b/.test(combinedText)) {
      const currentHosts = (
        envMap.ALLOWED_HOSTS || 'localhost,127.0.0.1,backend'
      )
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h && h !== 'tu_ip_o_dominio' && h !== 'tu_dominio');
      if (!currentHosts.includes(cleanDomain)) {
        currentHosts.push(cleanDomain);
      }
      updates.ALLOWED_HOSTS = currentHosts.join(',');
    }
    if (/\bCSRF_TRUSTED_ORIGINS\b/.test(combinedText)) {
      const currentOrigins = (
        envMap.CSRF_TRUSTED_ORIGINS || 'http://localhost,https://localhost'
      )
        .split(',')
        .map((o) => o.trim())
        .filter(
          (o) =>
            o &&
            o !== 'http://tu_dominio' &&
            o !== 'https://tu_dominio' &&
            o !== 'tu_dominio'
        );
      for (const origin of [`http://${cleanDomain}`, `https://${cleanDomain}`]) {
        if (!currentOrigins.includes(origin)) {
          currentOrigins.push(origin);
        }
      }
      updates.CSRF_TRUSTED_ORIGINS = currentOrigins.join(',');
    }
  }

  upsertEnvFileVariables(projectDir, updates);
  return updates;
}

function readEnvMap(projectDir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of ['.env.example', '.env']) {
    const p = path.join(projectDir, file);
    if (!fs.existsSync(p)) continue;
    try {
      const lines = fs.readFileSync(p, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed
            .slice(eqIdx + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '');
          map[k] = v;
        }
      }
    } catch {
      // ignore
    }
  }
  return map;
}

export async function autoAssignAndPersistProjectPorts(
  projectDir: string
): Promise<Record<string, string>> {
  if (!fs.existsSync(projectDir)) return {};
  const projectName = path.basename(projectDir);

  // 1. Sincronizar primero los puertos configurados en Dominios & SSL (si existe ruta para este proyecto)
  let domainSynced: Record<string, string> = {};
  try {
    const routes = await domainsService.listRoutes();
    const matchingRoute = routes.find(
      (r) => (r.projectName || '').toLowerCase() === projectName.toLowerCase()
    );
    if (matchingRoute) {
      domainSynced = syncDomainRoutePortsToProjectEnv(matchingRoute);
    }
  } catch {
    // ignore
  }

  // 2. Descubrir puertos host ocupados por OTROS proyectos
  const ownContainers = new Set<string>(extractComposeContainerNames(projectDir));
  const busyPorts = new Set<number>([3308, 9000, 80, 443]);

  try {
    const { stdout } = await execAsync(
      `docker ps --format "{{.Names}}||{{.Ports}}"`,
      { timeout: 10000 }
    );
    for (const line of stdout.split('\n')) {
      const [cNameRaw, portsRaw] = line.split('||');
      const cName = (cNameRaw || '').trim();
      if (!cName || ownContainers.has(cName)) continue;
      const portRegex = /:(\d+)->/g;
      let m: RegExpExecArray | null;
      while ((m = portRegex.exec(portsRaw || '')) !== null) {
        busyPorts.add(Number(m[1]));
      }
    }
  } catch {
    // ignore
  }

  // 3. Inspeccionar docker-compose.yml y .env para auto-asignar puerto DB (y evitar colisiones)
  let composeContent = '';
  let composePath = '';
  for (const file of ['docker-compose.yml', 'docker-compose.yaml']) {
    const p = path.join(projectDir, file);
    if (fs.existsSync(p)) {
      composePath = p;
      try {
        composeContent = fs.readFileSync(p, 'utf-8');
      } catch {
        // ignore
      }
      break;
    }
  }

  if (composeContent && composePath) {
    // Si tiene un puerto fijo "3307:3306" o "3306:3306" sin variable, parametrizarlo con DB_EXTERNAL_PORT
    const fixedMysqlPortRegex = /^(\s*-\s*['"]?)(\d{4})(:3306['"]?\s*)$/m;
    const fixedMatch = fixedMysqlPortRegex.exec(composeContent);
    if (fixedMatch) {
      composeContent = composeContent.replace(
        fixedMysqlPortRegex,
        `$1\${DB_EXTERNAL_PORT:-${fixedMatch[2]}}$3`
      );
      try {
        fs.writeFileSync(composePath, composeContent, 'utf-8');
      } catch {
        // ignore
      }
    }
  }

  const envMap = readEnvMap(projectDir);
  const updates: Record<string, string> = {};

  const pickFreePort = (startPort: number): number => {
    let candidate = startPort;
    while (busyPorts.has(candidate)) {
      candidate++;
    }
    busyPorts.add(candidate);
    return candidate;
  };

  // Detectar variable de puerto externo de Base de Datos (ej. DB_EXTERNAL_PORT, FACTUPOS_DB_PORT, POSTGRES_PORT)
  const dbPortVarRegex =
    /\$\{([A-Z0-9_]*PORT[A-Z0-9_]*)(?::-(\d+))?\}:(?:3306|5432|\$\{[A-Z0-9_]+(?::-5432|:-3306)?\})/g;
  let dbMatch: RegExpExecArray | null;
  while ((dbMatch = dbPortVarRegex.exec(composeContent)) !== null) {
    const varName = dbMatch[1];
    const defaultPort = Number(dbMatch[2]) || (varName.includes('POSTGRES') ? 5432 : 3307);
    const currentPort = Number(envMap[varName]) || defaultPort;
    const freeDbPort = pickFreePort(currentPort);
    if (String(freeDbPort) !== envMap[varName]) {
      updates[varName] = String(freeDbPort);
      envMap[varName] = String(freeDbPort);
    }
  }

  // Verificar FRONTEND_PORT si existe en compose o .env
  const frontVarMatch = /\$\{FRONTEND_PORT(?::-(\d+))?\}/.exec(composeContent);
  if (frontVarMatch || envMap.FRONTEND_PORT) {
    const defaultFront = Number(frontVarMatch?.[1]) || 5173;
    const currentFront = Number(envMap.FRONTEND_PORT) || defaultFront;
    const freeFront = busyPorts.has(currentFront)
      ? pickFreePort(5173)
      : pickFreePort(currentFront);
    if (String(freeFront) !== envMap.FRONTEND_PORT) {
      updates.FRONTEND_PORT = String(freeFront);
      envMap.FRONTEND_PORT = String(freeFront);
    }
  }

  // Verificar BACKEND_PORT / PORT si existe en compose o .env
  const backVarMatch = /\$\{BACKEND_PORT(?::-(\d+))?\}/.exec(composeContent);
  if (backVarMatch || envMap.BACKEND_PORT) {
    const defaultBack = Number(backVarMatch?.[1]) || 8000;
    const currentBack = Number(envMap.BACKEND_PORT) || defaultBack;
    const freeBack = pickFreePort(currentBack);
    if (String(freeBack) !== envMap.BACKEND_PORT) {
      updates.BACKEND_PORT = String(freeBack);
      envMap.BACKEND_PORT = String(freeBack);
    }
  }

  const singlePortMatch = /\$\{PORT(?::-(\d+))?\}/.exec(composeContent);
  if (singlePortMatch || envMap.PORT) {
    const defaultPort = Number(singlePortMatch?.[1]) || 3000;
    const currentPort =
      Number(updates.BACKEND_PORT || envMap.PORT) || defaultPort;
    const freePort = busyPorts.has(currentPort)
      ? pickFreePort(currentPort)
      : currentPort;
    if (String(freePort) !== envMap.PORT) {
      updates.PORT = String(freePort);
      envMap.PORT = String(freePort);
    }
  }

  if (Object.keys(updates).length > 0) {
    upsertEnvFileVariables(projectDir, updates);
  }

  return { ...domainSynced, ...updates };
}

export async function runDockerComposeSafe(
  projectDir: string,
  composeArgs: string,
  timeout = 180000
): Promise<{ stdout: string; stderr: string }> {
  const requestedForceRecreate = composeArgs.includes('--force-recreate');
  const requestedBuild = composeArgs.includes('--build');
  let finalArgs = composeArgs
    .replace(/--force-recreate/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (finalArgs.startsWith('up') && !finalArgs.includes('--remove-orphans')) {
    finalArgs = `${finalArgs} --remove-orphans`;
  }

  if (finalArgs.startsWith('up')) {
    await autoAssignAndPersistProjectPorts(projectDir);
  }

  const existingDbProject = await resolveExistingDbComposeProject(projectDir);
  const env = {
    ...getCleanComposeEnv(projectDir),
    ...readEnvMap(projectDir),
  };
  if (existingDbProject) {
    env.COMPOSE_PROJECT_NAME = existingDbProject;
  }
  const expectedProject = env.COMPOSE_PROJECT_NAME || 'app';

  if (finalArgs.startsWith('up')) {
    await reconcileProjectComposeContainers(projectDir, expectedProject);
  }

  try {
    const upRes = await execAsync(`docker compose ${finalArgs}`, {
      cwd: projectDir,
      env,
      timeout,
    });
    if (requestedForceRecreate && !requestedBuild && finalArgs.startsWith('up')) {
      const appContainers = extractComposeContainerNames(projectDir).filter(
        (c) => !isDatabaseContainerName(c)
      );
      for (const appC of appContainers) {
        await execAsync(`docker restart "${appC}" 2>/dev/null || true`, {
          timeout: 45000,
        }).catch(() => null);
      }
    }
    return upRes;
  } catch (error: any) {
    const errText = `${error?.stderr || ''}\n${error?.stdout || ''}\n${
      error?.message || ''
    }`;

    if (errText.includes('is already in progress')) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return await execAsync(`docker compose up -d --remove-orphans`, {
        cwd: projectDir,
        env,
        timeout,
      });
    }

    if (errText.includes('is already in use by container')) {
      const toRemove = new Set<string>();
      const conflictRegex =
        /The container name "\/([^"]+)" is already in use/g;
      let match: RegExpExecArray | null;
      while ((match = conflictRegex.exec(errText)) !== null) {
        const cName = match[1].trim();
        if (
          cName &&
          !PROTECTED_PANEL_CONTAINERS.has(cName) &&
          !isDatabaseContainerName(cName)
        ) {
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
      const { stdout: portsOut } = await execAsync(
        `docker ps --format "{{.Ports}}"`,
        { timeout: 10000 }
      ).catch(() => ({ stdout: '' }));
      let nextPort = busyPort + 1;
      while (portsOut.includes(`:${nextPort}->`)) {
        nextPort++;
      }

      const currentEnv = readEnvMap(projectDir);
      const portUpdates: Record<string, string> = {};
      for (const [k, v] of Object.entries(currentEnv)) {
        if (k.includes('PORT') && Number(v) === busyPort) {
          portUpdates[k] = String(nextPort);
          env[k] = String(nextPort);
        }
      }
      if (Object.keys(portUpdates).length === 0 && busyPort >= 5170 && busyPort <= 5199) {
        portUpdates.FRONTEND_PORT = String(nextPort);
        env.FRONTEND_PORT = String(nextPort);
      }
      upsertEnvFileVariables(projectDir, portUpdates);
      await reconcileProjectComposeContainers(projectDir, expectedProject);
      return await execAsync(`docker compose ${finalArgs}`, {
        cwd: projectDir,
        env,
        timeout,
      });
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
        '==> Reiniciando contenedores de aplicación (manteniendo Base de Datos activa sin interrupción)...'
      );
      const appContainers = extractComposeContainerNames(projectDir).filter(
        (c) => !isDatabaseContainerName(c)
      );
      for (const appC of appContainers) {
        await execAsync(`docker restart "${appC}" 2>/dev/null || true`, {
          timeout: 60000,
        }).catch(() => null);
      }
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
