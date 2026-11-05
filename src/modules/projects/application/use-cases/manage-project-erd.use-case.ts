import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export interface ErdColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  extra: string;
}

export interface ErdTableInfo {
  name: string;
  engine: string;
  rowCount: number;
  columns: ErdColumnInfo[];
}

export interface ErdRelationInfo {
  id: string;
  constraintName: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  deleteRule: string;
  updateRule: string;
  isImplicit?: boolean;
}

export interface ProjectErdSchema {
  projectName: string;
  containerName?: string;
  databaseName: string;
  availableDatabases?: string[];
  engine: string;
  source: 'live_db' | 'prisma_schema' | 'sql_schema';
  tables: ErdTableInfo[];
  relations: ErdRelationInfo[];
  mermaidCode: string;
}

export function buildMermaidErDiagram(
  tables: ErdTableInfo[],
  relations: ErdRelationInfo[]
): string {
  const lines: string[] = ['erDiagram'];
  for (const rel of relations) {
    const label = `${rel.sourceColumn} -> ${rel.targetColumn}`;
    lines.push(
      `  ${rel.targetTable} ||--o{ ${rel.sourceTable} : "${label}"`
    );
  }
  for (const tbl of tables) {
    lines.push(`  ${tbl.name} {`);
    for (const col of tbl.columns) {
      const safeType = (col.type || 'varchar')
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_()]/g, '');
      const keyTag = col.isPrimaryKey
        ? ' PK'
        : col.isForeignKey
        ? ' FK'
        : col.isUnique
        ? ' UK'
        : '';
      lines.push(`    ${safeType} ${col.name}${keyTag}`);
    }
    lines.push('  }');
  }
  return lines.join('\n');
}

export function inferImplicitRelations(
  tables: ErdTableInfo[],
  explicitRelations: ErdRelationInfo[]
): ErdRelationInfo[] {
  const result: ErdRelationInfo[] = [...explicitRelations];
  const existingKeys = new Set(
    explicitRelations.map(
      (r) => `${r.sourceTable}.${r.sourceColumn}->${r.targetTable}.${r.targetColumn}`
    )
  );

  const tableMap = new Map<string, ErdTableInfo>();
  for (const t of tables) {
    tableMap.set(t.name.toLowerCase(), t);
  }

  for (const tbl of tables) {
    for (const col of tbl.columns) {
      if (col.isPrimaryKey) continue;
      const colLower = col.name.toLowerCase();
      if (!colLower.endsWith('_id') && !colLower.endsWith('id')) continue;

      let prefix = '';
      if (colLower.endsWith('_id')) {
        prefix = colLower.slice(0, -3);
      } else if (colLower.length > 2 && col.name.endsWith('Id')) {
        prefix = col.name
          .slice(0, -2)
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .toLowerCase();
      }
      if (!prefix) continue;

      const candidates = [
        prefix,
        `${prefix}s`,
        `${prefix}es`,
        prefix.endsWith('y') ? `${prefix.slice(0, -1)}ies` : '',
      ].filter(Boolean);

      for (const cand of candidates) {
        const targetTbl = tableMap.get(cand);
        if (!targetTbl || targetTbl.name === tbl.name) continue;
        const targetPk =
          targetTbl.columns.find((c) => c.isPrimaryKey) ||
          targetTbl.columns.find((c) => c.name.toLowerCase() === 'id');
        if (!targetPk) continue;

        const key = `${tbl.name}.${col.name}->${targetTbl.name}.${targetPk.name}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          col.isForeignKey = true;
          result.push({
            id: key,
            constraintName: `fk_${tbl.name}_${col.name}`,
            sourceTable: tbl.name,
            sourceColumn: col.name,
            targetTable: targetTbl.name,
            targetColumn: targetPk.name,
            deleteRule: 'RESTRICT',
            updateRule: 'RESTRICT',
            isImplicit: true,
          });
        }
        break;
      }
    }
  }

  return result;
}

export function parsePrismaSchemaToErd(
  schemaContent: string,
  projectName: string,
  databaseName = 'prisma_db'
): ProjectErdSchema {
  const tables: ErdTableInfo[] = [];
  const explicitRelations: ErdRelationInfo[] = [];
  const modelToTableName = new Map<string, string>();

  const modelRegex = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  const rawModels: Array<{ modelName: string; body: string; tableName: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\(["']([^"']+)["']\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;
    modelToTableName.set(modelName, tableName);
    rawModels.push({ modelName, body, tableName });
  }

  for (const m of rawModels) {
    const columns: ErdColumnInfo[] = [];
    const lines = m.body.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;

      const fieldName = parts[0];
      const rawType = parts[1];
      const cleanType = rawType.replace(/[?[\]]/g, '');

      const relMatch = line.match(
        /@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/
      );
      if (relMatch) {
        const srcCol = relMatch[1].split(',')[0].trim();
        const tgtCol = relMatch[2].split(',')[0].trim();
        const targetTable = modelToTableName.get(cleanType) || cleanType;
        const onDeleteMatch = line.match(/onDelete:\s*(\w+)/);
        explicitRelations.push({
          id: `${m.tableName}.${srcCol}->${targetTable}.${tgtCol}`,
          constraintName: `fk_${m.tableName}_${srcCol}`,
          sourceTable: m.tableName,
          sourceColumn: srcCol,
          targetTable,
          targetColumn: tgtCol,
          deleteRule: onDeleteMatch ? onDeleteMatch[1].toUpperCase() : 'CASCADE',
          updateRule: 'CASCADE',
        });
        continue;
      }

      if (modelToTableName.has(cleanType) || rawType.endsWith('[]')) {
        continue;
      }

      const mapColMatch = line.match(/@map\(["']([^"']+)["']\)/);
      const colName = mapColMatch ? mapColMatch[1] : fieldName;
      const isPk = line.includes('@id');
      const isUnique = line.includes('@unique');
      const isNullable = rawType.endsWith('?');
      const defaultMatch = line.match(/@default\(([^)]+)\)/);

      columns.push({
        name: colName,
        type: cleanType.toUpperCase(),
        nullable: isNullable,
        isPrimaryKey: isPk,
        isForeignKey: false,
        isUnique,
        defaultValue: defaultMatch ? defaultMatch[1] : null,
        extra: line.includes('autoincrement()') ? 'auto_increment' : '',
      });
    }

    tables.push({
      name: m.tableName,
      engine: 'Prisma ORM',
      rowCount: 0,
      columns,
    });
  }

  for (const rel of explicitRelations) {
    const srcTbl = tables.find((t) => t.name === rel.sourceTable);
    const col = srcTbl?.columns.find(
      (c) =>
        c.name === rel.sourceColumn ||
        c.name.replace(/_([a-z])/g, (_, l) => l.toUpperCase()) === rel.sourceColumn
    );
    if (col) {
      col.isForeignKey = true;
      rel.sourceColumn = col.name;
    }
  }

  const allRelations = inferImplicitRelations(tables, explicitRelations);

  return {
    projectName,
    databaseName,
    engine: 'Prisma Schema',
    source: 'prisma_schema',
    tables,
    relations: allRelations,
    mermaidCode: buildMermaidErDiagram(tables, allRelations),
  };
}

export class ManageProjectErdUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  async inspectProjectErd(
    projectName: string,
    projects: ProjectInfo[],
    customExec?: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
    containerName?: string,
    requestedDbName?: string
  ): Promise<ProjectErdSchema> {
    const vo = new ProjectNameVO(projectName);
    const isSelf = ProjectNameVO.isSelfPanel(vo.value, this.panelSelfDir);
    const proj = projects.find(
      (p) =>
        p.name.toLowerCase() === vo.value.toLowerCase() ||
        (isSelf && ProjectNameVO.isSelfPanel(p.name, this.panelSelfDir))
    );

    const projectDir = vo.resolvePath(this.projectsRoot, this.panelSelfDir);

    if (proj && proj.database && proj.database.hasDatabase) {
      try {
        const schema = await this.inspectLiveDatabase(
          proj,
          customExec,
          containerName,
          requestedDbName
        );
        return schema;
      } catch {
        // Fallback to static schema inspection if container is stopped or unreachable
      }
    }

    const prismaPath = path.join(projectDir, 'prisma', 'schema.prisma');
    if (fs.existsSync(prismaPath)) {
      const content = fs.readFileSync(prismaPath, 'utf-8');
      const fallbackDb =
        (requestedDbName && requestedDbName.trim()) ||
        proj?.database?.database ||
        'app_db';
      const parsed = parsePrismaSchemaToErd(content, vo.value, fallbackDb);
      parsed.containerName =
        containerName || proj?.database?.containerName || undefined;
      parsed.availableDatabases = [fallbackDb];
      return parsed;
    }

    throw new Error(
      'No se pudo conectar al contenedor de Base de Datos del proyecto ni se encontró un esquema local para generar el diagrama DER / ERD.'
    );
  }

  private async inspectLiveDatabase(
    proj: ProjectInfo,
    customExec?: (cmd: string) => Promise<{ stdout: string; stderr: string }>,
    containerName?: string,
    requestedDbName?: string
  ): Promise<ProjectErdSchema> {
    const db = proj.database;
    const requestedContainer = (containerName || '').replace(
      /[^a-zA-Z0-9._-]/g,
      ''
    );
    const container =
      requestedContainer || db.containerName.replace(/[^a-zA-Z0-9._-]/g, '');
    const matchedContainerInfo = proj.containers?.find(
      (c) => c.name === container
    );
    const isPg = matchedContainerInfo
      ? /postgres/i.test(matchedContainerInfo.image) ||
        db.engine.toLowerCase().includes('postgres')
      : db.engine.toLowerCase().includes('postgres');
    const rawTargetDb =
      requestedDbName && requestedDbName.trim().length > 0
        ? requestedDbName.trim()
        : db.database;
    const dbName = rawTargetDb.replace(/[^a-zA-Z0-9._-]/g, '');
    const rootUser = db.rootUsername.replace(/[^a-zA-Z0-9._-]/g, '');
    const rootPass = db.rootPassword.replace(/'/g, "'\\''");

    const execFn =
      customExec ||
      ((cmd: string) =>
        execAsync(cmd, {
          timeout: 30000,
          maxBuffer: 15 * 1024 * 1024,
        }));

    if (isPg) {
      const schema = await this.inspectPostgresContainer(
        proj.name,
        container,
        dbName,
        rootUser,
        rootPass,
        db.engine,
        execFn
      );
      schema.containerName = container;
      return schema;
    }

    const schema = await this.inspectMysqlContainer(
      proj.name,
      container,
      dbName,
      rootUser,
      rootPass,
      db.engine,
      execFn
    );
    schema.containerName = container;
    return schema;
  }

  private async inspectMysqlContainer(
    projectName: string,
    container: string,
    dbName: string,
    user: string,
    pass: string,
    engineLabel: string,
    execFn: (cmd: string) => Promise<{ stdout: string; stderr: string }>
  ): Promise<ProjectErdSchema> {
    const sql = [
      `SELECT CONCAT('DB|', SCHEMA_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') ORDER BY SCHEMA_NAME;`,
      `SELECT CONCAT('TBL|', TABLE_NAME, '|', IFNULL(ENGINE, 'InnoDB'), '|', IFNULL(TABLE_ROWS, 0)) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbName}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME;`,
      `SELECT CONCAT('COL|', TABLE_NAME, '|', COLUMN_NAME, '|', COLUMN_TYPE, '|', IS_NULLABLE, '|', IFNULL(COLUMN_KEY, ''), '|', IFNULL(COLUMN_DEFAULT, ''), '|', IFNULL(EXTRA, '')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${dbName}' ORDER BY TABLE_NAME, ORDINAL_POSITION;`,
      `SELECT CONCAT('FK|', kcu.CONSTRAINT_NAME, '|', kcu.TABLE_NAME, '|', kcu.COLUMN_NAME, '|', kcu.REFERENCED_TABLE_NAME, '|', kcu.REFERENCED_COLUMN_NAME, '|', IFNULL(rc.DELETE_RULE, 'RESTRICT'), '|', IFNULL(rc.UPDATE_RULE, 'RESTRICT')) FROM information_schema.KEY_COLUMN_USAGE kcu LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME WHERE kcu.TABLE_SCHEMA = '${dbName}' AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME;`,
    ].join(' ');

    const escapedSql = sql.replace(/"/g, '\\"');
    const cmd = `docker exec ${container} sh -c "(command -v mariadb >/dev/null 2>&1 && mariadb -N -B -u ${user} -p'${pass}' -e \\"${escapedSql}\\") || mysql -N -B -u ${user} -p'${pass}' -e \\"${escapedSql}\\""`;

    const { stdout } = await execFn(cmd);
    return this.parseDelimitedOutput(
      stdout,
      projectName,
      dbName,
      engineLabel
    );
  }

  private async inspectPostgresContainer(
    projectName: string,
    container: string,
    dbName: string,
    user: string,
    pass: string,
    engineLabel: string,
    execFn: (cmd: string) => Promise<{ stdout: string; stderr: string }>
  ): Promise<ProjectErdSchema> {
    const schemaFilter = `NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'`;
    const infoSchemaFilter = `NOT IN ('pg_catalog', 'information_schema') AND cols.table_schema NOT LIKE 'pg_toast%'`;
    const sql = [
      `SELECT 'DB|' || datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY datname ASC;`,
      `SELECT 'TBL|' || c.relname || '|PostgreSQL (' || n.nspname || ')|' || COALESCE(c.reltuples::bigint, 0) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname ${schemaFilter} AND c.relkind = 'r' ORDER BY n.nspname, c.relname;`,
      `SELECT 'COL|' || cols.table_name || '|' || cols.column_name || '|' || cols.data_type || '|' || cols.is_nullable || '|' || CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END || '|' || COALESCE(cols.column_default, '') || '|' FROM information_schema.columns cols LEFT JOIN (SELECT kcu.table_schema, kcu.table_name, kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY') pk ON pk.table_schema = cols.table_schema AND pk.table_name = cols.table_name AND pk.column_name = cols.column_name WHERE cols.table_schema ${infoSchemaFilter} ORDER BY cols.table_schema, cols.table_name, cols.ordinal_position;`,
      `SELECT 'FK|' || tc.constraint_name || '|' || tc.table_name || '|' || kcu.column_name || '|' || ccu.table_name || '|' || ccu.column_name || '|' || COALESCE(rc.delete_rule, 'NO ACTION') || '|' || COALESCE(rc.update_rule, 'NO ACTION') FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name LEFT JOIN information_schema.referential_constraints AS rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema NOT IN ('pg_catalog', 'information_schema');`,
    ].join(' ');

    const escapedSql = sql.replace(/"/g, '\\"');
    const cmd = `docker exec -e PGPASSWORD='${pass}' ${container} psql -U ${user} -d ${dbName} -t -A -c "${escapedSql}"`;

    const { stdout } = await execFn(cmd);
    return this.parseDelimitedOutput(
      stdout,
      projectName,
      dbName,
      engineLabel
    );
  }

  private parseDelimitedOutput(
    stdout: string,
    projectName: string,
    databaseName: string,
    engine: string
  ): ProjectErdSchema {
    const tableMap = new Map<string, ErdTableInfo>();
    const explicitRelations: ErdRelationInfo[] = [];
    const availableDatabases: string[] = [];

    for (const rawLine of (stdout || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('DB|')) {
        const dbItem = (line.split('|')[1] || '').trim();
        if (dbItem && !availableDatabases.includes(dbItem)) {
          availableDatabases.push(dbItem);
        }
      } else if (line.startsWith('TBL|')) {
        const [, tblName, tblEngine, rowsStr] = line.split('|');
        if (!tblName) continue;
        tableMap.set(tblName, {
          name: tblName,
          engine: tblEngine || engine,
          rowCount: Math.max(0, parseInt(rowsStr || '0', 10) || 0),
          columns: [],
        });
      } else if (line.startsWith('COL|')) {
        const parts = line.split('|');
        const tblName = parts[1];
        const colName = parts[2];
        const colType = parts[3] || 'varchar';
        const isNull = (parts[4] || '').toUpperCase() === 'YES';
        const colKey = (parts[5] || '').toUpperCase();
        const defVal = parts[6] || null;
        const extra = parts[7] || '';

        if (!tblName || !colName) continue;
        if (!tableMap.has(tblName)) {
          tableMap.set(tblName, {
            name: tblName,
            engine,
            rowCount: 0,
            columns: [],
          });
        }
        tableMap.get(tblName)!.columns.push({
          name: colName,
          type: colType,
          nullable: isNull,
          isPrimaryKey: colKey === 'PRI',
          isForeignKey: colKey === 'MUL',
          isUnique: colKey === 'UNI',
          defaultValue: defVal,
          extra,
        });
      } else if (line.startsWith('FK|')) {
        const [
          ,
          constraintName,
          srcTbl,
          srcCol,
          tgtTbl,
          tgtCol,
          delRule,
          updRule,
        ] = line.split('|');
        if (!srcTbl || !srcCol || !tgtTbl || !tgtCol) continue;
        explicitRelations.push({
          id: `${srcTbl}.${srcCol}->${tgtTbl}.${tgtCol}`,
          constraintName: constraintName || `fk_${srcTbl}_${srcCol}`,
          sourceTable: srcTbl,
          sourceColumn: srcCol,
          targetTable: tgtTbl,
          targetColumn: tgtCol,
          deleteRule: delRule || 'RESTRICT',
          updateRule: updRule || 'RESTRICT',
        });
      }
    }

    if (databaseName && !availableDatabases.includes(databaseName)) {
      availableDatabases.unshift(databaseName);
    }

    const tables = Array.from(tableMap.values());
    for (const rel of explicitRelations) {
      const tbl = tableMap.get(rel.sourceTable);
      const col = tbl?.columns.find((c) => c.name === rel.sourceColumn);
      if (col) col.isForeignKey = true;
    }

    const relations = inferImplicitRelations(tables, explicitRelations);

    return {
      projectName,
      databaseName,
      availableDatabases,
      engine,
      source: 'live_db',
      tables,
      relations,
      mermaidCode: buildMermaidErDiagram(tables, relations),
    };
  }
}
