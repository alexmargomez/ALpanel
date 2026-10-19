import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ContainerStatInfo,
  DatabaseConnectionInfo,
  ProjectInfo,
} from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { ContainerRuntimePort } from '../ports/container-runtime.port';

const execAsync = promisify(exec);

export class ManageProjectDbUseCase {
  constructor(
    private readonly runtime: ContainerRuntimePort,
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  async extractDatabaseInfo(
    projectDir: string,
    containers: ContainerStatInfo[],
    envDict: Record<string, string>,
    publicIp: string
  ): Promise<DatabaseConnectionInfo> {
    const dbContainer = containers.find((c) => c.role === 'database');

    let containerEnv: Record<string, string> = {};
    let externalPort = '';
    let internalPort = '3306';

    if (dbContainer) {
      const inspected = await this.runtime.inspectContainerConfig(dbContainer.id);
      containerEnv = inspected.env;
      externalPort = inspected.externalPort;
      internalPort = inspected.internalPort;
    }

    if (!externalPort) {
      const composePath = path.join(projectDir, 'docker-compose.yml');
      if (fs.existsSync(composePath)) {
        const content = fs.readFileSync(composePath, 'utf-8');
        const portMatch = content.match(/["']?(\d{4,5}):(3306|5432|27017)["']?/);
        if (portMatch) {
          externalPort = portMatch[1];
          internalPort = portMatch[2];
        }
      }
    }

    const merged = { ...envDict, ...containerEnv };
    const hasDbVars = Boolean(
      dbContainer ||
        merged.MYSQL_DATABASE ||
        merged.MARIADB_DATABASE ||
        merged.DB_NAME ||
        merged.DB_DATABASE ||
        merged.POSTGRES_DB
    );

    if (!hasDbVars) {
      return {
        hasDatabase: false,
        engine: '-',
        containerName: '-',
        status: 'none',
        host: publicIp,
        internalHost: '-',
        port: '-',
        internalPort: '-',
        database: '-',
        username: '-',
        password: '-',
        rootUsername: '-',
        rootPassword: '-',
        connectionUrl: '',
        cliCommand: '',
      };
    }

    const isPostgres =
      (dbContainer?.image || '').toLowerCase().includes('postgres') ||
      Boolean(merged.POSTGRES_DB || merged.POSTGRES_USER) ||
      internalPort === '5432';
    const isMaria = (dbContainer?.image || '').toLowerCase().includes('mariadb');

    const engine = isPostgres
      ? dbContainer?.image || 'PostgreSQL'
      : isMaria
      ? dbContainer?.image || 'MariaDB'
      : dbContainer?.image || 'MariaDB';

    const database =
      merged.MYSQL_DATABASE ||
      merged.MARIADB_DATABASE ||
      merged.POSTGRES_DB ||
      merged.DB_NAME ||
      merged.DB_DATABASE ||
      'default_db';

    const username =
      merged.MYSQL_USER ||
      merged.MARIADB_USER ||
      merged.POSTGRES_USER ||
      merged.DB_USER ||
      merged.DB_USERNAME ||
      (isPostgres ? 'postgres' : 'root');

    const password =
      merged.MYSQL_PASSWORD ||
      merged.MARIADB_PASSWORD ||
      merged.POSTGRES_PASSWORD ||
      merged.DB_PASSWORD ||
      '';

    const rootUsername = isPostgres ? 'postgres' : 'root';
    const rootPassword =
      merged.MYSQL_ROOT_PASSWORD ||
      merged.MARIADB_ROOT_PASSWORD ||
      merged.DB_ROOT_PASSWORD ||
      merged.POSTGRES_PASSWORD ||
      password;

    const effectivePort =
      externalPort || internalPort || (isPostgres ? '5432' : '3306');
    const internalHost =
      envDict.DB_HOST ||
      (merged.DB_HOST && merged.DB_HOST !== 'panel_db' ? merged.DB_HOST : '') ||
      dbContainer?.serviceName ||
      'db';
    const protocol = isPostgres ? 'postgresql' : 'mysql';

    const connectionUrl = `${protocol}://${encodeURIComponent(
      username
    )}:${encodeURIComponent(password)}@${publicIp}:${effectivePort}/${database}`;
    const cliCommand = isPostgres
      ? `PGPASSWORD='${password}' psql -h ${publicIp} -p ${effectivePort} -U ${username} -d ${database}`
      : `mysql -h ${publicIp} -P ${effectivePort} -u ${username} -p'${password}' ${database}`;

    return {
      hasDatabase: true,
      engine,
      containerName: dbContainer?.name || 'db',
      status: dbContainer?.state || 'stopped',
      host: publicIp,
      internalHost,
      port: effectivePort,
      internalPort,
      database,
      username,
      password,
      rootUsername,
      rootPassword,
      connectionUrl,
      cliCommand,
    };
  }

  async dumpDatabaseSql(
    projectName: string,
    projects: ProjectInfo[]
  ): Promise<{ filename: string; sql: string }> {
    const isSelf = ProjectNameVO.isSelfPanel(projectName, this.panelSelfDir);
    const proj = projects.find(
      (p) =>
        p.name.toLowerCase() === projectName.toLowerCase() ||
        (isSelf && ProjectNameVO.isSelfPanel(p.name, this.panelSelfDir))
    );
    if (!proj || !proj.database.hasDatabase) {
      throw new Error(
        'Este proyecto no tiene una base de datos activa configurada.'
      );
    }
    const db = proj.database;
    const isPg = db.engine.toLowerCase().includes('postgres');
    const container = db.containerName.replace(/[^a-zA-Z0-9._-]/g, '');
    const dbName = db.database.replace(/[^a-zA-Z0-9._-]/g, '');
    const rootPass = db.rootPassword.replace(/'/g, "'\\''");

    const cmd = isPg
      ? `docker exec -e PGPASSWORD='${rootPass}' ${container} pg_dump -U ${db.rootUsername} ${dbName}`
      : `docker exec ${container} sh -c "(command -v mariadb-dump >/dev/null 2>&1 && mariadb-dump -u ${db.rootUsername} -p'${rootPass}' ${dbName}) || mysqldump -u ${db.rootUsername} -p'${rootPass}' ${dbName}"`;

    const { stdout } = await execAsync(cmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120000,
    });
    const dateStr = new Date().toISOString().slice(0, 10);
    return {
      filename: `${proj.name}_${dbName}_${dateStr}.sql`,
      sql: stdout,
    };
  }
}
