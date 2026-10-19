import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { projectsService } from '../../modules/projects/projects.service';

const execAsync = promisify(exec);

export interface AppUserRecord {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
}

export interface AppUsersOverview {
  projectName: string;
  supported: boolean;
  engine: string;
  tableName: string;
  schemaLabel: string;
  hashAlgorithm: string;
  hasEmail: boolean;
  hasRole: boolean;
  hasActive: boolean;
  users: AppUserRecord[];
  message?: string;
}

interface DbExecContext {
  isPostgres: boolean;
  containerName: string;
  appContainerName: string;
  database: string;
  username: string;
  password: string;
  internalPort: string;
}

/**
 * @serviceCode projects.app_users
 * @serviceName Usuarios Internos de cada Sistema
 * @serviceDescription Permite ver, crear, cambiar contraseña/rol y eliminar usuarios propios dentro de la base de datos de cada proyecto alojado (excluyendo ALpanel).
 * @serviceIcon fa-users-rectangle
 * @defaultRoles admin
 */
export class ProjectUsersService {
  private escapeSqlLiteral(val: string): string {
    return String(val ?? '').replace(/'/g, "''");
  }

  private hashDjangoPbkdf2(password: string): string {
    const iterations = 600000;
    const salt = crypto.randomBytes(12).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
    return `pbkdf2_sha256$${iterations}$${salt}$${derived}`;
  }

  private async hashBcrypt(ctx: DbExecContext, password: string): Promise<string> {
    const safePass = this.escapeSqlLiteral(password);
    // 1. Si es PostgreSQL, usar extensión nativa pgcrypto (genera $2a$10$... idéntico a bcryptjs)
    if (ctx.isPostgres) {
      await this.runSql(ctx, 'CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => null);
      const out = await this.runSql(ctx, `SELECT crypt('${safePass}', gen_salt('bf', 10));`);
      if (out && out.startsWith('$2')) {
        return out.trim();
      }
    }

    // 2. Si el proyecto tiene contenedor de aplicación (Node/PHP), usar su bcrypt/password_hash nativo
    if (ctx.appContainerName) {
      const b64 = Buffer.from(password, 'utf-8').toString('base64');
      try {
        const { stdout } = await execAsync(
          `docker exec ${ctx.appContainerName} sh -c 'node -e "const b=require(\\"bcryptjs\\");console.log(b.hashSync(Buffer.from(\\"${b64}\\",\\"base64\\").toString(),10))" 2>/dev/null || php -r "echo password_hash(base64_decode(\\"${b64}\\"), PASSWORD_BCRYPT);" 2>/dev/null'`
        );
        if (stdout && stdout.trim().startsWith('$2')) {
          return stdout.trim();
        }
      } catch {
        // Fallback
      }
    }

    throw new Error('No se pudo generar el hash bcrypt en el contenedor del proyecto.');
  }

  private async resolveDbContext(projectName: string): Promise<DbExecContext> {
    if (projectsService.isSelfPanel(projectName)) {
      throw new Error('Los usuarios de ALpanel se administran desde el módulo Usuarios & Roles del panel.');
    }

    const projects = await projectsService.listProjects();
    const proj = projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase());
    if (!proj) {
      throw new Error(`Proyecto ${projectName} no encontrado.`);
    }

    const db = proj.database;
    if (!db || !db.hasDatabase || !db.containerName || db.containerName === '-') {
      throw new Error(`El proyecto ${proj.name} no tiene un contenedor de base de datos activo.`);
    }

    const isPostgres = db.engine.toLowerCase().includes('postgres');
    const appContainer = (proj.containers || []).find(
      (c) => c.role !== 'database' && c.role !== 'proxy'
    );
    return {
      isPostgres,
      containerName: db.containerName.replace(/[^a-zA-Z0-9._-]/g, ''),
      appContainerName: appContainer ? appContainer.name.replace(/[^a-zA-Z0-9._-]/g, '') : '',
      database: db.database,
      username: isPostgres ? db.username : (db.rootPassword && db.rootPassword !== '-' ? 'root' : db.username),
      password: isPostgres ? db.password : (db.rootPassword && db.rootPassword !== '-' ? db.rootPassword : db.password),
      internalPort: db.internalPort && db.internalPort !== '-' ? db.internalPort : (isPostgres ? '5432' : '3306'),
    };
  }

  private async runSql(ctx: DbExecContext, sql: string): Promise<string> {
    const b64Sql = Buffer.from(sql, 'utf-8').toString('base64');
    const b64Pass = Buffer.from(ctx.password, 'utf-8').toString('base64');

    if (ctx.isPostgres) {
      const cmd = `docker exec ${ctx.containerName} sh -c 'export PGPASSWORD="$(echo ${b64Pass} | base64 -d)"; echo ${b64Sql} | base64 -d | psql -X -U "${ctx.username}" -p "${ctx.internalPort}" -d "${ctx.database}" -t -A -F "|"'`;
      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      return stdout.trim();
    } else {
      const cmd = `docker exec ${ctx.containerName} sh -c 'PASS="$(echo ${b64Pass} | base64 -d)"; SQL="$(echo ${b64Sql} | base64 -d)"; BIN=$(command -v mariadb >/dev/null 2>&1 && echo mariadb || echo mysql); (MYSQL_PWD="$PASS" $BIN -h 127.0.0.1 -P "${ctx.internalPort}" -u "${ctx.username}" -D "${ctx.database}" -N -B -e "$SQL" 2>/dev/null) || (MYSQL_PWD="$PASS" $BIN -u "${ctx.username}" -D "${ctx.database}" -N -B -e "$SQL" 2>/dev/null) || ($BIN -u root -D "${ctx.database}" -N -B -e "$SQL")'`;
      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      return stdout.trim();
    }
  }

  private async detectTableColumns(ctx: DbExecContext, tableName: string): Promise<string[]> {
    const safeTable = this.escapeSqlLiteral(tableName);
    const sql = ctx.isPostgres
      ? `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${safeTable}' ORDER BY ordinal_position;`
      : `SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA = '${this.escapeSqlLiteral(ctx.database)}' AND TABLE_NAME = '${safeTable}' ORDER BY ORDINAL_POSITION;`;

    const out = await this.runSql(ctx, sql);
    if (!out) return [];
    return out
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
  }

  async getProjectUsers(projectName: string): Promise<AppUsersOverview> {
    const ctx = await this.resolveDbContext(projectName);

    // 1. Verificar tabla Django `auth_user`
    const authUserCols = await this.detectTableColumns(ctx, 'auth_user');
    if (authUserCols.includes('username') && authUserCols.includes('password')) {
      const sep = ctx.isPostgres ? '|' : '\t';
      const raw = await this.runSql(
        ctx,
        `SELECT id, username, COALESCE(email, ''), CASE WHEN is_superuser = ${ctx.isPostgres ? 'true' : '1'} THEN 'superuser' WHEN is_staff = ${ctx.isPostgres ? 'true' : '1'} THEN 'staff' ELSE 'user' END, CASE WHEN is_active = ${ctx.isPostgres ? 'true' : '1'} THEN '1' ELSE '0' END FROM auth_user ORDER BY id ASC;`
      );
      const users: AppUserRecord[] = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active] = line.split(sep);
            return {
              id: String(id || '').trim(),
              username: String(username || '').trim(),
              email: String(email || '').trim(),
              role: String(role || 'user').trim(),
              isActive: String(active || '1').trim() === '1',
            };
          })
        : [];

      return {
        projectName,
        supported: true,
        engine: ctx.isPostgres ? 'PostgreSQL' : 'MariaDB / MySQL',
        tableName: 'auth_user',
        schemaLabel: 'Django Auth (auth_user)',
        hashAlgorithm: 'pbkdf2_sha256',
        hasEmail: true,
        hasRole: true,
        hasActive: true,
        users,
      };
    }

    // 2. Verificar tabla `users` (Node/Express como Servidor_Zapatoqueando, o Laravel como Factupos)
    const usersCols = await this.detectTableColumns(ctx, 'users');
    if (
      usersCols.includes('password') &&
      (usersCols.includes('username') ||
        usersCols.includes('name') ||
        usersCols.includes('email'))
    ) {
      const sep = ctx.isPostgres ? '|' : '\t';
      const userCol = usersCols.includes('username')
        ? 'username'
        : usersCols.includes('name')
        ? 'name'
        : 'email';
      const emailExpr = usersCols.includes('email') ? "COALESCE(email, '')" : "''";
      const roleCol = usersCols.includes('role')
        ? 'role'
        : usersCols.includes('roles')
        ? 'roles'
        : null;
      const roleExpr = roleCol ? `COALESCE(${roleCol}, 'admin')` : "'user'";
      const activeExpr = usersCols.includes('is_active')
        ? `CASE WHEN is_active = ${ctx.isPostgres ? 'true' : '1'} THEN '1' ELSE '0' END`
        : "'1'";

      const raw = await this.runSql(
        ctx,
        `SELECT id, ${userCol}, ${emailExpr}, ${roleExpr}, ${activeExpr} FROM users ORDER BY id ASC;`
      );
      const users: AppUserRecord[] = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active] = line.split(sep);
            return {
              id: String(id || '').trim(),
              username: String(username || '').trim(),
              email: String(email || '').trim(),
              role: String(role || 'admin').trim(),
              isActive: String(active || '1').trim() === '1',
            };
          })
        : [];

      return {
        projectName,
        supported: true,
        engine: ctx.isPostgres ? 'PostgreSQL' : 'MariaDB / MySQL',
        tableName: 'users',
        schemaLabel: 'Tabla users (Node.js / Express / Laravel)',
        hashAlgorithm: 'bcrypt ($2a$10$)',
        hasEmail: usersCols.includes('email'),
        hasRole: Boolean(roleCol),
        hasActive: usersCols.includes('is_active'),
        users,
      };
    }

    // 3. Verificar tabla `sf_guard_user` (Symfony 1.4)
    const sfCols = await this.detectTableColumns(ctx, 'sf_guard_user');
    if (sfCols.includes('username') && sfCols.includes('password')) {
      const sep = ctx.isPostgres ? '|' : '\t';
      const raw = await this.runSql(
        ctx,
        `SELECT id, username, '', CASE WHEN is_super_admin = 1 THEN 'superadmin' ELSE 'user' END, CASE WHEN is_active = 1 THEN '1' ELSE '0' END FROM sf_guard_user ORDER BY id ASC LIMIT 200;`
      );
      const users: AppUserRecord[] = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active] = line.split(sep);
            return {
              id: String(id || '').trim(),
              username: String(username || '').trim(),
              email: String(email || '').trim(),
              role: String(role || 'user').trim(),
              isActive: String(active || '1').trim() === '1',
            };
          })
        : [];

      return {
        projectName,
        supported: true,
        engine: ctx.isPostgres ? 'PostgreSQL' : 'MariaDB / MySQL',
        tableName: 'sf_guard_user',
        schemaLabel: 'Symfony 1.4 (sf_guard_user)',
        hashAlgorithm: 'sha1(salt+password)',
        hasEmail: false,
        hasRole: true,
        hasActive: true,
        users,
      };
    }

    return {
      projectName,
      supported: false,
      engine: ctx.isPostgres ? 'PostgreSQL' : 'MariaDB / MySQL',
      tableName: '-',
      schemaLabel: 'Sin tabla de usuarios estándar detectada',
      hashAlgorithm: '-',
      hasEmail: false,
      hasRole: false,
      hasActive: false,
      users: [],
      message: 'No se encontró una tabla de usuarios reconocida (users, auth_user o sf_guard_user) en esta base de datos. Asegúrate de que el contenedor Backend haya ejecutado sus migraciones iniciales.',
    };
  }

  async saveProjectUser(
    projectName: string,
    payload: {
      id?: string;
      username: string;
      email?: string;
      role?: string;
      password?: string;
      isActive?: boolean;
    }
  ): Promise<{ success: boolean; message: string }> {
    const ctx = await this.resolveDbContext(projectName);
    const cleanUser = this.escapeSqlLiteral((payload.username || '').trim());
    const cleanEmail = this.escapeSqlLiteral((payload.email || '').trim());
    const cleanRole = this.escapeSqlLiteral((payload.role || 'admin').trim());
    const rawPass = (payload.password || '').trim();
    const isActive = payload.isActive !== false;

    if (!cleanUser) {
      throw new Error('El nombre de usuario es obligatorio.');
    }

    // 1. Django `auth_user`
    const authUserCols = await this.detectTableColumns(ctx, 'auth_user');
    if (authUserCols.includes('username') && authUserCols.includes('password')) {
      const isSuper = cleanRole === 'superuser' || cleanRole === 'admin' || cleanRole === 'superadmin';
      const isStaff = isSuper || cleanRole === 'staff';
      const boolSuper = ctx.isPostgres ? (isSuper ? 'true' : 'false') : (isSuper ? '1' : '0');
      const boolStaff = ctx.isPostgres ? (isStaff ? 'true' : 'false') : (isStaff ? '1' : '0');
      const boolActive = ctx.isPostgres ? (isActive ? 'true' : 'false') : (isActive ? '1' : '0');

      if (payload.id) {
        const cleanId = Number(payload.id);
        const passClause = rawPass ? `, password = '${this.escapeSqlLiteral(this.hashDjangoPbkdf2(rawPass))}'` : '';
        await this.runSql(
          ctx,
          `UPDATE auth_user SET username = '${cleanUser}', email = '${cleanEmail}', is_superuser = ${boolSuper}, is_staff = ${boolStaff}, is_active = ${boolActive}${passClause} WHERE id = ${cleanId};`
        );
        return { success: true, message: `Usuario @${payload.username} actualizado en auth_user.` };
      } else {
        if (!rawPass) throw new Error('Debes ingresar una contraseña para el nuevo usuario.');
        const hashed = this.escapeSqlLiteral(this.hashDjangoPbkdf2(rawPass));
        const nowExpr = ctx.isPostgres ? 'NOW()' : 'NOW()';
        await this.runSql(
          ctx,
          `INSERT INTO auth_user (password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined) VALUES ('${hashed}', ${boolSuper}, '${cleanUser}', '', '', '${cleanEmail}', ${boolStaff}, ${boolActive}, ${nowExpr});`
        );
        return { success: true, message: `Usuario @${payload.username} creado en auth_user (Django PBKDF2).` };
      }
    }

    // 2. Tabla `users` (Servidor_Zapatoqueando / Node / Laravel)
    const usersCols = await this.detectTableColumns(ctx, 'users');
    if (
      usersCols.includes('password') &&
      (usersCols.includes('username') ||
        usersCols.includes('name') ||
        usersCols.includes('email'))
    ) {
      const userCol = usersCols.includes('username')
        ? 'username'
        : usersCols.includes('name')
        ? 'name'
        : 'email';
      const hasPluralRoles = !usersCols.includes('role') && usersCols.includes('roles');
      const normalizedRoleValue = hasPluralRoles
        ? cleanRole.toLowerCase().includes('admin') || cleanRole.toLowerCase().includes('super')
          ? 'Admin'
          : 'Empleado'
        : cleanRole;

      if (payload.id) {
        const cleanId = Number(payload.id);
        const updates: string[] = [`${userCol} = '${cleanUser}'`];
        if (usersCols.includes('email') && userCol !== 'email') {
          updates.push(`email = '${cleanEmail}'`);
        }
        if (usersCols.includes('role')) {
          updates.push(`role = '${cleanRole}'`);
        } else if (usersCols.includes('roles')) {
          updates.push(`roles = '${normalizedRoleValue}'`);
        }
        if (usersCols.includes('is_active')) {
          updates.push(`is_active = ${ctx.isPostgres ? (isActive ? 'true' : 'false') : (isActive ? '1' : '0')}`);
        }
        if (usersCols.includes('updated_at')) {
          updates.push(`updated_at = NOW()`);
        }
        if (rawPass) {
          const hashed = this.escapeSqlLiteral(await this.hashBcrypt(ctx, rawPass));
          updates.push(`password = '${hashed}'`);
        }
        await this.runSql(ctx, `UPDATE users SET ${updates.join(', ')} WHERE id = ${cleanId};`);
        return { success: true, message: `Usuario ${payload.username} actualizado en ${projectName}.` };
      } else {
        if (!rawPass) throw new Error('Debes ingresar una contraseña para el nuevo usuario.');
        const hashed = this.escapeSqlLiteral(await this.hashBcrypt(ctx, rawPass));
        const cols: string[] = [userCol, 'password'];
        const vals: string[] = [`'${cleanUser}'`, `'${hashed}'`];

        if (usersCols.includes('email') && userCol !== 'email') {
          cols.push('email');
          vals.push(`'${cleanEmail || cleanUser}'`);
        }
        if (usersCols.includes('role')) {
          cols.push('role');
          vals.push(`'${cleanRole || 'admin'}'`);
        } else if (usersCols.includes('roles')) {
          cols.push('roles');
          vals.push(`'${normalizedRoleValue}'`);
        }
        if (usersCols.includes('is_active')) {
          cols.push('is_active');
          vals.push(ctx.isPostgres ? (isActive ? 'true' : 'false') : (isActive ? '1' : '0'));
        }
        if (usersCols.includes('created_at')) {
          cols.push('created_at');
          vals.push('NOW()');
        }
        if (usersCols.includes('updated_at')) {
          cols.push('updated_at');
          vals.push('NOW()');
        }

        await this.runSql(ctx, `INSERT INTO users (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
        return { success: true, message: `Usuario ${payload.username} creado con hash bcrypt en ${projectName}.` };
      }
    }

    // 3. Tabla `sf_guard_user` (Symfony 1.4)
    const sfCols = await this.detectTableColumns(ctx, 'sf_guard_user');
    if (sfCols.includes('username') && sfCols.includes('password')) {
      const isSuper = cleanRole === 'superadmin' || cleanRole === 'admin' ? 1 : 0;
      const activeBit = isActive ? 1 : 0;
      if (payload.id) {
        const cleanId = Number(payload.id);
        let passSql = '';
        if (rawPass) {
          const salt = crypto.randomBytes(8).toString('hex');
          const sha1 = crypto.createHash('sha1').update(salt + rawPass).digest('hex');
          passSql = `, algorithm = 'sha1', salt = '${salt}', password = '${sha1}'`;
        }
        await this.runSql(
          ctx,
          `UPDATE sf_guard_user SET username = '${cleanUser}', is_super_admin = ${isSuper}, is_active = ${activeBit}${passSql} WHERE id = ${cleanId};`
        );
        return { success: true, message: `Usuario @${payload.username} actualizado en sf_guard_user.` };
      } else {
        if (!rawPass) throw new Error('Debes ingresar una contraseña para el nuevo usuario.');
        const salt = crypto.randomBytes(8).toString('hex');
        const sha1 = crypto.createHash('sha1').update(salt + rawPass).digest('hex');
        await this.runSql(
          ctx,
          `INSERT INTO sf_guard_user (username, algorithm, salt, password, is_active, is_super_admin, created_at, updated_at) VALUES ('${cleanUser}', 'sha1', '${salt}', '${sha1}', ${activeBit}, ${isSuper}, NOW(), NOW());`
        );
        return { success: true, message: `Usuario @${payload.username} creado en sf_guard_user.` };
      }
    }

    throw new Error('Este proyecto no cuenta con una tabla de usuarios compatible.');
  }

  async deleteProjectUser(projectName: string, userId: string): Promise<{ success: boolean; message: string }> {
    const ctx = await this.resolveDbContext(projectName);
    const cleanId = Number(userId);
    if (!cleanId) throw new Error('ID de usuario inválido.');

    const authUserCols = await this.detectTableColumns(ctx, 'auth_user');
    if (authUserCols.includes('username')) {
      // En Django auth_user, limpiar permisos M2M antes de borrar el usuario si existen
      await this.runSql(ctx, `DELETE FROM auth_user_groups WHERE user_id = ${cleanId};`).catch(() => null);
      await this.runSql(ctx, `DELETE FROM auth_user_user_permissions WHERE user_id = ${cleanId};`).catch(() => null);
      await this.runSql(ctx, `DELETE FROM auth_user WHERE id = ${cleanId};`);
      return { success: true, message: `Usuario #${cleanId} eliminado de auth_user.` };
    }

    const usersCols = await this.detectTableColumns(ctx, 'users');
    if (usersCols.includes('password')) {
      await this.runSql(ctx, `DELETE FROM users WHERE id = ${cleanId};`);
      return { success: true, message: `Usuario #${cleanId} eliminado de users.` };
    }

    const sfCols = await this.detectTableColumns(ctx, 'sf_guard_user');
    if (sfCols.includes('username')) {
      await this.runSql(ctx, `DELETE FROM sf_guard_user WHERE id = ${cleanId};`);
      return { success: true, message: `Usuario #${cleanId} eliminado de sf_guard_user.` };
    }

    throw new Error('No se encontró tabla de usuarios en este proyecto.');
  }
}

export const projectUsersService = new ProjectUsersService();
