import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ContainerStatInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { GitRepoUrlVO } from '../../domain/value-objects/git-repo-url.vo';

const execAsync = promisify(exec);

export interface MicroserviceServiceItem {
  serviceName: string;
  containerName: string;
  displayName: string;
  domainCode: string;
  category: 'core' | 'microservice' | 'database' | 'frontend' | 'gateway';
  isSelectable: boolean;
  enabled: boolean;
  state: 'running' | 'stopped' | 'not_created';
  port: string;
  description: string;
  subModules: string[];
}

export interface ProjectMicroservicesSummary {
  isMicroservicesArchitecture: boolean;
  architectureType: 'microservices' | 'monolith';
  architectureLabel: string;
  totalMicroservices: number;
  enabledMicroservicesCount: number;
  runningMicroservicesCount: number;
  coreServices: MicroserviceServiceItem[];
  microservices: MicroserviceServiceItem[];
  enabledServiceNames: string[];
}

interface PersistedMicroservicesConfig {
  updatedAt: string;
  enabledMicroservices: string[];
}

interface ParsedComposeServiceRaw {
  serviceName: string;
  commentHeader: string;
  containerName: string;
  image: string;
  hasBuild: boolean;
  port: string;
  env: Record<string, string>;
}

const FRIENDLY_DOMAIN_TITLES: Record<string, string> = {
  crm: 'CRM, Clientes & Fidelización',
  inventory: 'Inventario, Kardex, Recetas & Lotes',
  invoicing: 'Facturación POS, Recibos & DIAN',
  gastro: 'Gastronomía, Mesas, KDS & Cuentas',
  hotel: 'Hotelería, Habitaciones & PMS',
  finance: 'Finanzas, Caja, Cartera & PUC',
  billing: 'Suscripciones & Facturación SaaS',
  auth: 'Autenticación & Identidad',
  notifications: 'Notificaciones & Mensajería',
  analytics: 'Analítica & Reportes BI',
  logistics: 'Logística & Despachos',
  hr: ' Nómina & Talento Humano',
};

export class ManageProjectMicroservicesUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  private getConfigFilePath(projectDir: string): string {
    return path.join(projectDir, '.alpanel-microservices.json');
  }

  private readPersistedConfig(
    projectDir: string
  ): PersistedMicroservicesConfig | null {
    const filePath = this.getConfigFilePath(projectDir);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(raw?.enabledMicroservices)) {
        return {
          updatedAt: String(raw.updatedAt || new Date().toISOString()),
          enabledMicroservices: raw.enabledMicroservices.map((s: any) =>
            String(s).trim()
          ),
        };
      }
    } catch {
      // ignore invalid json
    }
    return null;
  }

  private readEnvEnabledMicroservices(projectDir: string): string[] | null {
    for (const file of ['.env', '.env.example']) {
      const envPath = path.join(projectDir, file);
      if (!fs.existsSync(envPath)) continue;
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        const match = /^ENABLED_MICROSERVICES\s*=\s*(.+)$/m.exec(content);
        if (match) {
          const val = match[1].trim().replace(/^['"]|['"]$/g, '');
          if (val && val !== '*') {
            return val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
          if (val === '*') {
            return null;
          }
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private parseComposeServices(projectDir: string): ParsedComposeServiceRaw[] {
    let composePath = '';
    for (const candidate of [
      'docker-compose.yml',
      'docker-compose.yaml',
      'infra/docker/docker-compose.yml',
    ]) {
      const full = path.join(projectDir, candidate);
      if (fs.existsSync(full)) {
        composePath = full;
        break;
      }
    }
    if (!composePath) return [];

    let content = '';
    try {
      content = fs.readFileSync(composePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const services: ParsedComposeServiceRaw[] = [];
    let inServicesBlock = false;
    let currentService: ParsedComposeServiceRaw | null = null;
    let inEnvBlock = false;
    let inPortsBlock = false;
    let lastTopComment = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^services\s*:/.test(line)) {
        inServicesBlock = true;
        continue;
      }
      if (inServicesBlock && /^[a-zA-Z0-9_-]+\s*:/.test(line)) {
        // Top-level key outside services (e.g. networks:, volumes:)
        if (!line.startsWith(' ')) {
          if (currentService) {
            services.push(currentService);
            currentService = null;
          }
          inServicesBlock = false;
          continue;
        }
      }

      if (!inServicesBlock) continue;

      // Comment at 2-space indent right before a service definition
      if (/^\s{2}#\s*(.+)$/.test(line)) {
        lastTopComment = line.replace(/^\s{2}#\s*/, '').trim();
        continue;
      }

      // Service definition at 2-space indent: "  service-name:"
      const serviceMatch = /^  ([a-zA-Z0-9._-]+)\s*:\s*$/.exec(line);
      if (serviceMatch) {
        if (currentService) {
          services.push(currentService);
        }
        currentService = {
          serviceName: serviceMatch[1],
          commentHeader: lastTopComment,
          containerName: '',
          image: '',
          hasBuild: false,
          port: '',
          env: {},
        };
        lastTopComment = '';
        inEnvBlock = false;
        inPortsBlock = false;
        continue;
      }

      if (!currentService) continue;

      if (/^\s{4}[a-zA-Z0-9._-]+\s*:/.test(line)) {
        inEnvBlock = /^\s{4}environment\s*:/.test(line);
        inPortsBlock = /^\s{4}ports\s*:/.test(line);
      }

      const containerMatch =
        /^\s{4}container_name\s*:\s*['"]?([a-zA-Z0-9._-]+)['"]?/.exec(line);
      if (containerMatch) {
        currentService.containerName = containerMatch[1].trim();
        continue;
      }

      const imageMatch = /^\s{4}image\s*:\s*['"]?([^\s'"]+)['"]?/.exec(line);
      if (imageMatch) {
        currentService.image = imageMatch[1].trim();
        continue;
      }

      if (/^\s{4}build\s*:/.test(line)) {
        currentService.hasBuild = true;
        continue;
      }

      if (inPortsBlock && trimmed.startsWith('-')) {
        const portClean = trimmed
          .replace(/^-\s*['"]?/, '')
          .replace(/['"]?\s*$/, '');
        const pMatch = /:(\d+)(?:\/tcp)?$/.exec(portClean);
        if (pMatch && !currentService.port) {
          currentService.port = pMatch[1];
        }
        continue;
      }

      if (inEnvBlock && /^\s{6,}[A-Za-z0-9_]+\s*:/.test(line)) {
        const envMatch = /^\s{6,}([A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line);
        if (envMatch) {
          const k = envMatch[1].trim();
          const v = envMatch[2].trim().replace(/^['"]|['"]$/g, '');
          currentService.env[k] = v;
          if (k === 'PORT' && !currentService.port && /^\d+$/.test(v)) {
            currentService.port = v;
          }
        }
      }
    }

    if (currentService) {
      services.push(currentService);
    }

    return services;
  }

  private discoverSubModulesFromFilesystem(
    projectDir: string,
    domainCode: string,
    commentHeader: string
  ): string[] {
    const subModules = new Set<string>();

    // 1. Extract from comment header if present, e.g. "(Módulos: mod:crm-directory, mod:crm-pipelines)"
    const modMatches = commentHeader.match(/(?:mod|ms):[a-z0-9-]+/gi);
    if (modMatches) {
      for (const m of modMatches) {
        if (m.toLowerCase().startsWith('mod:')) {
          subModules.add(m.toLowerCase());
        }
      }
    }

    // 2. Scan apps/srv-<domain> or apps/ms-<domain> or services/<domain>
    const candidateDirs = [
      path.join(projectDir, 'apps', `srv-${domainCode}`),
      path.join(projectDir, 'apps', `ms-${domainCode}`),
      path.join(projectDir, 'services', domainCode),
      path.join(projectDir, 'microservices', domainCode),
    ];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            entry.name !== 'host-runner' &&
            entry.name !== 'node_modules' &&
            entry.name !== 'dist'
          ) {
            const normalizedMod = entry.name.startsWith('ms-')
              ? `mod:${entry.name.replace(/^ms-/, '')}`
              : `mod:${entry.name}`;
            subModules.add(normalizedMod);
          }
        }
      } catch {
        // ignore
      }
    }

    return Array.from(subModules);
  }

  private classifyComposeService(
    raw: ParsedComposeServiceRaw,
    totalServicesCount: number
  ): {
    category: MicroserviceServiceItem['category'];
    isSelectable: boolean;
    domainCode: string;
    displayName: string;
    description: string;
  } {
    const sLower = raw.serviceName.toLowerCase();
    const imgLower = raw.image.toLowerCase();
    const nodeRole = (raw.env.PROVEKO_NODE_ROLE || '').toLowerCase();

    // 1. Database / Cache / Broker Infrastructure
    if (
      /\b(db|postgres|postgresql|mysql|mariadb|mongo|redis|nats|pgbouncer|rabbitmq|kafka)\b/.test(
        sLower
      ) ||
      /\b(postgres|mysql|mariadb|mongo|redis|nats|pgbouncer)\b/.test(imgLower)
    ) {
      return {
        category: 'database',
        isSelectable: false,
        domainCode: 'db',
        displayName: `Base de Datos (${raw.serviceName})`,
        description:
          raw.commentHeader ||
          'Motor de persistencia y base de datos del clúster',
      };
    }

    // 2. Frontend
    if (
      nodeRole === 'frontend' ||
      sLower === 'frontend' ||
      sLower === 'web' ||
      sLower === 'web-app' ||
      sLower === 'client' ||
      sLower.endsWith('-frontend')
    ) {
      return {
        category: 'frontend',
        isSelectable: false,
        domainCode: 'frontend',
        displayName: `Frontend Web (${raw.serviceName})`,
        description:
          raw.commentHeader || 'Interfaz de usuario / Workstation Web App',
      };
    }

    // 3. API Gateway / Proxy
    if (
      nodeRole === 'api-gateway' ||
      sLower === 'api-gateway' ||
      sLower === 'gateway' ||
      sLower === 'proxy' ||
      sLower === 'caddy'
    ) {
      return {
        category: 'gateway',
        isSelectable: false,
        domainCode: 'gateway',
        displayName: `API Gateway (${raw.serviceName})`,
        description:
          raw.commentHeader ||
          'Puerta de enlace perimetral y enrutador hacia microservicios',
      };
    }

    // 4. Control Plane / Core Service
    if (
      nodeRole === 'core-service' ||
      sLower === 'core-service' ||
      sLower === 'control-plane' ||
      sLower === 'core'
    ) {
      return {
        category: 'core',
        isSelectable: false,
        domainCode: 'core',
        displayName: `Control Plane (${raw.serviceName})`,
        description:
          raw.commentHeader ||
          'Plano de control central, catálogo y orquestación',
      };
    }

    // 5. Domain Microservices (ms-*, srv-*, svc-*, or PROVEKO_NODE_ROLE=ms-host-runner, or multi-service workers)
    const isExplicitMicroservice =
      nodeRole === 'ms-host-runner' ||
      Boolean(raw.env.PROVEKO_PARENT_SERVICE) ||
      /^(ms|srv|svc|micro)[_-]/i.test(sLower) ||
      /[_-](ms|service|microservice)$/i.test(sLower);

    if (isExplicitMicroservice || totalServicesCount >= 5) {
      const cleanDomain = sLower
        .replace(/^(ms|srv|svc|micro)[_-]/i, '')
        .replace(/[_-](ms|service|microservice)$/i, '');
      const friendly =
        FRIENDLY_DOMAIN_TITLES[cleanDomain] ||
        cleanDomain.charAt(0).toUpperCase() + cleanDomain.slice(1);
      const cleanComment = raw.commentHeader
        .replace(/^\d+\.\s*/, '')
        .replace(/^Microservicio Independiente:\s*/i, '');

      return {
        category: 'microservice',
        isSelectable: true,
        domainCode: cleanDomain || sLower,
        displayName: `${friendly} (${raw.serviceName})`,
        description:
          cleanComment ||
          `Microservicio independiente del dominio ${cleanDomain}`,
      };
    }

    // Standard monolithic backend
    return {
      category: 'core',
      isSelectable: false,
      domainCode: sLower,
      displayName: `Aplicación Principal (${raw.serviceName})`,
      description: raw.commentHeader || 'Servicio principal de backend',
    };
  }

  detectMicroservicesInDirectory(
    projectDir: string,
    containers: ContainerStatInfo[] = []
  ): ProjectMicroservicesSummary {
    const rawServices = this.parseComposeServices(projectDir);
    const persisted = this.readPersistedConfig(projectDir);
    const envEnabled = this.readEnvEnabledMicroservices(projectDir);

    // Build set of enabled tokens if user customized selection
    const activeSelectionList =
      persisted?.enabledMicroservices ?? envEnabled ?? null;
    const normalizedSelectionSet = activeSelectionList
      ? new Set(
          activeSelectionList.map((item) =>
            item
              .toLowerCase()
              .trim()
              .replace(/^(ms|srv)[:_-]/, '')
          )
        )
      : null;

    const coreServices: MicroserviceServiceItem[] = [];
    const microservices: MicroserviceServiceItem[] = [];

    for (const raw of rawServices) {
      const classified = this.classifyComposeService(raw, rawServices.length);
      const subModules = classified.isSelectable
        ? this.discoverSubModulesFromFilesystem(
            projectDir,
            classified.domainCode,
            raw.commentHeader
          )
        : [];

      const matchedContainer = containers.find(
        (c) =>
          c.serviceName.toLowerCase() === raw.serviceName.toLowerCase() ||
          (raw.containerName &&
            c.name.toLowerCase() === raw.containerName.toLowerCase())
      );

      const state: MicroserviceServiceItem['state'] = !matchedContainer
        ? 'not_created'
        : matchedContainer.state === 'running'
        ? 'running'
        : 'stopped';

      const isEnabled = !classified.isSelectable
        ? true
        : normalizedSelectionSet === null
        ? true
        : normalizedSelectionSet.has(classified.domainCode.toLowerCase()) ||
          normalizedSelectionSet.has(raw.serviceName.toLowerCase());

      const item: MicroserviceServiceItem = {
        serviceName: raw.serviceName,
        containerName:
          raw.containerName || matchedContainer?.name || raw.serviceName,
        displayName: classified.displayName,
        domainCode: classified.domainCode,
        category: classified.category,
        isSelectable: classified.isSelectable,
        enabled: isEnabled,
        state,
        port: raw.port || '-',
        description: classified.description,
        subModules,
      };

      if (classified.isSelectable) {
        microservices.push(item);
      } else {
        coreServices.push(item);
      }
    }

    const isMicroservicesArchitecture = microservices.length >= 2;
    const enabledServiceNames = microservices
      .filter((m) => m.enabled)
      .map((m) => m.serviceName);
    const runningMicroservicesCount = microservices.filter(
      (m) => m.state === 'running'
    ).length;

    return {
      isMicroservicesArchitecture,
      architectureType: isMicroservicesArchitecture
        ? 'microservices'
        : 'monolith',
      architectureLabel: isMicroservicesArchitecture
        ? `Clúster de Microservicios (${enabledServiceNames.length}/${microservices.length} integrados)`
        : 'Arquitectura Monolítica / Estándar',
      totalMicroservices: microservices.length,
      enabledMicroservicesCount: enabledServiceNames.length,
      runningMicroservicesCount,
      coreServices,
      microservices,
      enabledServiceNames,
    };
  }

  /**
   * Resuelve qué servicios de docker-compose deben levantarse en `up -d`
   * cuando el proyecto tiene microservicios desactivados selectivamente.
   */
  getComposeTargetServicesForUp(projectDir: string): {
    isMicroservices: boolean;
    isPartialSelection: boolean;
    activeComposeServices: string[];
    disabledComposeServices: string[];
  } {
    const summary = this.detectMicroservicesInDirectory(projectDir, []);
    if (!summary.isMicroservicesArchitecture) {
      return {
        isMicroservices: false,
        isPartialSelection: false,
        activeComposeServices: [],
        disabledComposeServices: [],
      };
    }

    const disabledComposeServices = summary.microservices
      .filter((m) => !m.enabled)
      .map((m) => m.serviceName);

    const activeComposeServices = [
      ...summary.coreServices.map((c) => c.serviceName),
      ...summary.microservices
        .filter((m) => m.enabled)
        .map((m) => m.serviceName),
    ];

    return {
      isMicroservices: true,
      isPartialSelection: disabledComposeServices.length > 0,
      activeComposeServices,
      disabledComposeServices,
    };
  }

  /**
   * Persiste la selección de microservicios en `.alpanel-microservices.json`
   * y sincroniza `ENABLED_MICROSERVICES` dentro del archivo `.env` del proyecto.
   */
  saveSelectionToProjectDir(
    projectDir: string,
    selectedMicroservices: string[]
  ): ProjectMicroservicesSummary {
    const summaryBefore = this.detectMicroservicesInDirectory(projectDir, []);
    const validSelectable = new Set(
      summaryBefore.microservices.map((m) => m.serviceName)
    );

    const normalizedSelected = selectedMicroservices
      .map((s) => String(s).trim())
      .filter((s) => validSelectable.has(s));

    const configPath = this.getConfigFilePath(projectDir);
    const configPayload: PersistedMicroservicesConfig = {
      updatedAt: new Date().toISOString(),
      enabledMicroservices: normalizedSelected,
    };
    fs.writeFileSync(
      configPath,
      JSON.stringify(configPayload, null, 2) + '\n',
      { encoding: 'utf-8', mode: 0o600 }
    );

    // Sincronizar ENABLED_MICROSERVICES en .env
    const envValue =
      normalizedSelected.length === summaryBefore.microservices.length
        ? '*'
        : normalizedSelected.join(',');

    const envPath = path.join(projectDir, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } else if (fs.existsSync(path.join(projectDir, '.env.example'))) {
      envContent = fs.readFileSync(
        path.join(projectDir, '.env.example'),
        'utf-8'
      );
    }

    if (/^ENABLED_MICROSERVICES\s*=.*$/m.test(envContent)) {
      envContent = envContent.replace(
        /^ENABLED_MICROSERVICES\s*=.*$/m,
        `ENABLED_MICROSERVICES=${envValue}`
      );
    } else {
      envContent = `${envContent.trimEnd()}\nENABLED_MICROSERVICES=${envValue}\n`;
    }

    fs.writeFileSync(envPath, envContent, { encoding: 'utf-8', mode: 0o600 });

    return this.detectMicroservicesInDirectory(projectDir, []);
  }

  /**
   * Detecta la arquitectura y microservicios de un repositorio Git remoto
   * antes de clonarlo en el servidor.
   */
  async detectRemoteRepoMicroservices(payload: {
    repoUrl: string;
    branch?: string;
  }): Promise<{
    summary: ProjectMicroservicesSummary;
    suggestedEnvContent: string;
  }> {
    const safeRepoUrl = new GitRepoUrlVO(payload.repoUrl).value;
    const safeBranch = GitRepoUrlVO.sanitizeBranch(payload.branch);
    const branchArg = safeBranch ? `-b "${safeBranch}"` : '';

    const tempDir = path.join(
      os.tmpdir(),
      `alpanel-ms-detect-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    );

    try {
      await execAsync(
        `git -c core.hooksPath=/dev/null clone --depth 1 ${branchArg} "${safeRepoUrl}" "${tempDir}"`,
        { timeout: 60000 }
      );

      const summary = this.detectMicroservicesInDirectory(tempDir, []);
      let suggestedEnvContent = '';
      for (const candidate of ['.env.example', '.env.sample']) {
        const p = path.join(tempDir, candidate);
        if (fs.existsSync(p)) {
          suggestedEnvContent = fs.readFileSync(p, 'utf-8').trim();
          break;
        }
      }

      return { summary, suggestedEnvContent };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  resolveProjectDir(projectName: string): string {
    return new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
  }
}

export const manageProjectMicroservicesUseCase =
  new ManageProjectMicroservicesUseCase();
