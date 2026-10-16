import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { cryptoService } from '../services/crypto.service';

dotenv.config();

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

buildDatabaseUrl();

function ensurePrismaClientInstalled(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require('@prisma/client');
    return new PrismaClient();
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
    return new PrismaClient();
  }
}

export const prisma: any = ensurePrismaClientInstalled();

export const hashPassword = (password: string, salt?: string) =>
  cryptoService.hashPassword(password, salt);

export const verifyPasswordHash = (password: string, storedHash: string) =>
  cryptoService.verifyPasswordHash(password, storedHash);

export const SYSTEM_MODULES = [
  {
    code: 'projects',
    name: 'Proyectos & Contenedores Docker',
    description: 'Ver proyectos (Ver) • Ver Logs (Editar) • Restart/Caché (Desplegar) • Detener/Iniciar/Rebuild Servidor (Eliminar)',
    icon: 'fa-cubes',
    sortOrder: 1,
  },
  {
    code: 'project_db',
    name: 'Servicio: Base de Datos de Proyectos',
    description: 'Ver contraseñas y conexión DB del proyecto (Ver) • Descargar Backup .SQL (Desplegar)',
    icon: 'fa-database',
    sortOrder: 2,
  },
  {
    code: 'project_env',
    name: 'Servicio: Variables de Entorno (.env)',
    description: 'Abrir y leer variables .env (Ver) • Modificar y guardar archivo .env (Editar)',
    icon: 'fa-key',
    sortOrder: 3,
  },
  {
    code: 'git',
    name: 'Servicio: Despliegue Git & Modo Dev',
    description: 'Ver Guía/Remoto (Ver) • Clonar Proyecto (Crear) • Modo Desarrollador develop (Editar) • Git Pull Producción main (Desplegar)',
    icon: 'fa-code-branch',
    sortOrder: 4,
  },
  {
    code: 'domains',
    name: 'Dominios & Proxy SSL (Caddy)',
    description: 'Ver dominios y Caddyfile (Ver) • Crear ruta SSL (Crear) • Eliminar ruta SSL (Eliminar)',
    icon: 'fa-globe',
    sortOrder: 5,
  },
  {
    code: 'users',
    name: 'Usuarios, Roles & Matriz de Permisos',
    description: 'Ver usuarios y permisos (Ver) • Crear usuario/rol (Crear) • Editar permisos y cuentas (Editar) • Eliminar (Eliminar)',
    icon: 'fa-users-gear',
    sortOrder: 6,
  },
  {
    code: 'security',
    name: 'Seguridad, Auditoría & Caché VPS',
    description: 'Ver bitácora de Auditoría (Ver) • Ejecutar Limpiar Caché Docker del Servidor (Desplegar)',
    icon: 'fa-shield-halved',
    sortOrder: 7,
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

  // 1. Semilla de los 7 Módulos y Servicios granulares
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
          description: 'Modo Desarrollador (develop), reinicio de contenedores, logs y edición de .env (sin detener el servidor ni ver contraseñas DB)',
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

  // 3. Semilla de Matriz de Permisos por Rol y Servicio (RBAC)
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
        if (mod.code === 'projects') {
          defaults = {
            canView: true,
            canCreate: false,
            canEdit: true, // Ver Logs
            canDelete: false, // NO puede Detener el servidor ni Rebuild
            canDeploy: true, // Sí puede Restart y Limpiar Caché
          };
        } else if (mod.code === 'project_db') {
          defaults = {
            canView: false, // NO ve credenciales de Base de Datos por defecto
            canCreate: false,
            canEdit: false,
            canDelete: false,
            canDeploy: false,
          };
        } else if (mod.code === 'project_env') {
          defaults = {
            canView: true,
            canCreate: false,
            canEdit: true,
            canDelete: false,
            canDeploy: false,
          };
        } else if (mod.code === 'git') {
          defaults = {
            canView: true,
            canCreate: false,
            canEdit: true, // Sí puede usar Modo Desarrollador (develop)
            canDelete: false,
            canDeploy: false, // Git Pull en producción (main) reservado salvo que se le autorice
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
          canView: ['projects', 'domains', 'security'].includes(mod.code),
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
