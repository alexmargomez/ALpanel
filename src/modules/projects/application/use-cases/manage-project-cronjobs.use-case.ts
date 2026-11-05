import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export interface ProjectCronjob {
  id: string;
  projectName: string;
  name: string;
  schedule: string;
  targetType: 'container' | 'host';
  containerName: string;
  command: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'ok' | 'error';
  lastOutput: string;
  lastDurationMs: number;
  createdAt: string;
}

function matchSingleCronField(
  field: string,
  value: number,
  min: number,
  max: number
): boolean {
  const trimmed = field.trim();
  if (trimmed === '*') return true;

  const parts = trimmed.split(',');
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;

    if (p.includes('/')) {
      const [rangePart, stepStr] = p.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      let start = min;
      let end = max;
      if (rangePart !== '*') {
        if (rangePart.includes('-')) {
          const [s, e] = rangePart.split('-').map((n) => parseInt(n, 10));
          if (!isNaN(s) && !isNaN(e)) {
            start = s;
            end = e;
          }
        } else {
          const s = parseInt(rangePart, 10);
          if (!isNaN(s)) start = s;
        }
      }
      if (value >= start && value <= end && (value - start) % step === 0) {
        return true;
      }
    } else if (p.includes('-')) {
      const [s, e] = p.split('-').map((n) => parseInt(n, 10));
      if (!isNaN(s) && !isNaN(e) && value >= s && value <= e) {
        return true;
      }
    } else {
      const exact = parseInt(p, 10);
      if (!isNaN(exact)) {
        if (exact === value || (max === 6 && exact === 7 && value === 0)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function isValidCronExpression(expr: string): boolean {
  const fields = (expr || '').trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f) => /^[0-9*,/-]+$/.test(f));
}

export function matchesCronExpression(
  expr: string,
  date = new Date()
): boolean {
  if (!isValidCronExpression(expr)) return false;
  const [minF, hourF, domF, monF, dowF] = expr.trim().split(/\s+/);
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  return (
    matchSingleCronField(minF, minute, 0, 59) &&
    matchSingleCronField(hourF, hour, 0, 23) &&
    matchSingleCronField(domF, dom, 1, 31) &&
    matchSingleCronField(monF, month, 1, 12) &&
    matchSingleCronField(dowF, dow, 0, 6)
  );
}

export class ManageProjectCronjobsUseCase {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private lastTickMinuteKey = '';

  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly customStorePath?: string
  ) {}

  private getStoreFilePath(): string {
    if (this.customStorePath) return this.customStorePath;
    const dataDir = process.env.PANEL_DATA_DIR || path.join(os.tmpdir(), 'alpanel-data');
    return path.join(dataDir, 'project-cronjobs.json');
  }

  private readAllCronjobs(): ProjectCronjob[] {
    try {
      const file = this.getStoreFilePath();
      if (!fs.existsSync(file)) return [];
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAllCronjobs(items: ProjectCronjob[]): void {
    try {
      const file = this.getStoreFilePath();
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(file, JSON.stringify(items, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // Ignore write errors in read-only filesystems
    }
  }

  listProjectCronjobs(projectName: string): ProjectCronjob[] {
    const cleanName = new ProjectNameVO(projectName).value.toLowerCase();
    return this.readAllCronjobs().filter(
      (c) => c.projectName.toLowerCase() === cleanName
    );
  }

  saveProjectCronjob(
    projectName: string,
    payload: Partial<ProjectCronjob>,
    projects: ProjectInfo[] = []
  ): ProjectCronjob {
    const vo = new ProjectNameVO(projectName);
    const name = String(payload.name || '').trim() || 'Tarea Programada';
    const schedule = String(payload.schedule || '* * * * *').trim();
    const command = String(payload.command || '').trim();

    if (!isValidCronExpression(schedule)) {
      throw new Error(
        'Expresión Cron inválida. Debe tener 5 campos estándar (ej. "*/5 * * * *" o "0 3 * * *").'
      );
    }
    if (!command) {
      throw new Error('Debes especificar el comando a ejecutar en el cronjob.');
    }

    const targetType: 'container' | 'host' =
      payload.targetType === 'host' ? 'host' : 'container';

    let containerName = String(payload.containerName || '').trim();
    if (targetType === 'container' && !containerName) {
      const proj = projects.find(
        (p) => p.name.toLowerCase() === vo.value.toLowerCase()
      );
      const preferred =
        proj?.containers.find((c) => c.role === 'backend') ||
        proj?.containers[0];
      containerName = preferred?.name || '';
    }

    const all = this.readAllCronjobs();
    const existingIdx = payload.id
      ? all.findIndex(
          (c) =>
            c.id === payload.id &&
            c.projectName.toLowerCase() === vo.value.toLowerCase()
        )
      : -1;

    if (existingIdx >= 0) {
      const updated: ProjectCronjob = {
        ...all[existingIdx],
        name,
        schedule,
        targetType,
        containerName,
        command,
        enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : all[existingIdx].enabled,
      };
      all[existingIdx] = updated;
      this.writeAllCronjobs(all);
      return updated;
    }

    const created: ProjectCronjob = {
      id: `cron_${crypto.randomBytes(6).toString('hex')}`,
      projectName: vo.value,
      name,
      schedule,
      targetType,
      containerName,
      command,
      enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : true,
      lastRunAt: null,
      lastStatus: 'idle',
      lastOutput: '',
      lastDurationMs: 0,
      createdAt: new Date().toISOString(),
    };
    all.push(created);
    this.writeAllCronjobs(all);
    return created;
  }

  deleteProjectCronjob(
    projectName: string,
    cronId: string
  ): { success: boolean } {
    const vo = new ProjectNameVO(projectName);
    const all = this.readAllCronjobs();
    const filtered = all.filter(
      (c) =>
        !(
          c.id === cronId &&
          c.projectName.toLowerCase() === vo.value.toLowerCase()
        )
    );
    this.writeAllCronjobs(filtered);
    return { success: true };
  }

  async runProjectCronjobNow(
    projectName: string,
    cronId: string,
    projects: ProjectInfo[] = [],
    customRunner?: (cmd: string, cwd: string) => Promise<{ stdout: string; stderr: string }>
  ): Promise<ProjectCronjob> {
    const vo = new ProjectNameVO(projectName);
    const all = this.readAllCronjobs();
    const idx = all.findIndex(
      (c) =>
        c.id === cronId &&
        c.projectName.toLowerCase() === vo.value.toLowerCase()
    );
    if (idx < 0) {
      throw new Error('Cronjob no encontrado para este proyecto.');
    }

    const job = all[idx];
    const startMs = Date.now();
    const projectDir = vo.resolvePath(this.projectsRoot, this.panelSelfDir);

    let shellCommand = job.command;
    if (job.targetType === 'container') {
      let targetContainer = job.containerName;
      if (!targetContainer) {
        const proj = projects.find(
          (p) => p.name.toLowerCase() === vo.value.toLowerCase()
        );
        const preferred =
          proj?.containers.find((c) => c.role === 'backend') ||
          proj?.containers[0];
        targetContainer = preferred?.name || '';
      }
      const safeContainer = targetContainer.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safeContainer) {
        throw new Error(
          'No se encontró un contenedor activo para ejecutar el cronjob.'
        );
      }
      const escapedCmd = job.command.replace(/'/g, "'\\''");
      shellCommand = `docker exec ${safeContainer} sh -c '${escapedCmd}'`;
    }

    try {
      const execFn =
        customRunner ||
        ((cmd: string, cwd: string) =>
          execAsync(cmd, {
            cwd: fs.existsSync(cwd) ? cwd : undefined,
            timeout: 120000,
            maxBuffer: 5 * 1024 * 1024,
          }));

      const { stdout, stderr } = await execFn(shellCommand, projectDir);
      const combined = [stdout, stderr]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join('\n');

      const latestAll = this.readAllCronjobs();
      const latestIdx = latestAll.findIndex((c) => c.id === job.id);
      const updated: ProjectCronjob = {
        ...(latestIdx >= 0 ? latestAll[latestIdx] : job),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'ok',
        lastOutput: (combined || 'Ejecución completada sin salida en consola.').slice(0, 4000),
        lastDurationMs: Date.now() - startMs,
      };
      if (latestIdx >= 0) {
        latestAll[latestIdx] = updated;
        this.writeAllCronjobs(latestAll);
      }
      return updated;
    } catch (error: any) {
      const errOut = [error?.stdout, error?.stderr, error?.message]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join('\n');

      const latestAll = this.readAllCronjobs();
      const latestIdx = latestAll.findIndex((c) => c.id === job.id);
      const updated: ProjectCronjob = {
        ...(latestIdx >= 0 ? latestAll[latestIdx] : job),
        lastRunAt: new Date().toISOString(),
        lastStatus: 'error',
        lastOutput: (errOut || 'Error ejecutando cronjob').slice(0, 4000),
        lastDurationMs: Date.now() - startMs,
      };
      if (latestIdx >= 0) {
        latestAll[latestIdx] = updated;
        this.writeAllCronjobs(latestAll);
      }
      return updated;
    }
  }

  startScheduler(getProjectsFn: () => Promise<ProjectInfo[]>): void {
    if (this.schedulerInterval) return;
    this.schedulerInterval = setInterval(async () => {
      const now = new Date();
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}:${now.getMinutes()}`;
      if (this.lastTickMinuteKey === minuteKey) return;
      this.lastTickMinuteKey = minuteKey;

      const jobs = this.readAllCronjobs().filter(
        (j) => j.enabled && matchesCronExpression(j.schedule, now)
      );
      if (jobs.length === 0) return;

      try {
        const projects = await getProjectsFn();
        for (const job of jobs) {
          this.runProjectCronjobNow(job.projectName, job.id, projects).catch(
            () => null
          );
        }
      } catch {
        // Ignore transient scheduler errors
      }
    }, 15000);
    if (this.schedulerInterval.unref) {
      this.schedulerInterval.unref();
    }
  }
}
