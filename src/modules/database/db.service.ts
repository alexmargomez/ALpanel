import mysql from 'mysql2/promise';
import crypto from 'crypto';

export interface PanelRole {
  id: number;
  code: string;
  name: string;
  description: string;
  usersCount?: number;
  createdAt: string;
}

export interface PanelUser {
  id: number;
  username: string;
  fullName: string;
  roleId: number | null;
  role: string;
  roleName: string;
  lastLogin: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id?: number;
  time: string;
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
}

export class DbService {
  private pool: mysql.Pool;

  constructor() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST || 'panel_db',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.MYSQL_USER || process.env.DB_USER || 'alpanel_user',
      password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || 'alpanel_pass',
      database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'alpanel_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  private hashPassword(password: string, salt?: string): string {
    const useSalt = salt || crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
    return `${useSalt}:${derived}`;
  }

  private verifyPasswordHash(password: string, storedHash: string): boolean {
    const [salt, key] = (storedHash || '').split(':');
    if (!salt || !key) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(key, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  }

  async init(): Promise<void> {
    let retries = 25;
    while (retries > 0) {
      try {
        const conn = await this.pool.getConnection();
        conn.release();
        break;
      } catch (err) {
        retries--;
        if (retries === 0) {
          console.error('Error conectando a la base de datos de ALpanel:', err);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // 1. Tabla de Roles
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Asegurar rol único 'superadmin' y semilla inicial de roles
    await this.pool.query(`
      INSERT IGNORE INTO roles (code, name, description) VALUES
      ('superadmin', 'Super Administrador', 'Propietario principal del servidor (Rol único e intransferible)')
    `);

    const [roleCountRows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM roles WHERE code != 'superadmin'"
    );
    if (Number(roleCountRows?.[0]?.total || 0) === 0) {
      await this.pool.query(`
        INSERT IGNORE INTO roles (code, name, description) VALUES
        ('admin', 'Administrador', 'Administración general de proyectos, dominios, bases de datos y usuarios'),
        ('developer', 'Desarrollador', 'Gestión de despliegues, Modo Desarrollador (develop), logs y caché'),
        ('viewer', 'Auditor / Lectura', 'Visualización de métricas, estado de contenedores y auditoría')
      `);
    }

    // 3. Tabla de Usuarios
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        full_name VARCHAR(150) NOT NULL DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        role_id INT NULL,
        last_login DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migraciones suaves para bases de datos ya existentes
    await this.pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(150) NOT NULL DEFAULT '' AFTER username`).catch(() => null);
    await this.pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER role`).catch(() => null);

    // 4. Tabla de Auditoría
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        target VARCHAR(255) NOT NULL,
        ip VARCHAR(100) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'ok',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Obtener ID del rol único superadmin
    const [superRoleRows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM roles WHERE code = 'superadmin' LIMIT 1"
    );
    const superRoleId = superRoleRows?.[0]?.id || null;

    // 5. Usuario Super Administrador inicial (si no existe ningún usuario) o migración del primer usuario a 'superadmin'
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as total FROM users');
    const total = Number(rows?.[0]?.total || 0);
    if (total === 0) {
      const initialPass = process.env.PANEL_PASSWORD || 'admin123';
      const hashed = this.hashPassword(initialPass);
      await this.pool.query(
        'INSERT INTO users (username, full_name, password_hash, role, role_id) VALUES (?, ?, ?, ?, ?)',
        ['superadmin', 'Super Administrador', hashed, 'superadmin', superRoleId]
      );
      console.log(`✅ Usuario principal 'superadmin' registrado en MariaDB con rol único Super Administrador.`);
    } else {
      // Asegurar que el primer usuario (ORDER BY id ASC LIMIT 1) sea siempre 'superadmin' con el rol único 'superadmin'
      const [firstUsers] = await this.pool.query<mysql.RowDataPacket[]>(
        'SELECT id, username, full_name FROM users ORDER BY id ASC LIMIT 1'
      );
      if (firstUsers && firstUsers.length > 0) {
        const first = firstUsers[0];
        const newFullName =
          !first.full_name || first.full_name === 'admin' || first.full_name === 'Administrador Principal'
            ? 'Super Administrador'
            : first.full_name;
        await this.pool
          .query(
            'UPDATE users SET username = ?, full_name = ?, role = ?, role_id = ? WHERE id = ?',
            ['superadmin', newFullName, 'superadmin', superRoleId, first.id]
          )
          .catch(() => null);
      }
    }

    // Sincronizar role_id y full_name de cualquier otro usuario existente
    await this.pool
      .query(`
        UPDATE users u
        INNER JOIN roles r ON r.code = u.role
        SET u.role_id = r.id
        WHERE u.role_id IS NULL
      `)
      .catch(() => null);
    await this.pool
      .query(`UPDATE users SET full_name = username WHERE full_name = '' OR full_name IS NULL`)
      .catch(() => null);
  }

  async verifyUserCredentials(username: string, password: string): Promise<{ valid: boolean; user?: PanelUser }> {
    try {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        `SELECT u.id, u.username, u.full_name, u.password_hash, u.role, u.role_id,
                r.code as role_code, r.name as role_name, u.last_login, u.created_at
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.username = ? LIMIT 1`,
        [username.trim()]
      );
      if (!rows || rows.length === 0) {
        return { valid: false };
      }
      const row = rows[0];
      const ok = this.verifyPasswordHash(password, row.password_hash);
      if (!ok) {
        return { valid: false };
      }

      await this.pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [row.id]);
      return {
        valid: true,
        user: {
          id: row.id,
          username: row.username,
          fullName: row.full_name || row.username,
          roleId: row.role_id || null,
          role: row.role_code || row.role || 'admin',
          roleName: row.role_name || row.role || 'Administrador',
          lastLogin: new Date().toISOString(),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        },
      };
    } catch (err) {
      console.error('Error validando credenciales en BD:', err);
      return { valid: false };
    }
  }

  // ==================== CRUD DE USUARIOS ====================

  async listUsers(): Promise<PanelUser[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT u.id, u.username, u.full_name, u.role, u.role_id,
              r.code as role_code, r.name as role_name, u.last_login, u.created_at
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`
    );
    return (rows || []).map((r: any) => ({
      id: r.id,
      username: r.username,
      fullName: r.full_name || r.username,
      roleId: r.role_id || null,
      role: r.role_code || r.role || 'admin',
      roleName: r.role_name || r.role || 'Administrador',
      lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));
  }

  async createUser(payload: {
    username: string;
    fullName: string;
    password: string;
    roleId?: number;
  }): Promise<PanelUser> {
    const cleanUser = (payload.username || '').trim();
    const cleanName = (payload.fullName || '').trim() || cleanUser;
    if (!cleanUser || cleanUser.length < 3) {
      throw new Error('El nombre de usuario (username) debe tener al menos 3 caracteres.');
    }
    if (cleanUser.toLowerCase() === 'superadmin') {
      throw new Error("El nombre de usuario 'superadmin' está reservado para el usuario principal.");
    }
    if (!payload.password || payload.password.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }

    let roleId: number | null = payload.roleId ? Number(payload.roleId) : null;
    let roleCode = 'admin';
    let roleName = 'Administrador';

    if (roleId) {
      const [rRows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT id, code, name FROM roles WHERE id = ? LIMIT 1', [roleId]);
      if (!rRows || rRows.length === 0) {
        throw new Error('El rol seleccionado no existe.');
      }
      if (rRows[0].code === 'superadmin') {
        throw new Error("El rol 'Super Administrador' es único del primer usuario y no puede asignarse a otros usuarios.");
      }
      roleCode = rRows[0].code;
      roleName = rRows[0].name;
    } else {
      const [rRows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT id, code, name FROM roles WHERE code = 'admin' LIMIT 1");
      if (rRows && rRows.length > 0) {
        roleId = rRows[0].id;
        roleCode = rRows[0].code;
        roleName = rRows[0].name;
      }
    }

    const hashed = this.hashPassword(payload.password);
    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(
        'INSERT INTO users (username, full_name, password_hash, role, role_id) VALUES (?, ?, ?, ?, ?)',
        [cleanUser, cleanName, hashed, roleCode, roleId]
      );
      return {
        id: res.insertId,
        username: cleanUser,
        fullName: cleanName,
        roleId,
        role: roleCode,
        roleName,
        lastLogin: null,
        createdAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(`El usuario '${cleanUser}' ya existe.`);
      }
      throw err;
    }
  }

  async updateUser(
    id: number,
    payload: {
      username: string;
      fullName: string;
      password?: string;
      roleId?: number;
    }
  ): Promise<PanelUser> {
    const userId = Number(id);
    if (!userId) throw new Error('ID de usuario inválido.');

    const [existingRows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT id, username, role, role_id FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!existingRows || existingRows.length === 0) {
      throw new Error('Usuario no encontrado.');
    }
    const existing = existingRows[0];
    const isSuperAdminUser = existing.role === 'superadmin' || existing.username === 'superadmin';

    const cleanUser = isSuperAdminUser ? 'superadmin' : (payload.username || '').trim();
    const cleanName = (payload.fullName || '').trim() || cleanUser;
    if (!cleanUser || cleanUser.length < 3) {
      throw new Error('El nombre de usuario (username) debe tener al menos 3 caracteres.');
    }
    if (!isSuperAdminUser && cleanUser.toLowerCase() === 'superadmin') {
      throw new Error("El nombre de usuario 'superadmin' está reservado para el usuario principal.");
    }

    let roleId: number | null = existing.role_id;
    let roleCode: string = existing.role;

    if (isSuperAdminUser) {
      // El primer usuario conserva siempre su rol único 'superadmin'
      const [sRows] = await this.pool.query<mysql.RowDataPacket[]>(
        "SELECT id, code FROM roles WHERE code = 'superadmin' LIMIT 1"
      );
      roleId = sRows?.[0]?.id || existing.role_id;
      roleCode = 'superadmin';
    } else if (payload.roleId) {
      const [rRows] = await this.pool.query<mysql.RowDataPacket[]>(
        'SELECT id, code, name FROM roles WHERE id = ? LIMIT 1',
        [Number(payload.roleId)]
      );
      if (!rRows || rRows.length === 0) {
        throw new Error('El rol seleccionado no existe.');
      }
      if (rRows[0].code === 'superadmin') {
        throw new Error("El rol 'Super Administrador' es único del primer usuario y no puede asignarse a otros usuarios.");
      }
      roleId = rRows[0].id;
      roleCode = rRows[0].code;
    }

    try {
      if (payload.password && payload.password.trim().length > 0) {
        if (payload.password.trim().length < 6) {
          throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
        }
        const hashed = this.hashPassword(payload.password.trim());
        await this.pool.query(
          'UPDATE users SET username = ?, full_name = ?, password_hash = ?, role = ?, role_id = ? WHERE id = ?',
          [cleanUser, cleanName, hashed, roleCode, roleId, userId]
        );
      } else {
        await this.pool.query(
          'UPDATE users SET username = ?, full_name = ?, role = ?, role_id = ? WHERE id = ?',
          [cleanUser, cleanName, roleCode, roleId, userId]
        );
      }
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(`El nombre de usuario '${cleanUser}' ya está en uso.`);
      }
      throw err;
    }

    const users = await this.listUsers();
    const updated = users.find((u) => u.id === userId);
    if (!updated) throw new Error('Usuario no encontrado tras actualizar.');
    return updated;
  }

  async changePassword(username: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
    }
    const hashed = this.hashPassword(newPassword);
    await this.pool.query('UPDATE users SET password_hash = ? WHERE username = ?', [hashed, username.trim()]);
  }

  async deleteUser(id: number): Promise<void> {
    const userId = Number(id);
    const [targetRows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT id, username, role FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (targetRows && targetRows.length > 0) {
      if (targetRows[0].role === 'superadmin' || targetRows[0].username === 'superadmin') {
        throw new Error('El usuario Super Administrador principal es único y no puede ser eliminado.');
      }
    }
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as total FROM users');
    if (Number(rows?.[0]?.total || 0) <= 1) {
      throw new Error('No puedes eliminar el único usuario registrado en el panel.');
    }
    await this.pool.query('DELETE FROM users WHERE id = ?', [userId]);
  }

  // ==================== CRUD DE ROLES ====================

  async listRoles(): Promise<PanelRole[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT r.id, r.code, r.name, r.description, r.created_at, COUNT(u.id) as users_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
       GROUP BY r.id, r.code, r.name, r.description, r.created_at
       ORDER BY CASE WHEN r.code = 'superadmin' THEN 0 ELSE 1 END, r.id ASC`
    );
    return (rows || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description || '',
      usersCount: Number(r.users_count || 0),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));
  }

  async createRole(payload: { code: string; name: string; description?: string }): Promise<PanelRole> {
    const cleanCode = (payload.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cleanName = (payload.name || '').trim();
    const cleanDesc = (payload.description || '').trim();

    if (!cleanCode || cleanCode.length < 2) {
      throw new Error('El código del rol debe tener al menos 2 caracteres alfanuméricos (ej. soporte).');
    }
    if (cleanCode === 'superadmin') {
      throw new Error("El rol 'superadmin' es único del sistema.");
    }
    if (!cleanName) {
      throw new Error('El nombre del rol es obligatorio.');
    }

    try {
      const [res] = await this.pool.query<mysql.ResultSetHeader>(
        'INSERT INTO roles (code, name, description) VALUES (?, ?, ?)',
        [cleanCode, cleanName, cleanDesc]
      );
      return {
        id: res.insertId,
        code: cleanCode,
        name: cleanName,
        description: cleanDesc,
        usersCount: 0,
        createdAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(`Ya existe un rol con el código '${cleanCode}'.`);
      }
      throw err;
    }
  }

  async updateRole(id: number, payload: { code: string; name: string; description?: string }): Promise<PanelRole> {
    const roleId = Number(id);
    if (!roleId) throw new Error('ID de rol inválido.');

    const [existingRole] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT code FROM roles WHERE id = ? LIMIT 1',
      [roleId]
    );
    if (existingRole?.[0]?.code === 'superadmin') {
      throw new Error("El rol 'Super Administrador' es único del sistema y no puede ser modificado.");
    }

    const cleanCode = (payload.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cleanName = (payload.name || '').trim();
    const cleanDesc = (payload.description || '').trim();

    if (!cleanCode || cleanCode.length < 2) {
      throw new Error('El código del rol debe tener al menos 2 caracteres alfanuméricos.');
    }
    if (cleanCode === 'superadmin') {
      throw new Error("No puedes usar el código reservado 'superadmin'.");
    }
    if (!cleanName) {
      throw new Error('El nombre del rol es obligatorio.');
    }

    try {
      await this.pool.query(
        'UPDATE roles SET code = ?, name = ?, description = ? WHERE id = ?',
        [cleanCode, cleanName, cleanDesc, roleId]
      );
      await this.pool.query('UPDATE users SET role = ? WHERE role_id = ?', [cleanCode, roleId]);
    } catch (err: any) {
      if (err?.code === 'ER_DUP_ENTRY') {
        throw new Error(`Ya existe otro rol con el código '${cleanCode}'.`);
      }
      throw err;
    }

    const roles = await this.listRoles();
    const updated = roles.find((r) => r.id === roleId);
    if (!updated) throw new Error('Rol no encontrado.');
    return updated;
  }

  async deleteRole(id: number): Promise<void> {
    const roleId = Number(id);
    const [existingRole] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT code FROM roles WHERE id = ? LIMIT 1',
      [roleId]
    );
    if (existingRole?.[0]?.code === 'superadmin') {
      throw new Error("El rol 'Super Administrador' es único del sistema y no puede ser eliminado.");
    }

    const [usedRows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM users WHERE role_id = ?',
      [roleId]
    );
    if (Number(usedRows?.[0]?.total || 0) > 0) {
      throw new Error('No puedes eliminar este rol porque tiene usuarios asignados actualmente.');
    }

    const [totalRoles] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as total FROM roles');
    if (Number(totalRoles?.[0]?.total || 0) <= 1) {
      throw new Error('Debe existir al menos un rol en el sistema.');
    }

    await this.pool.query('DELETE FROM roles WHERE id = ?', [roleId]);
  }

  // ==================== AUDITORÍA ====================

  async insertAuditLog(action: string, target: string, ip: string, status: 'ok' | 'error'): Promise<void> {
    try {
      await this.pool.query(
        'INSERT INTO audit_logs (action, target, ip, status) VALUES (?, ?, ?, ?)',
        [action, target, ip, status]
      );
    } catch {}
  }

  async getAuditLogs(limit = 150): Promise<AuditLogEntry[]> {
    try {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        'SELECT id, action, target, ip, status, created_at FROM audit_logs ORDER BY id DESC LIMIT ?',
        [Number(limit) || 150]
      );
      return (rows || []).map((r: any) => ({
        id: r.id,
        time: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        action: r.action,
        target: r.target,
        ip: r.ip,
        status: r.status === 'error' ? 'error' : 'ok',
      }));
    } catch {
      return [];
    }
  }
}
