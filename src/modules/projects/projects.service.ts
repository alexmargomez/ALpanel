import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { SystemService } from '../system/system.service';
import { ProxyService } from '../proxy/proxy.service';

const execAsync = promisify(exec);

export interface DevModeState {
  active: boolean;
  projectName: string | null;
  branch: string;
  commitHash: string;
  commitMessage: string;
  domain: string;
  containerName: string;
  internalTarget: string;
  activatedAt: string | null;
}

export interface ContainerStatInfo {
  id: string;
  name: string;
  serviceName: string;
  image: string;
  state: string;
  status: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  ports: string[];
  role: 'frontend' | 'backend' | 'database' | 'proxy' | 'other';
}

export interface DatabaseConnectionInfo {
  hasDatabase: boolean;
  engine: string;
  containerName: string;
  status: string;
  host: string;
  internalHost: string;
  port: string;
  internalPort: string;
  database: string;
  username: string;
  password: string;
  rootUsername: string;
  rootPassword: string;
  connectionUrl: string;
  cliCommand: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  stack: string[];
  status: 'running' | 'partial' | 'stopped';
  domains: string[];
  git: {
    isRepo: boolean;
    branch: string;
    commitHash: string;
    commitMessage: string;
    remoteUrl: string;
    behindCount: number;
  };
  devMode: {
    isActive: boolean;
    branch: string;
    domain: string;
    commitHash: string;
    commitMessage: string;
    containerName: string;
    status: 'running' | 'stopped';
  };
  resources: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  containers: ContainerStatInfo[];
  hasEnvFile: boolean;
  hasComposeFile: boolean;
  database: DatabaseConnectionInfo;
}

export class ProjectsService {
  private docker: Docker;
  private projectsRoot: string;
  private systemService: SystemService;
  private devModeFile: string;

  constructor(systemService: SystemService) {
    this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
    this.projectsRoot = process.env.PROJECTS_ROOT || '/projects';
    this.systemService = systemService;
    const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.devModeFile = path.join(dataDir, 'dev-mode.json');
  }

  getProjectsRoot(): string {
    return this.projectsRoot;
  }

  private sanitizeProjectName(name: string): string {
    const clean = name.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!clean || clean !== name) {
      throw new Error(`Nombre de proyecto inválido: ${name}`);
    }
    return clean;
  }

  private getProjectPath(name: string): string {
    const clean = this.sanitizeProjectName(name);
    const resolved = path.resolve(this.projectsRoot, clean);
    if (!resolved.startsWith(path.resolve(this.projectsRoot))) {
      throw new Error('Acceso fuera de PROJECTS_ROOT denegado');
    }
    return resolved;
  }

  private detectRole(serviceName: string, image: string): ContainerStatInfo['role'] {
    const s = `${serviceName} ${image}`.toLowerCase();
    if (s.includes('mysql') || s.includes('mariadb') || s.includes('postgres') || s.includes('mongo') || s.includes('redis') || serviceName === 'db') {
      return 'database';
    }
    if (s.includes('caddy') || s.includes('nginx-proxy') || s.includes('traefik')) {
      return 'proxy';
    }
    if (s.includes('front') || s.includes('react') || s.includes('vue') || s.includes('next') || s.includes('vite') || s.includes('angular')) {
      return 'frontend';
    }
    return 'backend';
  }

  private detectStack(projectDir: string, containers: ContainerStatInfo[]): string[] {
    const stacks = new Set<string>();
    try {
      if (fs.existsSync(path.join(projectDir, 'manage.py')) || fs.existsSync(path.join(projectDir, 'requirements.txt'))) {
        stacks.add('Python / Django');
      }
      if (fs.existsSync(path.join(projectDir, 'artisan'))) {
        stacks.add('PHP / Laravel');
      } else if (fs.existsSync(path.join(projectDir, 'composer.json')) || fs.existsSync(path.join(projectDir, 'symfony'))) {
        stacks.add('PHP');
      }
      if (fs.existsSync(path.join(projectDir, 'pom.xml')) || fs.existsSync(path.join(projectDir, 'build.gradle'))) {
        stacks.add('Java / Spring');
      }
      if (fs.existsSync(path.join(projectDir, 'package.json'))) {
        stacks.add('Node.js');
      }
      for (const sub of ['frontend', 'backend', 'client', 'server', 'api', 'web']) {
        const subDir = path.join(projectDir, sub);
        if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
          if (fs.existsSync(path.join(subDir, 'package.json'))) stacks.add(`Node / ${sub}`);
          if (fs.existsSync(path.join(subDir, 'pom.xml'))) stacks.add('Java / Spring');
          if (fs.existsSync(path.join(subDir, 'artisan'))) stacks.add('PHP / Laravel');
          if (fs.existsSync(path.join(subDir, 'manage.py'))) stacks.add('Python / Django');
        }
      }
    } catch {
      // Ignore fs errors
    }

    for (const c of containers) {
      const img = c.image.toLowerCase();
      if (img.includes('mysql')) stacks.add('MySQL');
      if (img.includes('mariadb')) stacks.add('MariaDB');
      if (img.includes('postgres')) stacks.add('PostgreSQL');
      if (img.includes('caddy')) stacks.add('Caddy SSL');
      if (img.includes('redis')) stacks.add('Redis');
    }

    if (stacks.size === 0) {
      stacks.add('Docker Project');
    }
    return Array.from(stacks);
  }

  private async getContainerLiveStats(containerId: string, isRunning: boolean): Promise<{ cpuPercent: number; memoryBytes: number; memoryLimitBytes: number; memoryPercent: number }> {
    if (!isRunning) {
      return { cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: 0, memoryPercent: 0 };
    }
    try {
      const container = this.docker.getContainer(containerId);
      const stats: any = await container.stats({ stream: false });

      const cpuDelta =
        (stats?.cpu_stats?.cpu_usage?.total_usage || 0) -
        (stats?.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta =
        (stats?.cpu_stats?.system_cpu_usage || 0) -
        (stats?.precpu_stats?.system_cpu_usage || 0);
      const onlineCpus =
        stats?.cpu_stats?.online_cpus ||
        stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ||
        1;

      let cpuPercent = 0;
      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent = Math.round(((cpuDelta / systemDelta) * onlineCpus * 100) * 10) / 10;
      }

      const memUsage = stats?.memory_stats?.usage || 0;
      const memCache = stats?.memory_stats?.stats?.inactive_file || stats?.memory_stats?.stats?.cache || 0;
      const actualMem = Math.max(0, memUsage - memCache);
      const memLimit = stats?.memory_stats?.limit || 0;
      const memPercent = memLimit > 0 ? Math.round(((actualMem / memLimit) * 100) * 10) / 10 : 0;

      return {
        cpuPercent,
        memoryBytes: actualMem,
        memoryLimitBytes: memLimit,
        memoryPercent: memPercent,
      };
    } catch {
      return { cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: 0, memoryPercent: 0 };
    }
  }

  private async getGitInfo(projectDir: string): Promise<ProjectInfo['git']> {
    const gitDir = path.join(projectDir, '.git');
    if (!fs.existsSync(gitDir)) {
      return {
        isRepo: false,
        branch: '-',
        commitHash: '-',
        commitMessage: 'Sin repositorio Git inicializado',
        remoteUrl: '',
        behindCount: 0,
      };
    }
    try {
      const [branchRes, logRes, remoteRes, behindRes] = await Promise.all([
        execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir }).catch(() => ({ stdout: 'main' })),
        execAsync('git log -n 1 --pretty=format:"%h|%s"', { cwd: projectDir }).catch(() => ({ stdout: '-|-' })),
        execAsync('git config --get remote.origin.url', { cwd: projectDir }).catch(() => ({ stdout: '' })),
        execAsync('git rev-list HEAD..@{u} --count', { cwd: projectDir }).catch(() => ({ stdout: '0' })),
      ]);
      const [hash, ...msgParts] = logRes.stdout.trim().split('|');
      return {
        isRepo: true,
        branch: branchRes.stdout.trim() || 'main',
        commitHash: hash || '-',
        commitMessage: msgParts.join('|') || '-',
        remoteUrl: remoteRes.stdout.trim(),
        behindCount: parseInt(behindRes.stdout.trim(), 10) || 0,
      };
    } catch {
      return {
        isRepo: true,
        branch: 'main',
        commitHash: '-',
        commitMessage: '-',
        remoteUrl: '',
        behindCount: 0,
      };
    }
  }

  async checkProjectUpdates(projectName: string): Promise<{ success: boolean; behindCount: number; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    try {
      await execAsync('git fetch --quiet', { cwd: projectDir, timeout: 20000 });
      const { stdout } = await execAsync('git rev-list HEAD..@{u} --count', { cwd: projectDir });
      const behindCount = parseInt(stdout.trim(), 10) || 0;
      return {
        success: true,
        behindCount,
        output: behindCount > 0 ? `Hay ${behindCount} commit(s) nuevos listos para descargar.` : 'El proyecto está al día con el repositorio remoto.',
      };
    } catch (error: any) {
      return {
        success: false,
        behindCount: 0,
        output: error?.stderr || error?.message || 'No se pudo verificar el estado remoto.',
      };
    }
  }

  private async getDirectoryDiskSize(projectDir: string): Promise<number> {
    try {
      const { stdout } = await execAsync(`du -sb "${projectDir}" | awk '{print $1}'`, { timeout: 4000 });
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private parseEnvDictionary(projectDir: string): Record<string, string> {
    const envPath = path.join(projectDir, '.env');
    const examplePath = path.join(projectDir, '.env.example');
    let result: Record<string, string> = {};
    try {
      if (fs.existsSync(examplePath)) {
        result = { ...result, ...dotenv.parse(fs.readFileSync(examplePath, 'utf-8')) };
      }
      if (fs.existsSync(envPath)) {
        result = { ...result, ...dotenv.parse(fs.readFileSync(envPath, 'utf-8')) };
      }
    } catch {
      // Ignore parse errors
    }
    return result;
  }

  private extractDomains(projectDir: string, envDict: Record<string, string>): string[] {
    const domains = new Set<string>();
    if (envDict.CADDY_DOMAIN && envDict.CADDY_DOMAIN !== 'localhost' && envDict.CADDY_DOMAIN !== 'tu_dominio.com') {
      domains.add(envDict.CADDY_DOMAIN.trim());
    }
    if (envDict.APP_URL) {
      try {
        const u = new URL(envDict.APP_URL);
        if (u.hostname && u.hostname !== 'localhost') domains.add(u.hostname);
      } catch {}
    }
    if (envDict.ALLOWED_HOSTS) {
      envDict.ALLOWED_HOSTS.split(',').forEach((h) => {
        const clean = h.trim();
        if (clean && clean !== 'localhost' && clean !== '127.0.0.1' && !/^\d+\.\d+\.\d+\.\d+$/.test(clean) && clean !== 'tu_ip_o_dominio') {
          domains.add(clean);
        }
      });
    }
    try {
      const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
      const domainsFile = path.join(dataDir, 'domains.json');
      if (fs.existsSync(domainsFile)) {
        const routes = JSON.parse(fs.readFileSync(domainsFile, 'utf-8'));
        const projBase = path.basename(projectDir).toLowerCase();
        if (Array.isArray(routes)) {
          for (const r of routes) {
            if (r?.domain && String(r?.projectName || '').toLowerCase() === projBase) {
              domains.add(String(r.domain).trim());
            }
          }
        }
      }
    } catch {}
    return Array.from(domains);
  }

  async extractDatabaseInfo(
    projectDir: string,
    containers: ContainerStatInfo[],
    envDict: Record<string, string>,
    publicIp: string
  ): Promise<DatabaseConnectionInfo> {
    const dbContainer = containers.find((c) => c.role === 'database');

    let containerEnv: Record<string, string> = {};
    let externalPort = '';
    let internalPort = '3306';

    if (dbContainer) {
      try {
        const inspectData = await this.docker.getContainer(dbContainer.id).inspect();
        for (const e of inspectData.Config?.Env || []) {
          const idx = e.indexOf('=');
          if (idx > 0) {
            containerEnv[e.slice(0, idx)] = e.slice(idx + 1);
          }
        }
        const ports = inspectData.NetworkSettings?.Ports || {};
        for (const [internalKey, bindings] of Object.entries(ports)) {
          const intP = internalKey.split('/')[0];
          if (Array.isArray(bindings) && bindings.length > 0 && bindings[0].HostPort) {
            externalPort = bindings[0].HostPort;
            if (intP) internalPort = intP;
          }
        }
      } catch {
        // Fallback to envDict
      }
    }

    if (!externalPort) {
      const composePath = path.join(projectDir, 'docker-compose.yml');
      if (fs.existsSync(composePath)) {
        const content = fs.readFileSync(composePath, 'utf-8');
        const portMatch = content.match(/["']?(\d{4,5}):(3306|5432|27017)["']?/);
        if (portMatch) {
          externalPort = portMatch[1];
          internalPort = portMatch[2];
        }
      }
    }

    const merged = { ...envDict, ...containerEnv };
    const hasDbVars = Boolean(
      dbContainer ||
        merged.MYSQL_DATABASE ||
        merged.DB_NAME ||
        merged.DB_DATABASE ||
        merged.POSTGRES_DB
    );

    if (!hasDbVars) {
      return {
        hasDatabase: false,
        engine: '-',
        containerName: '-',
        status: 'none',
        host: publicIp,
        internalHost: '-',
        port: '-',
        internalPort: '-',
        database: '-',
        username: '-',
        password: '-',
        rootUsername: '-',
        rootPassword: '-',
        connectionUrl: '',
        cliCommand: '',
      };
    }

    const isPostgres =
      (dbContainer?.image || '').toLowerCase().includes('postgres') ||
      Boolean(merged.POSTGRES_DB || merged.POSTGRES_USER) ||
      internalPort === '5432';
    const isMaria = (dbContainer?.image || '').toLowerCase().includes('mariadb');

    const engine = isPostgres
      ? dbContainer?.image || 'PostgreSQL'
      : isMaria
      ? dbContainer?.image || 'MariaDB'
      : dbContainer?.image || 'MySQL 8.0';

    const database =
      merged.MYSQL_DATABASE ||
      merged.POSTGRES_DB ||
      merged.DB_NAME ||
      merged.DB_DATABASE ||
      'default_db';

    const username =
      merged.MYSQL_USER ||
      merged.POSTGRES_USER ||
      merged.DB_USER ||
      merged.DB_USERNAME ||
      (isPostgres ? 'postgres' : 'root');

    const password =
      merged.MYSQL_PASSWORD ||
      merged.POSTGRES_PASSWORD ||
      merged.DB_PASSWORD ||
      '';

    const rootUsername = isPostgres ? 'postgres' : 'root';
    const rootPassword =
      merged.MYSQL_ROOT_PASSWORD ||
      merged.POSTGRES_PASSWORD ||
      password;

    const effectivePort = externalPort || internalPort || (isPostgres ? '5432' : '3306');
    const internalHost = merged.DB_HOST || dbContainer?.serviceName || 'db';
    const protocol = isPostgres ? 'postgresql' : 'mysql';

    const connectionUrl = `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${publicIp}:${effectivePort}/${database}`;
    const cliCommand = isPostgres
      ? `PGPASSWORD='${password}' psql -h ${publicIp} -p ${effectivePort} -U ${username} -d ${database}`
      : `mysql -h ${publicIp} -P ${effectivePort} -u ${username} -p'${password}' ${database}`;

    return {
      hasDatabase: true,
      engine,
      containerName: dbContainer?.name || 'db',
      status: dbContainer?.state || 'stopped',
      host: publicIp,
      internalHost,
      port: effectivePort,
      internalPort,
      database,
      username,
      password,
      rootUsername,
      rootPassword,
      connectionUrl,
      cliCommand,
    };
  }

  async dumpDatabaseSql(projectName: string): Promise<{ filename: string; sql: string }> {
    const projects = await this.listProjects();
    const proj = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
    if (!proj || !proj.database.hasDatabase) {
      throw new Error('Este proyecto no tiene una base de datos activa configurada.');
    }
    const db = proj.database;
    const isPg = db.engine.toLowerCase().includes('postgres');
    const container = db.containerName.replace(/[^a-zA-Z0-9._-]/g, '');
    const dbName = db.database.replace(/[^a-zA-Z0-9._-]/g, '');
    const rootPass = db.rootPassword.replace(/'/g, "'\\''");

    const cmd = isPg
      ? `docker exec -e PGPASSWORD='${rootPass}' ${container} pg_dump -U ${db.rootUsername} ${dbName}`
      : `docker exec ${container} mysqldump -u ${db.rootUsername} -p'${rootPass}' ${dbName}`;

    const { stdout } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });
    const dateStr = new Date().toISOString().slice(0, 10);
    return {
      filename: `${proj.name}_${dbName}_${dateStr}.sql`,
      sql: stdout,
    };
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const publicIp = await this.systemService.getPublicIp();
    const allContainers = await this.docker.listContainers({ all: true });

    const projectDirs = new Map<string, string>();
    if (fs.existsSync(this.projectsRoot)) {
      const entries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = path.join(this.projectsRoot, entry.name);
        const hasProjectMarkers =
          fs.existsSync(path.join(fullPath, 'docker-compose.yml')) ||
          fs.existsSync(path.join(fullPath, 'docker-compose.yaml')) ||
          fs.existsSync(path.join(fullPath, 'Dockerfile')) ||
          fs.existsSync(path.join(fullPath, '.git')) ||
          fs.existsSync(path.join(fullPath, 'package.json')) ||
          fs.existsSync(path.join(fullPath, 'manage.py')) ||
          fs.existsSync(path.join(fullPath, 'composer.json')) ||
          fs.existsSync(path.join(fullPath, 'pom.xml'));
        if (hasProjectMarkers) {
          projectDirs.set(entry.name.toLowerCase(), fullPath);
        }
      }
    }

    const devState = this.getDevModeState();
    const defaultDevDomain = this.resolveDevSubdomain();
    const devContainerRunning = allContainers.some(
      (c) => (c.Names?.[0] || '').replace(/^\//, '') === 'alpanel_dev_app' && c.State === 'running'
    );

    const containersByProject = new Map<string, Docker.ContainerInfo[]>();
    for (const c of allContainers) {
      const composeProject = (c.Labels?.['com.docker.compose.project'] || '').toLowerCase();
      const composeWorkingDir = c.Labels?.['com.docker.compose.project.working_dir'] || '';
      const rawName = (c.Names?.[0] || '').replace(/^\//, '');

      if (rawName === 'alpanel_dev_app') continue;

      let matchedKey = composeProject;
      if (composeWorkingDir) {
        const dirBase = path.basename(composeWorkingDir).toLowerCase();
        if (!projectDirs.has(dirBase) && fs.existsSync(composeWorkingDir)) {
          projectDirs.set(dirBase, composeWorkingDir);
        }
        matchedKey = dirBase;
      } else if (!matchedKey) {
        for (const key of projectDirs.keys()) {
          if (rawName.toLowerCase().startsWith(key)) {
            matchedKey = key;
            break;
          }
        }
      }

      if (matchedKey) {
        const list = containersByProject.get(matchedKey) || [];
        list.push(c);
        containersByProject.set(matchedKey, list);
      }
    }

    const results: ProjectInfo[] = [];

    for (const [key, projectDir] of projectDirs.entries()) {
      const displayName = path.basename(projectDir);
      const rawContainers = containersByProject.get(key) || [];

      const containerStats: ContainerStatInfo[] = await Promise.all(
        rawContainers.map(async (c) => {
          const isRunning = c.State === 'running';
          const live = await this.getContainerLiveStats(c.Id, isRunning);
          const name = (c.Names?.[0] || '').replace(/^\//, '');
          const serviceName = c.Labels?.['com.docker.compose.service'] || name;
          const ports = (c.Ports || [])
            .filter((p) => p.PublicPort)
            .map((p) => `${p.PublicPort}->${p.PrivatePort}/${p.Type}`);

          return {
            id: c.Id.slice(0, 12),
            name,
            serviceName,
            image: c.Image,
            state: c.State,
            status: c.Status,
            cpuPercent: live.cpuPercent,
            memoryBytes: live.memoryBytes,
            memoryLimitBytes: live.memoryLimitBytes,
            memoryPercent: live.memoryPercent,
            ports: Array.from(new Set(ports)),
            role: this.detectRole(serviceName, c.Image),
          };
        })
      );

      const runningCount = containerStats.filter((c) => c.state === 'running').length;
      const status: ProjectInfo['status'] =
        containerStats.length === 0 || runningCount === 0
          ? 'stopped'
          : runningCount === containerStats.length
          ? 'running'
          : 'partial';

      const totalCpu = Math.round(containerStats.reduce((acc, c) => acc + c.cpuPercent, 0) * 10) / 10;
      const totalMem = containerStats.reduce((acc, c) => acc + c.memoryBytes, 0);

      const [git, diskBytes] = await Promise.all([
        this.getGitInfo(projectDir),
        this.getDirectoryDiskSize(projectDir),
      ]);

      const envDict = this.parseEnvDictionary(projectDir);
      const domains = this.extractDomains(projectDir, envDict).filter(
        (d) => !d.startsWith('develop.')
      );
      const database = await this.extractDatabaseInfo(projectDir, containerStats, envDict, publicIp);

      const isThisDevActive =
        devState.active &&
        Boolean(devState.projectName) &&
        devState.projectName!.toLowerCase() === displayName.toLowerCase();

      results.push({
        name: displayName,
        path: projectDir,
        stack: this.detectStack(projectDir, containerStats),
        status,
        domains,
        git,
        devMode: {
          isActive: isThisDevActive,
          branch: 'develop',
          domain: devState.domain || defaultDevDomain,
          commitHash: isThisDevActive ? devState.commitHash : '-',
          commitMessage: isThisDevActive ? devState.commitMessage : '-',
          containerName: 'alpanel_dev_app',
          status: isThisDevActive && devContainerRunning ? 'running' : 'stopped',
        },
        resources: {
          cpuPercent: totalCpu,
          memoryBytes: totalMem,
          diskBytes,
        },
        containers: containerStats,
        hasEnvFile: fs.existsSync(path.join(projectDir, '.env')) || fs.existsSync(path.join(projectDir, '.env.example')),
        hasComposeFile:
          fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
          fs.existsSync(path.join(projectDir, 'docker-compose.yaml')),
        database,
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
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

  resolveDevSubdomain(): string {
    if (process.env.DEV_SUBDOMAIN && process.env.DEV_SUBDOMAIN.trim()) {
      return process.env.DEV_SUBDOMAIN.trim().toLowerCase();
    }
    try {
      const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
      const domainsFile = path.join(dataDir, 'domains.json');
      if (fs.existsSync(domainsFile)) {
        const routes = JSON.parse(fs.readFileSync(domainsFile, 'utf-8'));
        if (Array.isArray(routes)) {
          for (const r of routes) {
            const d = String(r?.domain || '').trim().toLowerCase();
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

  /**
   * Activa Modo Desarrollador (rama develop) exclusivamente en un proyecto y apunta el subdominio develop.* a él.
   * Si otro proyecto tenía Modo Desarrollador activo, lo apaga primero automáticamente.
   */
  async activateDevMode(
    projectName: string,
    proxyService: ProxyService
  ): Promise<{ success: boolean; output: string; state: DevModeState }> {
    const cleanName = this.sanitizeProjectName(projectName);
    const projectDir = this.getProjectPath(cleanName);
    const devDomain = this.resolveDevSubdomain();
    const logs: string[] = [];

    const prevState = this.getDevModeState();
    if (prevState.active && prevState.projectName && prevState.projectName.toLowerCase() !== cleanName.toLowerCase()) {
      logs.push(`==> Desactivando Modo Desarrollador anterior en [${prevState.projectName}]...`);
    }

    try {
      await execAsync('docker rm -f alpanel_dev_app 2>/dev/null || true');

      const devRoot = path.join(this.projectsRoot, '.alpanel_dev');
      if (!fs.existsSync(devRoot)) {
        fs.mkdirSync(devRoot, { recursive: true });
      }
      const devDir = path.join(devRoot, cleanName);

      const remoteRes = await execAsync('git config --get remote.origin.url', { cwd: projectDir }).catch(() => ({
        stdout: '',
      }));
      const remoteUrl = remoteRes.stdout.trim();
      if (!remoteUrl) {
        throw new Error(`El proyecto ${cleanName} no tiene un repositorio Git remoto configurado.`);
      }

      if (!fs.existsSync(path.join(devDir, '.git'))) {
        logs.push(`==> Inicializando entorno aislado para rama [develop] de ${cleanName}...`);
        await execAsync(`rm -rf "${devDir}" && git clone "${projectDir}" "${devDir}"`, { timeout: 120000 });
        await execAsync(`git remote set-url origin "${remoteUrl}"`, { cwd: devDir });
      }

      logs.push(`==> Sincronizando rama [origin/develop] en entorno de pruebas...`);
      await execAsync('git fetch origin', { cwd: devDir, timeout: 60000 });
      await execAsync('git checkout -B develop origin/develop && git reset --hard origin/develop', {
        cwd: devDir,
        timeout: 60000,
      });

      const logRes = await execAsync('git log -n 1 --pretty=format:"%h|%s"', { cwd: devDir }).catch(() => ({
        stdout: '-|-',
      }));
      const [commitHash, ...msgParts] = logRes.stdout.trim().split('|');
      const commitMessage = msgParts.join('|') || '-';
      logs.push(`==> Commit en develop: ${commitHash} — ${commitMessage}`);

      // Preparar .env para Modo Desarrollador
      const prodEnvPath = path.join(projectDir, '.env');
      const devEnvPath = path.join(devDir, '.env');
      let envContent = fs.existsSync(prodEnvPath) ? fs.readFileSync(prodEnvPath, 'utf-8') : '';
      envContent += `\n# Overrides autogenerados por ALpanel Modo Desarrollador\nALLOWED_HOSTS=*\nCSRF_TRUSTED_ORIGINS=https://${devDomain},http://${devDomain}\n`;
      fs.writeFileSync(devEnvPath, envContent, 'utf-8');
      fs.chmodSync(devEnvPath, 0o600);

      // Detectar puerto interno y red a partir del contenedor principal del proyecto
      let internalPort = '8000';
      let networkName = 'api_sm_default';

      if (fs.existsSync(path.join(devDir, 'package.json')) && !fs.existsSync(path.join(devDir, 'manage.py'))) {
        internalPort = cleanName.toLowerCase() === 'serverpanel' ? '9000' : '3000';
      }

      const allContainers = await this.docker.listContainers({ all: true });
      const prodAppContainer = allContainers.find((c) => {
        const wDir = c.Labels?.['com.docker.compose.project.working_dir'] || '';
        const cName = (c.Names?.[0] || '').replace(/^\//, '');
        if (cName === 'alpanel_dev_app') return false;
        const role = this.detectRole(c.Labels?.['com.docker.compose.service'] || cName, c.Image);
        return (
          path.basename(wDir).toLowerCase() === cleanName.toLowerCase() &&
          (role === 'backend' || role === 'frontend')
        );
      });

      if (prodAppContainer) {
        const pPort = (prodAppContainer.Ports || []).find((p) => p.PrivatePort)?.PrivatePort;
        if (pPort) internalPort = String(pPort);
        const netKeys = Object.keys(prodAppContainer.NetworkSettings?.Networks || {});
        if (netKeys.length > 0) {
          networkName = netKeys[0];
        }
      }

      const imageTag = `alpanel_dev_${cleanName.toLowerCase()}:develop`;
      logs.push(`==> Construyendo imagen Docker de pruebas (${imageTag})...`);
      await execAsync(`docker build -t ${imageTag} "${devDir}"`, { timeout: 600000 });

      logs.push(`==> Levantando contenedor aislado [alpanel_dev_app] en puerto interno ${internalPort}...`);
      const isDjango = fs.existsSync(path.join(devDir, 'manage.py'));
      const runCmd = isDjango
        ? `docker run -d --name alpanel_dev_app --restart unless-stopped --network ${networkName} --env-file "${devEnvPath}" -e ALLOWED_HOSTS=* -v "${devDir}:/app" ${imageTag} sh -c "python manage.py migrate --noinput && gunicorn --bind 0.0.0.0:${internalPort} core.wsgi:application"`
        : `docker run -d --name alpanel_dev_app --restart unless-stopped --network ${networkName} --env-file "${devEnvPath}" -v /var/run/docker.sock:/var/run/docker.sock -v "${this.projectsRoot}:${this.projectsRoot}" ${imageTag}`;

      await execAsync(runCmd, { timeout: 120000 });
      // Asegurar conexión con la red global del proxy Caddy de ALpanel (alpanel_proxy_net)
      if (networkName !== 'alpanel_proxy_net') {
        await execAsync('docker network connect alpanel_proxy_net alpanel_dev_app 2>/dev/null || true').catch(() => null);
      }

      const internalTarget = `alpanel_dev_app:${internalPort}`;
      logs.push(`==> Enrutando https://${devDomain} -> ${internalTarget} en Caddy SSL...`);
      proxyService.saveRoute({
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
      fs.writeFileSync(this.devModeFile, JSON.stringify(newState, null, 2), 'utf-8');

      logs.push(`\n✅ Modo Desarrollador ACTIVO para [${cleanName}] (rama develop) en: https://${devDomain}`);
      return { success: true, output: logs.join('\n'), state: newState };
    } catch (error: any) {
      logs.push(`\n❌ Error activando Modo Desarrollador: ${error?.stderr || error?.message}`);
      return {
        success: false,
        output: logs.join('\n'),
        state: this.getDevModeState(),
      };
    }
  }

  /**
   * Apaga el Modo Desarrollador activo, detiene el contenedor de pruebas y libera el subdominio develop.*
   */
  async deactivateDevMode(
    proxyService: ProxyService
  ): Promise<{ success: boolean; output: string; state: DevModeState }> {
    const prev = this.getDevModeState();
    const logs: string[] = [];
    try {
      logs.push(`==> Deteniendo contenedor de Modo Desarrollador (alpanel_dev_app)...`);
      await execAsync('docker rm -f alpanel_dev_app 2>/dev/null || true');

      logs.push(`==> Desvinculando subdominio ${prev.domain} en Caddy...`);
      proxyService.deleteRoute('route-dev-mode');
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
      fs.writeFileSync(this.devModeFile, JSON.stringify(newState, null, 2), 'utf-8');

      logs.push(`✅ Modo Desarrollador apagado correctamente.`);
      return { success: true, output: logs.join('\n'), state: newState };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error al apagar Modo Desarrollador',
        state: this.getDevModeState(),
      };
    }
  }

  /**
   * Git Pull & Restart en Producción (siempre rama main) con Rollback automático
   */
  async gitPullAndRestart(projectName: string): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    const logs: string[] = [];
    let prevHead = '';

    try {
      const headRes = await execAsync('git rev-parse HEAD', { cwd: projectDir }).catch(() => ({ stdout: '' }));
      prevHead = headRes.stdout.trim();

      logs.push(`==> [1/2] Ejecutando git pull origin main en ${projectName} (HEAD actual: ${prevHead.slice(0, 7) || 'N/A'})...`);
      await execAsync('git fetch origin && git checkout main', { cwd: projectDir, timeout: 30000 }).catch(() => null);
      const pullRes = await execAsync('git pull origin main', { cwd: projectDir, timeout: 60000 });
      logs.push(pullRes.stdout.trim() || 'Already up to date.');
      if (pullRes.stderr) logs.push(pullRes.stderr.trim());

      logs.push(`\n==> [2/2] Reiniciando contenedores Docker de producción (${projectName})...`);
      const restartRes = await execAsync('docker compose restart', { cwd: projectDir, timeout: 120000 });
      if (restartRes.stdout) logs.push(restartRes.stdout.trim());
      if (restartRes.stderr) logs.push(restartRes.stderr.trim());
      logs.push(`\n✅ Proyecto ${projectName} (rama main) actualizado y reiniciado exitosamente.`);

      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      logs.push(`\n❌ Error durante la actualización: ${error?.stderr || error?.stdout || error?.message}`);
      if (prevHead) {
        try {
          logs.push(`⏪ Ejecutando Rollback automático al commit estable ${prevHead.slice(0, 7)}...`);
          await execAsync(`git reset --hard ${prevHead}`, { cwd: projectDir });
          await execAsync('docker compose restart', { cwd: projectDir });
          logs.push(`✅ Rollback completado. El proyecto sigue corriendo en la versión anterior estable.`);
        } catch {
          logs.push(`⚠️ No se pudo completar el rollback automático.`);
        }
      }
      return { success: false, output: logs.join('\n') };
    }
  }

  async restartProject(projectName: string, containerName?: string): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    try {
      if (containerName) {
        const cleanContainer = containerName.replace(/[^a-zA-Z0-9._-]/g, '');
        const { stdout, stderr } = await execAsync(`docker restart ${cleanContainer}`, { timeout: 60000 });
        return {
          success: true,
          output: `Contenedor ${cleanContainer} reiniciado.\n${stdout}\n${stderr}`.trim(),
        };
      }
      const { stdout, stderr } = await execAsync('docker compose restart', { cwd: projectDir, timeout: 120000 });
      return {
        success: true,
        output: `Proyecto ${projectName} reiniciado correctamente.\n${stdout}\n${stderr}`.trim(),
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error al reiniciar el proyecto',
      };
    }
  }

  async startProject(projectName: string): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    try {
      const { stdout, stderr } = await execAsync('docker compose up -d', { cwd: projectDir, timeout: 180000 });
      return {
        success: true,
        output: [stdout, stderr].filter(Boolean).join('\n').trim() || `Proyecto ${projectName} iniciado.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error iniciando proyecto',
      };
    }
  }

  async stopProject(projectName: string): Promise<{ success: boolean; output: string }> {
    if (projectName.toLowerCase() === 'serverpanel') {
      return {
        success: false,
        output: 'Por seguridad no puedes detener ALpanel (ServerPanel) desde sí mismo porque perderías acceso al panel. Usa Restart Docker si deseas reiniciarlo.',
      };
    }
    const projectDir = this.getProjectPath(projectName);
    try {
      const { stdout, stderr } = await execAsync('docker compose stop', { cwd: projectDir, timeout: 120000 });
      return {
        success: true,
        output: [stdout, stderr].filter(Boolean).join('\n').trim() || `Proyecto ${projectName} detenido.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error deteniendo proyecto',
      };
    }
  }

  async rebuildProject(projectName: string): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    try {
      const { stdout, stderr } = await execAsync('docker compose up -d --build --force-recreate', {
        cwd: projectDir,
        timeout: 600000,
      });
      return {
        success: true,
        output: [stdout, stderr].filter(Boolean).join('\n').trim() || `Rebuild de ${projectName} completado.`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error en rebuild del proyecto',
      };
    }
  }

  async clearProjectCache(projectName: string): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    const logs: string[] = [];
    try {
      logs.push(`==> Limpiando caché de aplicación en ${projectName}...`);
      await execAsync(`find "${projectDir}" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true`);

      const projects = await this.listProjects();
      const proj = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
      const appContainer = proj?.containers.find((c) => c.role === 'backend' && c.state === 'running');

      if (appContainer) {
        const cName = appContainer.name;
        if (fs.existsSync(path.join(projectDir, 'artisan'))) {
          const { stdout } = await execAsync(`docker exec ${cName} php artisan optimize:clear || true`);
          if (stdout) logs.push(stdout.trim());
        } else if (fs.existsSync(path.join(projectDir, 'symfony'))) {
          const { stdout } = await execAsync(`docker exec ${cName} php symfony cc || true`);
          if (stdout) logs.push(stdout.trim());
        } else if (fs.existsSync(path.join(projectDir, 'manage.py'))) {
          await execAsync(`docker exec ${cName} sh -c "find . -name '*.pyc' -delete" || true`);
          logs.push('Archivos .pyc y __pycache__ de Django eliminados.');
        }
      }

      logs.push('==> Reiniciando contenedores de aplicación para recargar memoria...');
      const { stdout, stderr } = await execAsync('docker compose restart', { cwd: projectDir, timeout: 120000 });
      if (stdout) logs.push(stdout.trim());
      if (stderr) logs.push(stderr.trim());
      logs.push(`✅ Caché limpiada y servicios de ${projectName} recargados.`);

      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error limpiando caché del proyecto',
      };
    }
  }

  async getContainerLogs(containerName: string, tail = 150): Promise<string> {
    const clean = containerName.replace(/[^a-zA-Z0-9._-]/g, '');
    try {
      const { stdout, stderr } = await execAsync(`docker logs --tail ${Number(tail) || 150} ${clean}`, {
        timeout: 15000,
      });
      return [stdout, stderr].filter(Boolean).join('\n') || 'Sin logs recientes.';
    } catch (error: any) {
      return error?.stderr || error?.message || 'No se pudieron obtener los logs.';
    }
  }

  getEnvFileContent(projectName: string): { content: string; exists: boolean } {
    const projectDir = this.getProjectPath(projectName);
    const envPath = path.join(projectDir, '.env');
    const examplePath = path.join(projectDir, '.env.example');
    if (fs.existsSync(envPath)) {
      return { content: fs.readFileSync(envPath, 'utf-8'), exists: true };
    }
    if (fs.existsSync(examplePath)) {
      return { content: fs.readFileSync(examplePath, 'utf-8'), exists: false };
    }
    return { content: '# Variables de entorno (.env)\n', exists: false };
  }

  async saveEnvFileContent(
    projectName: string,
    content: string,
    restartAfter = true
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = this.getProjectPath(projectName);
    const envPath = path.join(projectDir, '.env');
    fs.writeFileSync(envPath, content, 'utf-8', );
    fs.chmodSync(envPath, 0o600);

    if (restartAfter) {
      return this.restartProject(projectName);
    }
    return { success: true, output: 'Archivo .env guardado correctamente (permisos 0600).' };
  }

  async cloneNewProject(payload: {
    name: string;
    repoUrl: string;
    branch?: string;
    envContent?: string;
    autoStart?: boolean;
  }): Promise<{ success: boolean; output: string }> {
    const cleanName = this.sanitizeProjectName(payload.name);
    const targetDir = this.getProjectPath(cleanName);
    if (fs.existsSync(targetDir)) {
      return { success: false, output: `La carpeta ${targetDir} ya existe en el servidor.` };
    }

    if (!/^https?:\/\/|^git@|^ssh:\/\//.test(payload.repoUrl.trim())) {
      return { success: false, output: 'URL de repositorio Git inválida.' };
    }

    const logs: string[] = [];
    try {
      const branchArg = payload.branch ? `-b ${payload.branch.replace(/[^a-zA-Z0-9._/-]/g, '')}` : '';
      logs.push(`==> Clonando ${payload.repoUrl} en ${targetDir}...`);
      const cloneRes = await execAsync(`git clone ${branchArg} "${payload.repoUrl.replace(/"/g, '')}" "${targetDir}"`, {
        timeout: 180000,
      });
      if (cloneRes.stdout) logs.push(cloneRes.stdout.trim());
      if (cloneRes.stderr) logs.push(cloneRes.stderr.trim());

      if (payload.envContent && payload.envContent.trim()) {
        const envFile = path.join(targetDir, '.env');
        fs.writeFileSync(envFile, payload.envContent, 'utf-8');
        fs.chmodSync(envFile, 0o600);
        logs.push('==> Archivo .env creado con permisos restringidos (0600).');
      }

      if (payload.autoStart && (fs.existsSync(path.join(targetDir, 'docker-compose.yml')) || fs.existsSync(path.join(targetDir, 'docker-compose.yaml')))) {
        logs.push('==> Construyendo y levantando contenedores Docker (docker compose up -d --build)...');
        const upRes = await execAsync('docker compose up -d --build', { cwd: targetDir, timeout: 600000 });
        if (upRes.stdout) logs.push(upRes.stdout.trim());
        if (upRes.stderr) logs.push(upRes.stderr.trim());
      }

      logs.push(`✅ Proyecto ${cleanName} creado exitosamente.`);
      return { success: true, output: logs.join('\n') };
    } catch (error: any) {
      logs.push(`❌ Error: ${error?.stderr || error?.message}`);
      return { success: false, output: logs.join('\n') };
    }
  }
}
