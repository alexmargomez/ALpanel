import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const host = process.env.PANEL_DB_HOST || 'panel_db';
  const port = Number(process.env.PANEL_DB_PORT || 3306);
  const user = encodeURIComponent(process.env.PANEL_DB_USER || 'alpanel');
  const password = encodeURIComponent(process.env.PANEL_DB_PASSWORD || 'alpanel_secret_2026');
  const database = encodeURIComponent(process.env.PANEL_DB_NAME || 'alpanel_db');
  const url = `mysql://${user}:${password}@${host}:${port}/${database}`;
  process.env.DATABASE_URL = url;
  return url;
}

buildDatabaseUrl();

export const prisma = new PrismaClient();

export function hashPassword(password: string, salt?: string): string {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return `${useSalt}:${derived}`;
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export const SYSTEM_MODULES = [
  {
    code: 'projects',
    name: 'Proyectos & Docker',
    description: 'Tarjetas de proyectos, contenedores, variables .env, logs y respaldos SQL',
    icon: 'fa-cubes',
    sortOrder: 1,
  },
  {
    code: 'git',
    name: 'Despliegue Git & Modo Dev',
    description: 'Clonar repositorios, Git Pull & Restart (main) y Modo Desarrollador (develop)',
    icon: 'fa-code-branch',
    sortOrder: 2,
  },
  {
    code: 'domains',
    name: 'Dominios & Proxy SSL',
    description: 'Rutas de dominios, subdominios y certificados HTTPS automáticos en Caddy',
    icon: 'fa-globe',
    sortOrder: 3,
  },
  {
    code: 'users',
    name: 'Usuarios, Roles & Permisos',
    description: 'Administración de cuentas de usuario, roles y matriz de permisos RBAC',
    icon: 'fa-users-gear',
    sortOrder: 4,
  },
  {
    code: 'security',
    name: 'Seguridad & Auditoría',
    description: 'Bitácora de auditoría en MariaDB, estado del firewall y mantenimiento Docker',
    icon: 'fa-shield-halved',
    sortOrder: 5,
  },
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

  // Asegurar tablas compatibles con bases existentes sin requerir intervención manual
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

  // 1. Semilla de Módulos del sistema con Prisma
  for (const mod of SYSTEM_MODULES) {
    await prisma.module.upsert({
      where: { code: mod.code },
      update: {
        name: mod.name,
        description: mod.description,
        icon: mod.icon,
        sortOrder: mod.sortOrder,
      },
      create: mod,
    });
  }

  // 2. Semilla de Roles base con Prisma
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
          description: 'Gestión de despliegues, Modo Desarrollador (develop), logs y variables .env',
        },
        {
          code: 'viewer',
          name: 'Auditor / Lectura',
          description: 'Visualización de métricas, estado de contenedores y auditoría sin permisos de modificación',
        },
      ],
      skipDuplicates: true,
    });
  }

  // 3. Semilla de Matriz de Permisos por Rol y Módulo (RBAC)
  const allModules = await prisma.module.findMany({ orderBy: { sortOrder: 'asc' } });
  const allRoles = await prisma.role.findMany();

  for (const role of allRoles) {
    for (const mod of allModules) {
      if (role.code === 'superadmin') {
        await prisma.rolePermission.upsert({
          where: { roleId_moduleId: { roleId: role.id, moduleId: mod.id } },
          update: {
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: true,
            canDeploy: true,
          },
          create: {
            roleId: role.id,
            moduleId: mod.id,
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: true,
            canDeploy: true,
          },
        });
        continue;
      }

      const existingPerm = await prisma.rolePermission.findUnique({
        where: { roleId_moduleId: { roleId: role.id, moduleId: mod.id } },
      });
      if (existingPerm) continue;

      let defaults = {
        canView: true,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canDeploy: false,
      };

      if (role.code === 'admin') {
        defaults = {
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canDeploy: true,
        };
      } else if (role.code === 'developer') {
        if (mod.code === 'projects' || mod.code === 'git') {
          defaults = {
            canView: true,
            canCreate: true,
            canEdit: true,
            canDelete: false,
            canDeploy: true,
          };
        } else if (mod.code === 'domains') {
          defaults = {
            canView: true,
            canCreate: false,
            canEdit: false,
            canDelete: false,
            canDeploy: false,
          };
        } else {
          defaults = {
            canView: false,
            canCreate: false,
            canEdit: false,
            canDelete: false,
            canDeploy: false,
          };
        }
      } else if (role.code === 'viewer') {
        defaults = {
          canView: mod.code !== 'users',
          canCreate: false,
          canEdit: false,
          canDelete: false,
          canDeploy: false,
        };
      }

      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          moduleId: mod.id,
          ...defaults,
        },
      });
    }
  }

  // 4. Asegurar que el primer usuario sea 'superadmin' con rol único 'superadmin'
  const totalUsers = await prisma.user.count();
  if (totalUsers === 0) {
    const initialPass = process.env.PANEL_PASSWORD || 'admin123';
    await prisma.user.create({
      data: {
        username: 'superadmin',
        fullName: 'Super Administrador',
        passwordHash: hashPassword(initialPass),
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

    // Reasignar cualquier otro usuario que tuviera 'superadmin' al rol 'admin'
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

  // 5. Migrar rutas de data/domains.json a MariaDB (domain_routes) si la tabla está vacía
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
