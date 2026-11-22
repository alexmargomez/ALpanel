import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Server as SocketIOServer } from 'socket.io';

const execAsync = promisify(exec);

export interface TaskContextStore {
  taskId: string;
  projectName?: string;
  startedAt: number;
}

export interface ProcessTopEntry {
  pid: number;
  ppid: number;
  state: string;
  cpuPercent: number;
  memPercent: number;
  rssMb: number;
  elapsed: string;
  command: string;
  args: string;
}

export interface TaskContainerStateItem {
  name: string;
  state: string;
  status: string;
}

export interface TaskLiveTelemetryPayload {
  taskId: string;
  phase: string;
  targetProject: string;
  elapsedMs: number;
  host: {
    cpuCores: number;
    loadAvg1m: number;
    loadAvg5m: number;
    ramTotalMb: number;
    ramUsedMb: number;
    ramAvailableMb: number;
    ramPercent: number;
    safetyFloorMb: number;
  };
  processes: ProcessTopEntry[];
  containers: TaskContainerStateItem[];
  timestamp: string;
}

export interface TaskStreamChunkPayload {
  taskId: string;
  chunk: string;
  isError: boolean;
  phase?: string;
  summaryLine?: string;
  timestamp: string;
}

class TaskTelemetryService {
  private readonly als = new AsyncLocalStorage<TaskContextStore>();
  private io: SocketIOServer | null = null;

  bindSocketServer(ioServer: SocketIOServer): void {
    this.io = ioServer;
  }

  enterRequestContext(ctx: { taskId: string; projectName?: string }): void {
    this.als.enterWith({
      taskId: ctx.taskId,
      projectName: ctx.projectName,
      startedAt: Date.now(),
    });
  }

  getCurrentContext(): TaskContextStore | undefined {
    return this.als.getStore();
  }

  private formatClock(): string {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  emitTaskStep(stepText: string, phase?: string): string {
    const clean = stepText.trim();
    const stamped = `[${this.formatClock()}] ${clean}\n`;
    const ctx = this.getCurrentContext();
    if (ctx?.taskId && this.io) {
      const payload: TaskStreamChunkPayload = {
        taskId: ctx.taskId,
        chunk: stamped,
        isError: clean.startsWith('❌') || clean.startsWith('🛑') || clean.startsWith('⛔'),
        phase: phase || clean.replace(/^==>\s*/, '').slice(0, 80),
        summaryLine: clean.replace(/^==>\s*/, '').slice(0, 100),
        timestamp: new Date().toISOString(),
      };
      this.io.emit('task:stream', payload);
    }
    return clean;
  }

  emitTaskLog(
    rawChunk: string,
    opts?: { isError?: boolean; phase?: string; explicitTaskId?: string }
  ): void {
    const ctx = this.getCurrentContext();
    const taskId = opts?.explicitTaskId || ctx?.taskId;
    if (!taskId || !this.io || !rawChunk) return;

    // Normalizar retornos de carro (\r) de barras de progreso de git / docker en saltos de línea legibles
    const normalized = rawChunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.trim()) return;

    const lines = normalized.split('\n');
    const formattedLines: string[] = [];
    let lastMeaningful = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === lines.length - 1 && line === '') continue;
      if (line.trim()) {
        lastMeaningful = line.trim();
        formattedLines.push(`[${this.formatClock()}] ${line}`);
      }
    }

    if (formattedLines.length === 0) return;

    const payload: TaskStreamChunkPayload = {
      taskId,
      chunk: formattedLines.join('\n') + '\n',
      isError: Boolean(opts?.isError),
      phase: opts?.phase,
      summaryLine: lastMeaningful.slice(0, 110),
      timestamp: new Date().toISOString(),
    };

    this.io.emit('task:stream', payload);
  }

  private readHostSnapshot(safetyFloorMb = 260) {
    let ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
    let ramAvailableMb = Math.round(os.freemem() / (1024 * 1024));

    try {
      if (fs.existsSync('/proc/meminfo')) {
        const mem = fs.readFileSync('/proc/meminfo', 'utf-8');
        const tMatch = /^MemTotal:\s+(\d+)\s+kB/m.exec(mem);
        const aMatch = /^MemAvailable:\s+(\d+)\s+kB/m.exec(mem);
        if (tMatch) ramTotalMb = Math.round(Number(tMatch[1]) / 1024);
        if (aMatch) ramAvailableMb = Math.round(Number(aMatch[1]) / 1024);
      }
    } catch {
      // ignore
    }

    const ramUsedMb = Math.max(0, ramTotalMb - ramAvailableMb);
    const ramPercent =
      ramTotalMb > 0 ? Math.round((ramUsedMb / ramTotalMb) * 100) : 0;
    const [load1 = 0, load5 = 0] = os.loadavg();

    return {
      cpuCores: os.cpus()?.length || 1,
      loadAvg1m: Number(load1.toFixed(2)),
      loadAvg5m: Number(load5.toFixed(2)),
      ramTotalMb,
      ramUsedMb,
      ramAvailableMb,
      ramPercent,
      safetyFloorMb,
    };
  }

  private collectDescendants(
    rootPid: number,
    allProcs: ProcessTopEntry[]
  ): Set<number> {
    const childrenMap = new Map<number, number[]>();
    for (const p of allProcs) {
      const arr = childrenMap.get(p.ppid) || [];
      arr.push(p.pid);
      childrenMap.set(p.ppid, arr);
    }

    const visited = new Set<number>([rootPid]);
    const queue = [rootPid];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const kids = childrenMap.get(curr) || [];
      for (const k of kids) {
        if (!visited.has(k)) {
          visited.add(k);
          queue.push(k);
        }
      }
    }
    return visited;
  }

  async broadcastLiveTelemetry(opts: {
    explicitTaskId?: string;
    rootPid?: number;
    phase: string;
    targetProject: string;
    projectDir?: string;
    safetyFloorMb?: number;
  }): Promise<void> {
    const ctx = this.getCurrentContext();
    const taskId = opts.explicitTaskId || ctx?.taskId;
    if (
      !taskId ||
      !this.io ||
      (process.env.JEST_WORKER_ID && process.env.FORCE_TELEMETRY_IN_TESTS !== '1')
    ) {
      return;
    }

    const host = this.readHostSnapshot(opts.safetyFloorMb || 260);
    const processes: ProcessTopEntry[] = [];
    const containers: TaskContainerStateItem[] = [];

    try {
      const { stdout } = await execAsync(
        'ps -eo pid=,ppid=,stat=,pcpu=,pmem=,rss=,etime=,comm=,args= --sort=-pcpu',
        { timeout: 1500 }
      );
      const parsedAll: ProcessTopEntry[] = [];
      for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const m =
          /^(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(
            line
          );
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        const state = m[3];
        const cpuPercent = Number(m[4]);
        const memPercent = Number(m[5]);
        const rssMb = Number((Number(m[6]) / 1024).toFixed(1));
        const elapsed = m[7];
        const command = m[8];
        const args = m[9].trim();

        if (args.includes('ps -eo pid=')) continue;
        parsedAll.push({
          pid,
          ppid,
          state,
          cpuPercent,
          memPercent,
          rssMb,
          elapsed,
          command,
          args: args.length > 120 ? `${args.slice(0, 117)}...` : args,
        });
      }

      const treePids = opts.rootPid
        ? this.collectDescendants(opts.rootPid, parsedAll)
        : new Set<number>();

      const relevantRegex =
        /\b(git|docker|compose|buildx|buildkit|go|compile|asm|link|npm|node|vite|tsc|prisma|php|composer|python|gunicorn|mariadbd|postgres)\b/i;

      for (const p of parsedAll) {
        if (treePids.has(p.pid) || relevantRegex.test(p.command)) {
          processes.push(p);
          if (processes.length >= 12) break;
        }
      }
    } catch {
      // Ignorar si ps no está disponible en algún entorno mínimo
    }

    if (opts.projectDir && fs.existsSync(opts.projectDir)) {
      try {
        const { stdout: cOut } = await execAsync(
          `docker ps -a --filter "label=com.docker.compose.project.working_dir=${opts.projectDir}" --format "{{.Names}}||{{.State}}||{{.Status}}"`,
          { timeout: 1500 }
        );
        for (const row of cOut.split('\n')) {
          const [name, state, status] = row.trim().split('||');
          if (name) {
            containers.push({
              name,
              state: state || 'unknown',
              status: status || state || '',
            });
          }
        }
      } catch {
        // ignore
      }
    }

    const elapsedMs = ctx?.startedAt ? Date.now() - ctx.startedAt : 0;

    const payload: TaskLiveTelemetryPayload = {
      taskId,
      phase: opts.phase,
      targetProject: opts.targetProject,
      elapsedMs,
      host,
      processes,
      containers,
      timestamp: new Date().toISOString(),
    };

    this.io.emit('task:telemetry', payload);
  }
}

export const taskTelemetryService = new TaskTelemetryService();
