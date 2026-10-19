import fs from 'fs';
import path from 'path';
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
  knownPassword?: string;
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
  projectDir: string;
  isPostgres: boolean;
  containerName: string;
  appContainerName: string;
  appContainerNames: string[];
  database: string;
  username: string;
  password: string;
  internalPort: string;
}

interface VaultEntry {
  cipher: string;
  iv: string;
  tag: string;
  hashPrefix: string;
  updatedAt: string;
}

/**
 * @serviceCode projects.app_users
 * @serviceName Usuarios Internos de cada Sistema
 * @serviceDescription Permite ver, crear, cambiar contraseña/rol y eliminar usuarios propios dentro de la base de datos de cada proyecto alojado (excluyendo ALpanel).
 * @serviceIcon fa-users-rectangle
 * @defaultRoles admin
 */
export class ProjectUsersService {
  private getVaultPath(): string {
    const dataDir = process.env.PANEL_DATA_DIR || '/app/data';
    return path.join(dataDir, 'app-users-vault.json');
  }

  private getVaultKey(): Buffer {
    const secret =
      process.env.PANEL_JWT_SECRET || 'sm-server-panel-jwt-secret-key-2026';
    return crypto.createHash('sha256').update(`alpanel-vault:${secret}`).digest();
  }

  private readVault(): Record<string, VaultEntry> {
    try {
      const vaultPath = this.getVaultPath();
      if (!fs.existsSync(vaultPath)) return {};
      return JSON.parse(fs.readFileSync(vaultPath, 'utf-8')) || {};
    } catch {
      return {};
    }
  }

  private writeVault(data: Record<string, VaultEntry>): void {
    try {
      const vaultPath = this.getVaultPath();
      const dir = path.dirname(vaultPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(vaultPath, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // ignore write errors in read-only environments
    }
  }

  private makeVaultKey(projectName: string, username: string): string {
    return `${projectName.trim().toLowerCase()}::${username.trim().toLowerCase()}`;
  }

  private storeVaultPassword(
    projectName: string,
    username: string,
    plainPassword: string,
    passwordHash: string
  ): void {
    if (!plainPassword) return;
    const vault = this.readVault();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getVaultKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(plainPassword, 'utf-8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    vault[this.makeVaultKey(projectName, username)] = {
      cipher: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      hashPrefix: (passwordHash || '').slice(0, 29),
      updatedAt: new Date().toISOString(),
    };
    this.writeVault(vault);
  }

  private getVaultPassword(
    projectName: string,
    username: string,
    currentHash?: string
  ): string | undefined {
    const vault = this.readVault();
    const entry = vault[this.makeVaultKey(projectName, username)];
    if (!entry) return undefined;
    if (
      currentHash &&
      entry.hashPrefix &&
      !currentHash.startsWith(entry.hashPrefix)
    ) {
      return undefined;
    }
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getVaultKey(),
        Buffer.from(entry.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(entry.cipher, 'base64')),
        decipher.final(),
      ]);
      return dec.toString('utf-8');
    } catch {
      return undefined;
    }
  }

  private collectCandidatePasswords(projectDir: string, usernames: string[]): string[] {
    const candidates = new Set<string>([
      'admin123',
      '123456',
      'admin',
      '12345678',
      'password',
      'password123',
      'root',
      'secret',
      'zapatoqueando123',
    ]);
    for (const u of usernames) {
      if (u) {
        candidates.add(u);
        candidates.add(`${u}123`);
      }
    }

    if (!projectDir || !fs.existsSync(projectDir)) {
      return Array.from(candidates);
    }

    const filesToScan: string[] = [
      path.join(projectDir, '.env'),
      path.join(projectDir, '.env.example'),
      path.join(projectDir, 'database/seeders/DatabaseSeeder.php'),
      path.join(projectDir, 'API_REST/database/seeders/DatabaseSeeder.php'),
      path.join(projectDir, 'backend/database/seeders/DatabaseSeeder.php'),
      path.join(projectDir, 'prisma/seed.ts'),
      path.join(projectDir, 'prisma/seed.js'),
      path.join(projectDir, 'src/seed.ts'),
      path.join(projectDir, 'src/seed.js'),
    ];

    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          filesToScan.push(
            path.join(projectDir, entry.name, 'database/seeders/DatabaseSeeder.php'),
            path.join(projectDir, entry.name, 'prisma/seed.ts'),
            path.join(projectDir, entry.name, '.env')
          );
        }
      }
    } catch {
      // ignore
    }

    for (const file of filesToScan) {
      if (!fs.existsSync(file)) continue;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const hashMakeRegex = /Hash::make\(\s*['"]([^'"]{1,64})['"]\s*\)/g;
        const bcryptRegex = /bcrypt(?:js)?\.hash(?:Sync)?\(\s*['"]([^'"]{1,64})['"]/g;
        const passPropRegex = /password\s*[:=]\s*['"]([^'"$\n]{1,64})['"]/gi;
        const envPassRegex = /^[A-Z0-9_]*PASS(?:WORD)?\s*=\s*['"]?([^'"\s#]{1,64})['"]?$/gm;

        for (const rgx of [hashMakeRegex, bcryptRegex, passPropRegex, envPassRegex]) {
          let m: RegExpExecArray | null;
          while ((m = rgx.exec(content)) !== null) {
            const val = m[1].trim();
            if (val && !val.startsWith('$2')) {
              candidates.add(val);
            }
          }
        }
      } catch {
        // ignore read error
      }
    }

    return Array.from(candidates).slice(0, 35);
  }

  private async resolveKnownPasswords(
    projectName: string,
    ctx: DbExecContext,
    records: Array<{ user: AppUserRecord; hash: string; salt?: string }>
  ): Promise<void> {
    const unresolved: Array<{ user: AppUserRecord; hash: string; salt?: string }> = [];

    for (const item of records) {
      const cached = this.getVaultPassword(
        projectName,
        item.user.username,
        item.hash
      );
      if (cached) {
        item.user.knownPassword = cached;
      } else if (item.hash) {
        unresolved.push(item);
      }
    }

    if (unresolved.length === 0) return;

    const candidates = this.collectCandidatePasswords(
      ctx.projectDir,
      unresolved.map((u) => u.user.username)
    );

    // 1. Verificar PBKDF2 (Django) o SHA1 (Symfony) directamente en memoria de Node
    const bcryptUnresolved: Array<{ user: AppUserRecord; hash: string }> = [];
    for (const item of unresolved) {
      if (item.hash.startsWith('pbkdf2_sha256$')) {
        const parts = item.hash.split('$');
        if (parts.length === 4) {
          const iterations = Number(parts[1]) || 600000;
          const salt = parts[2];
          const targetDerived = parts[3];
          for (const cand of candidates) {
            const derived = crypto
              .pbkdf2Sync(cand, salt, iterations, 32, 'sha256')
              .toString('base64');
            if (derived === targetDerived) {
              item.user.knownPassword = cand;
              this.storeVaultPassword(projectName, item.user.username, cand, item.hash);
              break;
            }
          }
        }
      } else if (item.hash.startsWith('$2')) {
        bcryptUnresolved.push(item);
      } else if (item.hash.length === 40 && /^[a-f0-9]{40}$/i.test(item.hash)) {
        for (const cand of candidates) {
          const sha1 = crypto
            .createHash('sha1')
            .update((item.salt || '') + cand)
            .digest('hex');
          if (sha1.toLowerCase() === item.hash.toLowerCase()) {
            item.user.knownPassword = cand;
            this.storeVaultPassword(projectName, item.user.username, cand, item.hash);
            break;
          }
        }
      }
    }

    if (bcryptUnresolved.length === 0) return;

    // 2. Verificar hashes bcrypt en lote usando el contenedor backend (PHP o Node) o pgcrypto
    const payloadJson = JSON.stringify({
      hashes: bcryptUnresolved.map((u) => ({
        username: u.user.username,
        hash: u.hash,
      })),
      candidates,
    });
    const b64Payload = Buffer.from(payloadJson, 'utf-8').toString('base64');

    for (const cName of ctx.appContainerNames) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${cName} sh -c 'php -r "\\$d=json_decode(base64_decode(\\"${b64Payload}\\"),true);\\$r=[];foreach(\\$d[\\"hashes\\"] as \\$item){foreach(\\$d[\\"candidates\\"] as \\$c){if(password_verify(\\$c,\\$item[\\"hash\\"])){ \\$r[\\$item[\\"username\\"]]=\\$c;break;}}}echo json_encode(\\$r);" 2>/dev/null || node -e "const b=require(\\"bcryptjs\\");const d=JSON.parse(Buffer.from(\\"${b64Payload}\\",\\"base64\\").toString());const r={};for(const item of d.hashes){for(const c of d.candidates){if(b.compareSync(c,item.hash)){r[item.username]=c;break;}}}console.log(JSON.stringify(r));" 2>/dev/null'`,
          { timeout: 10000 }
        );
        if (stdout && stdout.trim().startsWith('{')) {
          const matched = JSON.parse(stdout.trim()) as Record<string, string>;
          for (const item of bcryptUnresolved) {
            const found = matched[item.user.username];
            if (found) {
              item.user.knownPassword = found;
              this.storeVaultPassword(
                projectName,
                item.user.username,
                found,
                item.hash
              );
            }
          }
          return;
        }
      } catch {
        // try next container
      }
    }

    // 3. Fallback si es Postgres: verificar con pgcrypto crypt()
    if (ctx.isPostgres) {
      for (const item of bcryptUnresolved) {
        const safeHash = this.escapeSqlLiteral(item.hash);
        for (const cand of candidates.slice(0, 12)) {
          const safeCand = this.escapeSqlLiteral(cand);
          try {
            const out = await this.runSql(
              ctx,
              `SELECT CASE WHEN crypt('${safeCand}', '${safeHash}') = '${safeHash}' THEN '1' ELSE '0' END;`
            );
            if (out.trim() === '1') {
              item.user.knownPassword = cand;
              this.storeVaultPassword(
                projectName,
                item.user.username,
                cand,
                item.hash
              );
              break;
            }
          } catch {
            break;
          }
        }
      }
    }
  }

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

    // 2. Probar en todos los contenedores de aplicación del proyecto (priorizando role === 'backend')
    const b64 = Buffer.from(password, 'utf-8').toString('base64');
    for (const cName of ctx.appContainerNames) {
      try {
        const { stdout } = await execAsync(
          `docker exec ${cName} sh -c 'php -r "echo password_hash(base64_decode(\\"${b64}\\"), PASSWORD_BCRYPT);" 2>/dev/null || node -e "const b=require(\\"bcryptjs\\");console.log(b.hashSync(Buffer.from(\\"${b64}\\",\\"base64\\").toString(),10))" 2>/dev/null || python3 -c "import bcrypt,base64;print(bcrypt.hashpw(base64.b64decode(\\"${b64}\\"),bcrypt.gensalt()).decode())" 2>/dev/null'`,
          { timeout: 10000 }
        );
        if (stdout && stdout.trim().startsWith('$2')) {
          return stdout.trim();
        }
      } catch {
        // Probar siguiente contenedor
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
    const candidateContainers = (proj.containers || [])
      .filter((c) => c.role !== 'database' && c.role !== 'proxy')
      .sort((a, b) => {
        if (a.role === 'backend' && b.role !== 'backend') return -1;
        if (a.role !== 'backend' && b.role === 'backend') return 1;
        return 0;
      });
    const appContainerNames = candidateContainers
      .map((c) => c.name.replace(/[^a-zA-Z0-9._-]/g, ''))
      .filter(Boolean);

    return {
      projectDir: proj.path,
      isPostgres,
      containerName: db.containerName.replace(/[^a-zA-Z0-9._-]/g, ''),
      appContainerName: appContainerNames[0] || '',
      appContainerNames,
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
        `SELECT id, username, COALESCE(email, ''), CASE WHEN is_superuser = ${ctx.isPostgres ? 'true' : '1'} THEN 'superuser' WHEN is_staff = ${ctx.isPostgres ? 'true' : '1'} THEN 'staff' ELSE 'user' END, CASE WHEN is_active = ${ctx.isPostgres ? 'true' : '1'} THEN '1' ELSE '0' END, COALESCE(password, '') FROM auth_user ORDER BY id ASC;`
      );
      const records = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active, passHash] = line.split(sep);
            return {
              user: {
                id: String(id || '').trim(),
                username: String(username || '').trim(),
                email: String(email || '').trim(),
                role: String(role || 'user').trim(),
                isActive: String(active || '1').trim() === '1',
              } as AppUserRecord,
              hash: String(passHash || '').trim(),
            };
          })
        : [];

      await this.resolveKnownPasswords(projectName, ctx, records);

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
        users: records.map((r) => r.user),
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
        `SELECT id, ${userCol}, ${emailExpr}, ${roleExpr}, ${activeExpr}, COALESCE(password, '') FROM users ORDER BY id ASC;`
      );
      const records = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active, passHash] = line.split(sep);
            return {
              user: {
                id: String(id || '').trim(),
                username: String(username || '').trim(),
                email: String(email || '').trim(),
                role: String(role || 'admin').trim(),
                isActive: String(active || '1').trim() === '1',
              } as AppUserRecord,
              hash: String(passHash || '').trim(),
            };
          })
        : [];

      await this.resolveKnownPasswords(projectName, ctx, records);

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
        users: records.map((r) => r.user),
      };
    }

    // 3. Verificar tabla `sf_guard_user` (Symfony 1.4)
    const sfCols = await this.detectTableColumns(ctx, 'sf_guard_user');
    if (sfCols.includes('username') && sfCols.includes('password')) {
      const sep = ctx.isPostgres ? '|' : '\t';
      const saltExpr = sfCols.includes('salt') ? "COALESCE(salt, '')" : "''";
      const raw = await this.runSql(
        ctx,
        `SELECT id, username, '', CASE WHEN is_super_admin = 1 THEN 'superadmin' ELSE 'user' END, CASE WHEN is_active = 1 THEN '1' ELSE '0' END, COALESCE(password, ''), ${saltExpr} FROM sf_guard_user ORDER BY id ASC LIMIT 200;`
      );
      const records = raw
        ? raw.split('\n').filter(Boolean).map((line) => {
            const [id, username, email, role, active, passHash, salt] = line.split(sep);
            return {
              user: {
                id: String(id || '').trim(),
                username: String(username || '').trim(),
                email: String(email || '').trim(),
                role: String(role || 'user').trim(),
                isActive: String(active || '1').trim() === '1',
              } as AppUserRecord,
              hash: String(passHash || '').trim(),
              salt: String(salt || '').trim(),
            };
          })
        : [];

      await this.resolveKnownPasswords(projectName, ctx, records);

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
        users: records.map((r) => r.user),
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
    const rawUsername = (payload.username || '').trim();
    const cleanUser = this.escapeSqlLiteral(rawUsername);
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
        let passClause = '';
        if (rawPass) {
          const rawHash = this.hashDjangoPbkdf2(rawPass);
          passClause = `, password = '${this.escapeSqlLiteral(rawHash)}'`;
          this.storeVaultPassword(projectName, rawUsername, rawPass, rawHash);
        }
        await this.runSql(
          ctx,
          `UPDATE auth_user SET username = '${cleanUser}', email = '${cleanEmail}', is_superuser = ${boolSuper}, is_staff = ${boolStaff}, is_active = ${boolActive}${passClause} WHERE id = ${cleanId};`
        );
        return { success: true, message: `Usuario @${payload.username} actualizado en auth_user.` };
      } else {
        if (!rawPass) throw new Error('Debes ingresar una contraseña para el nuevo usuario.');
        const rawHash = this.hashDjangoPbkdf2(rawPass);
        const hashed = this.escapeSqlLiteral(rawHash);
        const nowExpr = ctx.isPostgres ? 'NOW()' : 'NOW()';
        await this.runSql(
          ctx,
          `INSERT INTO auth_user (password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined) VALUES ('${hashed}', ${boolSuper}, '${cleanUser}', '', '', '${cleanEmail}', ${boolStaff}, ${boolActive}, ${nowExpr});`
        );
        this.storeVaultPassword(projectName, rawUsername, rawPass, rawHash);
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
          const rawHash = await this.hashBcrypt(ctx, rawPass);
          const hashed = this.escapeSqlLiteral(rawHash);
          updates.push(`password = '${hashed}'`);
          this.storeVaultPassword(projectName, rawUsername, rawPass, rawHash);
        }
        await this.runSql(ctx, `UPDATE users SET ${updates.join(', ')} WHERE id = ${cleanId};`);
        return { success: true, message: `Usuario ${payload.username} actualizado en ${projectName}.` };
      } else {
        if (!rawPass) throw new Error('Debes ingresar una contraseña para el nuevo usuario.');
        const rawHash = await this.hashBcrypt(ctx, rawPass);
        const hashed = this.escapeSqlLiteral(rawHash);
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
        this.storeVaultPassword(projectName, rawUsername, rawPass, rawHash);
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
          this.storeVaultPassword(projectName, rawUsername, rawPass, sha1);
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
        this.storeVaultPassword(projectName, rawUsername, rawPass, sha1);
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

