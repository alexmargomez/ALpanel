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
  /** Ruta relativa del caso de uso o adaptador asociado */
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
   * Sub-servicios pertenecientes a este módulo.
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
  ignoredServices: ['service-registry.ts', 'crypto.service.ts', 'host-metrics.service.ts'],
};

export function loadPermissionsIgnoreConfig(): PermissionsIgnoreConfig {
  const candidates = [
    path.join(process.cwd(), 'src', 'config', 'permissions.ignore.json'),
    path.join(__dirname, '..', '..', '..', 'config', 'permissions.ignore.json'),
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
        serviceFile: 'src/modules/projects/application/use-cases/manage-container-power.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.restart_cache',
        name: 'Reiniciar Docker / Limpiar Caché',
        description: 'Reiniciar contenedores y limpiar caché de aplicación del proyecto',
        icon: 'fa-rotate',
        serviceFile: 'src/modules/projects/application/use-cases/manage-container-power.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.stop_rebuild',
        name: 'Detener / Iniciar / Rebuild Servidor',
        description: 'Detener contenedores, iniciarlos o reconstruir imágenes Docker',
        icon: 'fa-power-off',
        serviceFile: 'src/modules/projects/application/use-cases/manage-container-power.use-case.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.db_view',
        name: 'Ver Credenciales Base de Datos',
        description: 'Ver usuarios, contraseñas, puertos y URL de conexión SQL del proyecto',
        icon: 'fa-database',
        serviceFile: 'src/modules/projects/application/use-cases/manage-project-db.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.db_backup',
        name: 'Descargar Backup .SQL',
        description: 'Exportar y descargar volcado .SQL en caliente de la base de datos',
        icon: 'fa-download',
        serviceFile: 'src/modules/projects/application/use-cases/manage-project-db.use-case.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.env_view',
        name: 'Ver Archivo .env',
        description: 'Abrir y leer las variables de entorno (.env) del proyecto',
        icon: 'fa-eye',
        serviceFile: 'src/modules/projects/application/use-cases/manage-project-env.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.env_edit',
        name: 'Editar y Guardar .env',
        description: 'Modificar y guardar variables .env en el servidor',
        icon: 'fa-key',
        serviceFile: 'src/modules/projects/application/use-cases/manage-project-env.use-case.ts',
        defaultRoles: ['admin'],
      },
      {
        code: 'projects.dev_mode',
        name: 'Modo Desarrollador (develop)',
        description: 'Activar o apagar entorno aislado de pruebas en rama develop',
        icon: 'fa-flask',
        serviceFile: 'src/modules/projects/application/use-cases/toggle-dev-mode.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.git_pull',
        name: 'Git Pull & Restart (Producción main)',
        description: 'Actualizar código en producción (rama main) con rollback automático',
        icon: 'fa-cloud-arrow-down',
        serviceFile: 'src/modules/projects/application/use-cases/deploy-git-project.use-case.ts',
        defaultRoles: ['admin', 'developer'],
      },
      {
        code: 'projects.app_users',
        name: 'Usuarios Internos de cada Sistema',
        description: 'Ver, crear, cambiar contraseña/rol y eliminar usuarios dentro de la BD de cada proyecto alojado',
        icon: 'fa-users-rectangle',
        serviceFile: 'src/modules/projects/application/use-cases/manage-project-app-users.use-case.ts',
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
        serviceFile: 'src/modules/domains/application/use-cases/manage-domains.use-case.ts',
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
        serviceFile: 'src/modules/git/application/use-cases/manage-git.use-case.ts',
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
        serviceFile: 'src/modules/users/application/use-cases/manage-users.use-case.ts',
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
    services: [],
  },
];

const BASE_STANDALONE_SERVICES: ServiceDefinition[] = [
  {
    code: 'services.docker_prune',
    name: 'Limpiar Caché Global Docker del VPS',
    description: 'Servicio independiente: Ejecuta Docker System & Builder Prune para liberar espacio SSD',
    icon: 'fa-broom',
    serviceFile: 'src/shared/infrastructure/services/host-metrics.service.ts',
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

let cachedCatalog: {
  modules: ModuleDefinition[];
  standaloneServices: ServiceDefinition[];
  ignoreConfig: PermissionsIgnoreConfig;
} | null = null;

/**
 * Descubre los módulos hexagonales en `src/modules/` y combina con el catálogo RBAC base
 * respetando `src/config/permissions.ignore.json`.
 */
export function discoverModulesAndServices(forceRescan = false): {
  modules: ModuleDefinition[];
  standaloneServices: ServiceDefinition[];
  ignoreConfig: PermissionsIgnoreConfig;
} {
  if (cachedCatalog && !forceRescan) {
    return cachedCatalog;
  }

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
      const rel = s.serviceFile.toLowerCase();
      return !ignoredSvcsSet.has(rel) && !ignoredSvcsSet.has(path.basename(rel));
    }),
  }));

  const standaloneServices: ServiceDefinition[] = BASE_STANDALONE_SERVICES.filter((s) => {
    const rel = s.serviceFile.toLowerCase();
    return !ignoredSvcsSet.has(rel) && !ignoredSvcsSet.has(path.basename(rel));
  });

  const srcRoot = fs.existsSync(path.join(process.cwd(), 'src', 'modules'))
    ? path.join(process.cwd(), 'src')
    : path.join(__dirname, '..', '..', '..');

  const modulesDir = path.join(srcRoot, 'modules');

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

  cachedCatalog = { modules, standaloneServices, ignoreConfig };
  return cachedCatalog;
}

const initialCatalog = discoverModulesAndServices();
export const PANEL_MODULE_REGISTRY: ModuleDefinition[] = initialCatalog.modules;
export const PANEL_STANDALONE_SERVICES: ServiceDefinition[] = initialCatalog.standaloneServices;
