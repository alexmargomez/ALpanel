import fs from 'fs';
import path from 'path';

export interface ServiceDefinition {
  /** Código único del permiso de servicio (ej. `projects.db_view` o `services.docker_prune`) */
  code: string;
  /** Nombre legible que aparece en las tarjetas de permisos del rol */
  name: string;
  /** Descripción breve de lo que permite hacer este servicio */
  description: string;
  /** Ícono FontAwesome (ej. `fa-database`) */
  icon: string;
  /** Ruta relativa del archivo en `src/services/` */
  serviceFile: string;
  /** Indica si es un servicio independiente (fuera de carpetas de módulos) */
  isStandalone?: boolean;
  /** Roles predeterminados que tienen activo este servicio al inicializar por primera vez */
  defaultRoles: Array<'admin' | 'developer' | 'viewer'>;
}

export interface ModuleDefinition {
  /** Código único del módulo (ej. `projects`, `domains`, `git`, `users`, `security`) */
  code: string;
  /** Nombre visible del módulo */
  name: string;
  /** Descripción del módulo */
  description: string;
  /** Ícono FontAwesome */
  icon: string;
  /** Orden de aparición en el panel */
  sortOrder: number;
  /** Roles predeterminados con acceso al módulo */
  defaultRoles: Array<'admin' | 'developer' | 'viewer'>;
  /**
   * Sub-servicios pertenecientes a este módulo (`src/services/<modulo>/*.service.ts`).
   * Si está vacío (`[]`), el permiso del módulo aplica al MÓDULO COMPLETO.
   */
  services: ServiceDefinition[];
}

export interface PermissionsIgnoreConfig {
  ignoredModules: string[];
  ignoredServices: string[];
}

const DEFAULT_IGNORE_CONFIG: PermissionsIgnoreConfig = {
  ignoredModules: ['auth', 'dashboard', 'roles', 'permissions'],
  ignoredServices: ['service-registry.ts', 'crypto.service.ts', 'host.service.ts'],
};

export function loadPermissionsIgnoreConfig(): PermissionsIgnoreConfig {
  const candidates = [
    path.join(process.cwd(), 'src', 'config', 'permissions.ignore.json'),
    path.join(__dirname, '..', 'config', 'permissions.ignore.json'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return {
          ignoredModules: Array.isArray(raw.ignoredModules)
            ? raw.ignoredModules
            : DEFAULT_IGNORE_CONFIG.ignoredModules,
          ignoredServices: Array.isArray(raw.ignoredServices)
            ? raw.ignoredServices
            : DEFAULT_IGNORE_CONFIG.ignoredServices,
        };
      }
    } catch {
      // Fallback to default
    }
  }
  return DEFAULT_IGNORE_CONFIG;
}

const BASE_MODULES_CATALOG: ModuleDefinition[] = [
  {
    code: 'projects',
    name: 'Proyectos & Contenedores',
    description: 'Acceso al panel de proyectos alojados, telemetría de contenedores y acciones Docker',
    icon: 'fa-layer-group',
    sortOrder: 1,
    defaultRoles: ['admin', 'developer', 'viewer'],
    services: [
      {
        code: 'projects.logs',
        name: 'Ver Consola de Logs',
        description: 'Inspeccionar logs en tiempo real de los contenedores',
        icon: 'fa-terminal',
        serviceFile: 'src/services/projects/container-logs.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.restart_cache',
        name: 'Reiniciar Docker / Limpiar Caché',
        description: 'Reiniciar contenedores y limpiar caché de aplicación del proyecto',
        icon: 'fa-rotate',
        serviceFile: 'src/services/projects/container-restart.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.stop_rebuild',
        name: 'Detener / Iniciar / Rebuild Servidor',
        description: 'Detener contenedores, iniciarlos o reconstruir imágenes Docker',
        icon: 'fa-power-off',
        serviceFile: 'src/services/projects/container-power.service.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.db_view',
        name: 'Ver Credenciales Base de Datos',
        description: 'Ver usuarios, contraseñas, puertos y URL de conexión SQL del proyecto',
        icon: 'fa-database',
        serviceFile: 'src/services/projects/project-db.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.db_backup',
        name: 'Descargar Backup .SQL',
        description: 'Exportar y descargar volcado .SQL en caliente de la base de datos',
        icon: 'fa-download',
        serviceFile: 'src/services/projects/project-db.service.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.env_view',
        name: 'Ver Archivo .env',
        description: 'Abrir y leer las variables de entorno (.env) del proyecto',
        icon: 'fa-eye',
        serviceFile: 'src/services/projects/project-env.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.env_edit',
        name: 'Editar y Guardar .env',
        description: 'Modificar y guardar variables .env en el servidor',
        icon: 'fa-key',
        serviceFile: 'src/services/projects/project-env.service.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.dev_mode',
        name: 'Modo Desarrollador (develop)',
        description: 'Activar o apagar entorno aislado de pruebas en rama develop',
        icon: 'fa-flask',
        serviceFile: 'src/services/projects/git-devmode.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.git_pull',
        name: 'Git Pull & Restart (Producción main)',
        description: 'Actualizar código en producción (rama main) con rollback automático',
        icon: 'fa-cloud-arrow-down',
        serviceFile: 'src/services/projects/git-deploy.service.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.app_users',
        name: 'Usuarios Internos de cada Sistema',
        description: 'Ver, crear, cambiar contraseña/rol y eliminar usuarios dentro de la BD de cada proyecto alojado',
        icon: 'fa-users-rectangle',
        serviceFile: 'src/services/projects/project-users.service.ts',
        defaultRoles: ['admin'],
      },
    ],
  },
  {
    code: 'domains',
    name: 'Dominios & Proxy SSL',
    description: 'Acceso a la pestaña de dominios y certificados automáticos Let’s Encrypt (Caddy)',
    icon: 'fa-globe',
    sortOrder: 2,
    defaultRoles: ['admin', 'developer', 'viewer'],
    services: [
      {
        code: 'domains.manage',
        name: 'Administrar Dominios SSL',
        description: 'Crear, editar o eliminar rutas de dominios y recargar Caddy SSL',
        icon: 'fa-globe',
        serviceFile: 'src/services/domains/caddy-ssl.service.ts',
        defaultRoles: ['admin'],
      },
    ],
  },
  {
    code: 'git',
    name: 'Guía Multi-Stack & Git',
    description: 'Acceso a la guía de arquitectura y clonación de nuevos proyectos desde Git',
    icon: 'fa-code-branch',
    sortOrder: 3,
    defaultRoles: ['admin', 'developer', 'viewer'],
    services: [
      {
        code: 'git.clone',
        name: 'Clonar Nuevo Proyecto Git',
        description: 'Clonar nuevos repositorios en /opt/projects y levantar su stack Docker',
        icon: 'fa-code-branch',
        serviceFile: 'src/services/git/git-clone.service.ts',
        defaultRoles: ['admin'],
      },
    ],
  },
  {
    code: 'users',
    name: 'Usuarios & Roles',
    description: 'Acceso a las pestañas de Usuarios, Roles y Matriz de Permisos',
    icon: 'fa-users-gear',
    sortOrder: 4,
    defaultRoles: ['admin'],
    services: [
      {
        code: 'users.manage',
        name: 'Gestionar Usuarios y Roles',
        description: 'Crear, editar o eliminar usuarios y modificar los servicios de cada rol',
        icon: 'fa-user-shield',
        serviceFile: 'src/services/users/users-roles.service.ts',
        defaultRoles: ['admin'],
      },
    ],
  },
  {
    code: 'security',
    name: 'Auditoría de Eventos',
    description: 'Permiso de módulo completo: Consulta de bitácora de seguridad e historial de acciones (sin sub-servicios)',
    icon: 'fa-shield-halved',
    sortOrder: 5,
    defaultRoles: ['admin', 'developer', 'viewer'],
    services: [], // Sin sub-servicios -> el permiso del módulo controla el módulo completo
  },
];

const BASE_STANDALONE_SERVICES: ServiceDefinition[] = [
  {
    code: 'services.docker_prune',
    name: 'Limpiar Caché Global Docker del VPS',
    description: 'Servicio independiente: Ejecuta Docker System & Builder Prune para liberar espacio SSD',
    icon: 'fa-broom',
    serviceFile: 'src/services/docker-prune.service.ts',
    isStandalone: true,
    defaultRoles: ['admin'],
  },
];

function humanizeSlug(slug: string): string {
  return slug
    .replace(/\.service\.(ts|js)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function parseServiceFileMetadata(
  fullPath: string,
  defaultCode: string,
  defaultName: string,
  relFile: string,
  isStandalone: boolean
): ServiceDefinition {
  let code = defaultCode;
  let name = defaultName;
  let description = isStandalone
    ? `Servicio independiente detectado automáticamente (${relFile})`
    : `Servicio de módulo detectado automáticamente (${relFile})`;
  let icon = isStandalone ? 'fa-gears' : 'fa-bolt';
  let defaultRoles: Array<'admin' | 'developer' | 'viewer'> = ['admin'];

  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 1200);
      const codeMatch = content.match(/@serviceCode\s+([^\r\n*]+)/);
      const nameMatch = content.match(/@serviceName\s+([^\r\n*]+)/);
      const descMatch = content.match(/@serviceDescription\s+([^\r\n*]+)/);
      const iconMatch = content.match(/@serviceIcon\s+([^\r\n*]+)/);
      const rolesMatch = content.match(/@defaultRoles\s+([^\r\n*]+)/);
      if (codeMatch?.[1]) code = codeMatch[1].trim();
      if (nameMatch?.[1]) name = nameMatch[1].trim();
      if (descMatch?.[1]) description = descMatch[1].trim();
      if (iconMatch?.[1]) icon = iconMatch[1].trim();
      if (rolesMatch?.[1]) {
        defaultRoles = rolesMatch[1]
          .split(',')
          .map((s) => s.trim() as any)
          .filter(Boolean);
      }
    }
  } catch {
    // Use defaults
  }

  return {
    code,
    name,
    description,
    icon,
    serviceFile: relFile,
    isStandalone,
    defaultRoles,
  };
}

/**
 * Escanea automáticamente `src/modules/` y `src/services/` respetando `src/config/permissions.ignore.json`.
 * - Cualquier carpeta nueva en `src/modules/<mod>` (que no esté en `ignoredModules`) se agrega como Módulo.
 * - Cualquier archivo nuevo en `src/services/<mod>/*.service.ts` (que no esté en `ignoredServices`) se agrega como Sub-Servicio del módulo `<mod>`.
 * - Cualquier archivo nuevo en `src/services/*.service.ts` fuera de carpetas de módulos (y que no esté en `ignoredServices`) se agrega como Servicio Independiente.
 */
export function discoverModulesAndServices(): {
  modules: ModuleDefinition[];
  standaloneServices: ServiceDefinition[];
  ignoreConfig: PermissionsIgnoreConfig;
} {
  const ignoreConfig = loadPermissionsIgnoreConfig();
  const ignoredModsSet = new Set(ignoreConfig.ignoredModules.map((m) => m.toLowerCase()));
  const ignoredSvcsSet = new Set(
    ignoreConfig.ignoredServices.flatMap((s) => {
      const clean = s.replace(/^src\/services\//, '').toLowerCase();
      return [
        clean,
        clean.replace(/\.ts$/, '.js'),
        path.basename(clean),
        path.basename(clean).replace(/\.ts$/, '.js'),
      ];
    })
  );

  const modules: ModuleDefinition[] = BASE_MODULES_CATALOG.filter(
    (m) => !ignoredModsSet.has(m.code.toLowerCase())
  ).map((m) => ({
    ...m,
    services: m.services.filter((s) => {
      const rel = s.serviceFile.replace(/^src\/services\//, '').toLowerCase();
      return !ignoredSvcsSet.has(rel) && !ignoredSvcsSet.has(path.basename(rel));
    }),
  }));

  const standaloneServices: ServiceDefinition[] = BASE_STANDALONE_SERVICES.filter((s) => {
    const rel = s.serviceFile.replace(/^src\/services\//, '').toLowerCase();
    return !ignoredSvcsSet.has(rel) && !ignoredSvcsSet.has(path.basename(rel));
  });

  const srcRoot = fs.existsSync(path.join(process.cwd(), 'src', 'services'))
    ? path.join(process.cwd(), 'src')
    : path.join(__dirname, '..');

  const modulesDir = path.join(srcRoot, 'modules');
  const servicesDir = path.join(srcRoot, 'services');

  // 1. Auto-descubrir nuevos Módulos en `src/modules/`
  if (fs.existsSync(modulesDir)) {
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const modCode = entry.name.toLowerCase();
      if (ignoredModsSet.has(modCode)) continue;
      if (!modules.some((m) => m.code.toLowerCase() === modCode)) {
        modules.push({
          code: modCode,
          name: `Módulo ${humanizeSlug(modCode)}`,
          description: `Módulo detectado automáticamente en src/modules/${modCode}`,
          icon: 'fa-cube',
          sortOrder: modules.length + 1,
          defaultRoles: ['admin'],
          services: [],
        });
      }
    }
  }

  // 2. Auto-descubrir Servicios de Módulos (`src/services/<modulo>/*.service.*`) y Servicios Independientes (`src/services/*.service.*`)
  if (fs.existsSync(servicesDir)) {
    const entries = fs.readdirSync(servicesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        const folderName = entry.name.toLowerCase();
        if (ignoredModsSet.has(folderName)) continue;

        let targetMod = modules.find((m) => m.code.toLowerCase() === folderName);
        if (!targetMod) {
          targetMod = {
            code: folderName,
            name: `Módulo ${humanizeSlug(folderName)}`,
            description: `Módulo asociado a src/services/${folderName}`,
            icon: 'fa-cube',
            sortOrder: modules.length + 1,
            defaultRoles: ['admin'],
            services: [],
          };
          modules.push(targetMod);
        }

        const subDir = path.join(servicesDir, entry.name);
        const subFiles = fs.readdirSync(subDir);
        for (const f of subFiles) {
          if (!/\.service\.(ts|js)$/i.test(f)) continue;
          const relCheck = `${folderName}/${f}`.toLowerCase();
          if (ignoredSvcsSet.has(relCheck) || ignoredSvcsSet.has(f.toLowerCase())) continue;

          const normalizedTsRel = `src/services/${folderName}/${f.replace(/\.js$/i, '.ts')}`;
          const alreadyRegistered = targetMod.services.some(
            (s) => s.serviceFile.toLowerCase() === normalizedTsRel.toLowerCase()
          );
          if (!alreadyRegistered) {
            const slug = f
              .replace(/\.service\.(ts|js)$/i, '')
              .replace(/[^a-zA-Z0-9]+/g, '_')
              .toLowerCase();
            const meta = parseServiceFileMetadata(
              path.join(subDir, f),
              `${folderName}.${slug}`,
              humanizeSlug(f),
              normalizedTsRel,
              false
            );
            targetMod.services.push(meta);
          }
        }
      } else if (entry.isFile() && /\.service\.(ts|js)$/i.test(entry.name)) {
        const fileName = entry.name;
        if (ignoredSvcsSet.has(fileName.toLowerCase())) continue;

        const normalizedTsRel = `src/services/${fileName.replace(/\.js$/i, '.ts')}`;
        const alreadyRegistered = standaloneServices.some(
          (s) => s.serviceFile.toLowerCase() === normalizedTsRel.toLowerCase()
        );
        if (!alreadyRegistered) {
          const slug = fileName
            .replace(/\.service\.(ts|js)$/i, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .toLowerCase();
          const meta = parseServiceFileMetadata(
            path.join(servicesDir, fileName),
            `services.${slug}`,
            humanizeSlug(fileName),
            normalizedTsRel,
            true
          );
          standaloneServices.push(meta);
        }
      }
    }
  }

  return { modules, standaloneServices, ignoreConfig };
}

export const PANEL_MODULE_REGISTRY: ModuleDefinition[] = discoverModulesAndServices().modules;
export const PANEL_STANDALONE_SERVICES: ServiceDefinition[] =
  discoverModulesAndServices().standaloneServices;
