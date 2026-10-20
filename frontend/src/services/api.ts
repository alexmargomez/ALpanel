import type { ContainerStatInfo, DiscoveredCatalog } from '../types/panel';

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatUptime(sec: number | undefined | null): string {
  const s = sec || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

export function generateCryptoHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function injectSecretInEnvText(
  currentText: string,
  keyName = 'JWT_SECRET',
  byteLength = 32
): string {
  const secret = generateCryptoHex(byteLength);
  const current = currentText.trim();
  const regex = new RegExp(`^${keyName}\\s*=.*$`, 'm');

  if (regex.test(current)) {
    return current.replace(regex, `${keyName}=${secret}`);
  }
  return current ? `${current}\n${keyName}=${secret}` : `${keyName}=${secret}`;
}

export function injectDbPasswordInEnvText(currentText: string): {
  text: string;
  keyUpdated: string;
} {
  const pass = `db_${generateCryptoHex(12)}`;
  const current = currentText.trim();

  if (/^POSTGRES_PASSWORD\s*=.*$/m.test(current)) {
    return {
      text: current.replace(/^POSTGRES_PASSWORD\s*=.*$/m, `POSTGRES_PASSWORD=${pass}`),
      keyUpdated: 'POSTGRES_PASSWORD',
    };
  }
  if (/^MYSQL_PASSWORD\s*=.*$/m.test(current)) {
    return {
      text: current.replace(/^MYSQL_PASSWORD\s*=.*$/m, `MYSQL_PASSWORD=${pass}`),
      keyUpdated: 'MYSQL_PASSWORD',
    };
  }
  if (/^DB_PASSWORD\s*=.*$/m.test(current)) {
    return {
      text: current.replace(/^DB_PASSWORD\s*=.*$/m, `DB_PASSWORD=${pass}`),
      keyUpdated: 'DB_PASSWORD',
    };
  }
  return {
    text: current ? `${current}\nDB_PASSWORD=${pass}` : `DB_PASSWORD=${pass}`,
    keyUpdated: 'DB_PASSWORD',
  };
}

export function extractContainerInternalTarget(container: ContainerStatInfo): string {
  let internalPort = '3000';
  if (Array.isArray(container.ports) && container.ports.length > 0) {
    const firstPort = String(container.ports[0]);
    const arrowMatch = /->(\d+)/.exec(firstPort);
    const numMatch = /(\d+)/.exec(firstPort);
    if (arrowMatch) {
      internalPort = arrowMatch[1];
    } else if (numMatch) {
      internalPort = numMatch[1];
    }
  } else if (container.name.includes('django')) {
    internalPort = '8000';
  } else if (container.name.includes('alpanel')) {
    internalPort = '9000';
  }
  return `${container.name}:${internalPort}`;
}

export const DEFAULT_CATALOG: DiscoveredCatalog = {
  modules: [
    {
      code: 'projects',
      name: 'Proyectos & Contenedores',
      description: 'Acceso al panel de proyectos alojados, telemetría de contenedores y acciones Docker',
      icon: 'fa-layer-group',
      services: [
        { code: 'projects.logs', name: 'Ver Consola de Logs', icon: 'fa-terminal', serviceFile: 'src/services/projects/container-logs.service.ts' },
        { code: 'projects.restart_cache', name: 'Reiniciar Docker / Limpiar Caché', icon: 'fa-rotate', serviceFile: 'src/services/projects/container-restart.service.ts' },
        { code: 'projects.stop_rebuild', name: 'Detener / Iniciar / Rebuild Servidor', icon: 'fa-power-off', serviceFile: 'src/services/projects/container-power.service.ts' },
        { code: 'projects.db_view', name: 'Ver Credenciales Base de Datos', icon: 'fa-database', serviceFile: 'src/services/projects/project-db.service.ts' },
        { code: 'projects.db_backup', name: 'Descargar Backup .SQL', icon: 'fa-download', serviceFile: 'src/services/projects/project-db.service.ts' },
        { code: 'projects.env_view', name: 'Ver Archivo .env', icon: 'fa-eye', serviceFile: 'src/services/projects/project-env.service.ts' },
        { code: 'projects.env_edit', name: 'Editar y Guardar .env', icon: 'fa-key', serviceFile: 'src/services/projects/project-env.service.ts' },
        { code: 'projects.git_pull', name: 'Git Pull (Producción main)', icon: 'fa-cloud-arrow-down', serviceFile: 'src/services/projects/git-deploy.service.ts' },
        { code: 'projects.app_users', name: 'Gestionar Usuarios Internos de cada App', icon: 'fa-users-rectangle', serviceFile: 'src/services/projects/project-users.service.ts' },
      ],
    },
    {
      code: 'domains',
      name: 'Dominios & Proxy SSL',
      description: 'Acceso a la pestaña de dominios y certificados automáticos Let’s Encrypt (Caddy)',
      icon: 'fa-globe',
      services: [
        { code: 'domains.manage', name: 'Administrar Dominios SSL', icon: 'fa-globe', serviceFile: 'src/services/domains/caddy-ssl.service.ts' },
      ],
    },
    {
      code: 'git',
      name: 'Guía Multi-Stack & Git',
      description: 'Acceso a la guía de arquitectura y clonación de nuevos proyectos desde Git',
      icon: 'fa-code-branch',
      services: [
        { code: 'git.clone', name: 'Clonar Nuevo Proyecto Git', icon: 'fa-code-branch', serviceFile: 'src/services/git/git-clone.service.ts' },
      ],
    },
    {
      code: 'users',
      name: 'Usuarios & Roles',
      description: 'Acceso a las pestañas de Usuarios, Roles y Matriz de Permisos',
      icon: 'fa-users-gear',
      services: [
        { code: 'users.manage', name: 'Gestionar Usuarios y Roles', icon: 'fa-user-shield', serviceFile: 'src/services/users/users-roles.service.ts' },
      ],
    },
    {
      code: 'security',
      name: 'Auditoría de Eventos',
      description: 'Permiso de módulo completo: Consulta de bitácora de seguridad (sin sub-servicios)',
      icon: 'fa-shield-halved',
      services: [],
    },
  ],
  standaloneServices: [
    {
      code: 'services.docker_prune',
      name: 'Limpiar Caché Global Docker del VPS',
      icon: 'fa-broom',
      serviceFile: 'src/services/docker-prune.service.ts',
    },
  ],
  ignoreConfig: {
    ignoredModules: ['auth', 'dashboard', 'roles', 'permissions'],
    ignoredServices: ['service-registry.ts', 'crypto.service.ts', 'host.service.ts'],
  },
};
