import mysql from 'mysql2/promise';
import crypto from 'crypto';

export interface PanelUser {
  id: number;
  username: string;
  role: string;
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
      host: process.env.DB_HOST || 'db',
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

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        last_login DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

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

    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as total FROM users');
    const total = Number(rows?.[0]?.total || 0);
    if (total === 0) {
      const initialUser = (process.env.PANEL_USER || 'admin').trim();
      const initialPass = process.env.PANEL_PASSWORD || 'admin123';
      const hashed = this.hashPassword(initialPass);
      await this.pool.query(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [initialUser, hashed, 'admin']
      );
      console.log(`✅ Usuario administrador inicial '${initialUser}' registrado en MySQL con hash scrypt.`);
    }
  }

  async verifyUserCredentials(username: string, password: string): Promise<{ valid: boolean; user?: PanelUser }> {
    try {
      const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
        'SELECT id, username, password_hash, role, last_login, created_at FROM users WHERE username = ? LIMIT 1',
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
          role: row.role,
          lastLogin: new Date().toISOString(),
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        },
      };
    } catch (err) {
      console.error('Error validando credenciales en BD:', err);
      return { valid: false };
    }
  }

  async listUsers(): Promise<PanelUser[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      'SELECT id, username, role, last_login, created_at FROM users ORDER BY id ASC'
    );
    return (rows || []).map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      lastLogin: r.last_login ? new Date(r.last_login).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));
  }

  async createUser(username: string, password: string, role = 'admin'): Promise<PanelUser> {
    const cleanUser = (username || '').trim();
    if (!cleanUser || cleanUser.length < 3) {
      throw new Error('El nombre de usuario debe tener al menos 3 caracteres.');
    }
    if (!password || password.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }
    const hashed = this.hashPassword(password);
    const [res] = await this.pool.query<mysql.ResultSetHeader>(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [cleanUser, hashed, role]
    );
    return {
      id: res.insertId,
      username: cleanUser,
      role,
      lastLogin: null,
      createdAt: new Date().toISOString(),
    };
  }

  async changePassword(username: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
    }
    const hashed = this.hashPassword(newPassword);
    await this.pool.query('UPDATE users SET password_hash = ? WHERE username = ?', [hashed, username.trim()]);
  }

  async deleteUser(id: number): Promise<void> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as total FROM users');
    if (Number(rows?.[0]?.total || 0) <= 1) {
      throw new Error('No puedes eliminar el único usuario administrador del panel.');
    }
    await this.pool.query('DELETE FROM users WHERE id = ?', [id]);
  }

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
      return (rows || []).map((r) => ({
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
