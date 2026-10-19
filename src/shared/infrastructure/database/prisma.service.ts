import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import {
  cryptoService,
  hashPassword,
  verifyPasswordHash,
} from '../services/crypto.service';
import {
  PANEL_MODULE_REGISTRY,
  PANEL_STANDALONE_SERVICES,
} from '../services/service-registry';

export { hashPassword, verifyPasswordHash };

dotenv.config();
if (fs.existsSync('/opt/alpanel/.env')) {
  dotenv.config({ path: '/opt/alpanel/.env' });
}

export function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const host = process.env.DB_HOST || process.env.PANEL_DB_HOST || 'panel_db';
  const port = Number(process.env.DB_PORT || 3306);
  const user = encodeURIComponent(
    process.env.MYSQL_USER || process.env.DB_USER || process.env.PANEL_DB_USER || 'alpanel_user'
  );
  const password = encodeURIComponent(
    process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || process.env.PANEL_DB_PASSWORD || 'alpanel_pass'
  );
  const database = encodeURIComponent(
    process.env.MYSQL_DATABASE || process.env.DB_NAME || process.env.PANEL_DB_NAME || 'alpanel_db'
  );
  const url = `mysql://${user}:${password}@${host}:${port}/${database}`;
  process.env.DATABASE_URL = url;
  return url;
}

const dbUrl = buildDatabaseUrl();

function ensurePrismaClientInstalled(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url: dbUrl } } });
  } catch {
    console.log('⚙️ Inicializando motor Prisma ORM por primera vez en el contenedor...');
    const selfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel';
    const appDir = process.cwd();
    try {
      if (fs.existsSync(path.join(selfDir, 'prisma')) && !fs.existsSync(path.join(appDir, 'prisma'))) {
        execSync(`cp -rf "${selfDir}/prisma" "${appDir}/" && cp -f "${selfDir}/package.json" "${appDir}/package.json"`, {
          stdio: 'inherit',
        });
      }
      execSync('apk add --no-cache openssl 2>/dev/null || true', { stdio: 'inherit' });
      execSync('npm install --no-audit --no-fund && npx prisma generate', {
        cwd: appDir,
        stdio: 'inherit',
      });
    } catch (e) {
      console.error('Error auto-instalando Prisma Client:', e);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient({ datasources: { db: { url: dbUrl } } });
  }
}

export const prisma: any = ensurePrismaClientInstalled();

export const SYSTEM_MODULES = [
  ...PANEL_MODULE_REGISTRY.flatMap((mod, modIdx) => {
    const baseOrder = (modIdx + 1) * 100;
    const parentEntry = {
      code: mod.code,
      name: mod.name,
      description: mod.description,
      icon: mod.icon,
      sortOrder: baseOrder,
      defaultRoles: mod.defaultRoles,
    };
    const serviceEntries = mod.services.map((svc, svcIdx) => ({
      code: svc.code,
      name: svc.name,
      description: svc.description,
      icon: svc.icon,
      sortOrder: baseOrder + svcIdx + 1,
      defaultRoles: svc.defaultRoles,
    }));
    return [parentEntry, ...serviceEntries];
  }),
  ...PANEL_STANDALONE_SERVICES.map((svc, idx) => ({
    code: svc.code,
    name: svc.name,
    description: svc.description,
    icon: svc.icon,
    sortOrder: 900 + idx + 1,
    defaultRoles: svc.defaultRoles,
  })),
];

export async function initDatabase(): Promise<void> {
  let retries = 25;
  while (retries > 0) {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      break;
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error('Error conectando Prisma ORM a MariaDB 11:', err);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS modules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NOT NULL DEFAULT '',
      icon VARCHAR(60) NOT NULL DEFAULT 'fa-cube',
      sort_order INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      role_id INT NOT NULL,
      module_id INT NOT NULL,
      can_view TINYINT(1) NOT NULL DEFAULT 0,
      can_create TINYINT(1) NOT NULL DEFAULT 0,
      can_edit TINYINT(1) NOT NULL DEFAULT 0,
      can_delete TINYINT(1) NOT NULL DEFAULT 0,
      can_deploy TINYINT(1) NOT NULL DEFAULT 0,
      UNIQUE KEY role_permissions_role_id_module_id_key (role_id, module_id),
      INDEX role_permissions_module_id_idx (module_id),
      CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      CONSTRAINT fk_rp_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL DEFAULT '',
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'admin',
      role_id INT NULL,
      last_login DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX users_role_id_idx (role_id),
      CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(150) NOT NULL DEFAULT '' AFTER username`).catch(() => null);
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER role`).catch(() => null);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS domain_routes (
      id VARCHAR(64) PRIMARY KEY,
      domain VARCHAR(190) NOT NULL UNIQUE,
      project_name VARCHAR(120) NOT NULL,
      frontend_target VARCHAR(190) NOT NULL,
      api_path_prefix VARCHAR(120) NOT NULL DEFAULT '',
      backend_target VARCHAR(190) NOT NULL DEFAULT '',
      ssl_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      target VARCHAR(255) NOT NULL,
      ip VARCHAR(100) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'ok',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS panel_settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await prisma.module
    .deleteMany({
      where: { code: { in: ['project_db', 'project_env'] } },
    })
    .catch(() => null);

  await Promise.all(
    SYSTEM_MODULES.map((mod) =>
      prisma.module.upsert({
        where: { code: mod.code },
        update: {
          name: mod.name,
          description: mod.description,
          icon: mod.icon,
          sortOrder: mod.sortOrder,
        },
        create: {
          code: mod.code,
          name: mod.name,
          description: mod.description,
          icon: mod.icon,
          sortOrder: mod.sortOrder,
        },
      })
    )
  );

  const superRole = await prisma.role.upsert({
    where: { code: 'superadmin' },
    update: {
      name: 'Super Administrador',
      description: 'Propietario principal del servidor (Rol único e intransferible con control total)',
    },
    create: {
      code: 'superadmin',
      name: 'Super Administrador',
      description: 'Propietario principal del servidor (Rol único e intransferible con control total)',
    },
  });

  const nonSuperCount = await prisma.role.count({
    where: { code: { not: 'superadmin' } },
  });

  if (nonSuperCount === 0) {
    await prisma.role.createMany({
      data: [
        {
          code: 'admin',
          name: 'Administrador',
          description: 'Administración general de proyectos, dominios, bases de datos y usuarios',
        },
        {
          code: 'developer',
          name: 'Desarrollador',
          description: 'Modo Desarrollador (develop), reinicio de contenedores, logs y lectura/edición de proyectos',
        },
        {
          code: 'viewer',
          name: 'Auditor / Lectura',
          description: 'Visualización de proyectos, dominios y auditoría sin servicios de modificación',
        },
      ],
      skipDuplicates: true,
    });
  }

  const [allModules, allRoles, existingRolePerms] = await Promise.all([
    prisma.module.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.role.findMany(),
    prisma.rolePermission.findMany(),
  ]);

  const existingPermKeys = new Set<string>(
    existingRolePerms.map((rp: any) => `${rp.roleId}:${rp.moduleId}`)
  );

  const permsToCreate: Array<{
    roleId: number;
    moduleId: number;
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canDeploy: boolean;
  }> = [];

  for (const role of allRoles) {
    for (const mod of allModules) {
      const key = `${role.id}:${mod.id}`;
      if (existingPermKeys.has(key)) continue;

      if (role.code === 'superadmin') {
        permsToCreate.push({
          roleId: role.id,
          moduleId: mod.id,
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canDeploy: true,
        });
        continue;
      }

      const regItem = SYSTEM_MODULES.find((item) => item.code === mod.code);
      const isEnabledByDefault = regItem
        ? regItem.defaultRoles.includes(role.code as any)
        : role.code === 'admin';

      permsToCreate.push({
        roleId: role.id,
        moduleId: mod.id,
        canView: isEnabledByDefault,
        canCreate: isEnabledByDefault,
        canEdit: isEnabledByDefault,
        canDelete: isEnabledByDefault,
        canDeploy: isEnabledByDefault,
      });
    }
  }

  if (permsToCreate.length > 0) {
    await prisma.rolePermission.createMany({
      data: permsToCreate,
      skipDuplicates: true,
    });
  }

  const totalUsers = await prisma.user.count();
  if (totalUsers === 0) {
    const initialPass = process.env.PANEL_PASSWORD || 'admin123';
    await prisma.user.create({
      data: {
        username: 'superadmin',
        fullName: 'Super Administrador',
        passwordHash: cryptoService.hashPassword(initialPass),
        role: 'superadmin',
        roleId: superRole.id,
      },
    });
    console.log(`✅ Usuario principal 'superadmin' registrado con Prisma ORM en MariaDB.`);
  } else {
    const firstUser = await prisma.user.findFirst({ orderBy: { id: 'asc' } });
    if (firstUser) {
      await prisma.user.updateMany({
        where: { username: 'superadmin', id: { not: firstUser.id } },
        data: { username: `user_${Date.now()}` },
      });
      await prisma.user.update({
        where: { id: firstUser.id },
        data: {
          username: 'superadmin',
          fullName:
            firstUser.fullName && firstUser.fullName !== 'Administrador Principal'
              ? firstUser.fullName
              : 'Super Administrador',
          role: 'superadmin',
          roleId: superRole.id,
        },
      });
    }

    const adminRole = await prisma.role.findUnique({ where: { code: 'admin' } });
    if (firstUser && adminRole) {
      await prisma.user.updateMany({
        where: {
          id: { not: firstUser.id },
          OR: [{ role: 'superadmin' }, { roleId: superRole.id }],
        },
        data: {
          role: 'admin',
          roleId: adminRole.id,
        },
      });
    }
  }

  try {
    const routeCount = await prisma.domainRoute.count();
    const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    const legacyDomainsFile = path.join(dataDir, 'domains.json');
    if (routeCount === 0 && fs.existsSync(legacyDomainsFile)) {
      const parsed = JSON.parse(fs.readFileSync(legacyDomainsFile, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const r of parsed) {
          if (!r?.domain) continue;
          const cleanDomain = String(r.domain).trim().toLowerCase();
          await prisma.domainRoute.upsert({
            where: { domain: cleanDomain },
            update: {
              projectName: String(r.projectName || '').trim(),
              frontendTarget: String(r.frontendTarget || '').trim(),
              apiPathPrefix: String(r.apiPathPrefix || '').trim(),
              backendTarget: String(r.backendTarget || '').trim(),
              sslEnabled: r.sslEnabled !== false,
            },
            create: {
              id: String(r.id || `route-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
              domain: cleanDomain,
              projectName: String(r.projectName || '').trim(),
              frontendTarget: String(r.frontendTarget || '').trim(),
              apiPathPrefix: String(r.apiPathPrefix || '').trim(),
              backendTarget: String(r.backendTarget || '').trim(),
              sslEnabled: r.sslEnabled !== false,
            },
          });
        }
        console.log(`✅ Migradas ${parsed.length} rutas de dominios desde domains.json a MariaDB (Prisma).`);
      }
    }
  } catch (err) {
    console.warn('Aviso migrando domains.json a Prisma:', err);
  }
}
