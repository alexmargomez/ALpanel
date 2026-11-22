import fs from 'fs';
import os from 'os';
import { spawn, exec } from 'child_process';
import { InsufficientServerMemoryException } from '../../../modules/projects/domain/exceptions/project.exception';
import { taskTelemetryService } from './task-telemetry.service';

export interface LiveMemorySnapshot {
  totalMb: number;
  availableMb: number;
  usedMb: number;
  usagePercent: number;
  swapTotalMb: number;
  swapFreeMb: number;
}

export interface MemoryCheckOptions {
  operation: string;
  targetProject: string;
  requiresBuild?: boolean;
  additionalContainersCount?: number;
}

export interface WatchdogExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  operation: string;
  targetProject: string;
  cleanupComposeDir?: string;
}

export class ResourceGuardService {
  /** Reserva mínima intocable en vivo: si MemAvailable cae por debajo de este umbral durante un build, se mata el proceso al instante */
  public static readonly CRITICAL_ABORT_AVAILABLE_MB = Number(
    process.env.ALPANEL_CRITICAL_FREE_RAM_MB || 260
  );

  /** Piso base de seguridad antes de admitir nuevas operaciones */
  public static readonly BASE_SAFETY_RESERVE_MB = Number(
    process.env.ALPANEL_SAFETY_RESERVE_RAM_MB || 280
  );

  /** Margen adicional requerido para lanzar compiladores (Docker build / npm / Go / Composer) */
  public static readonly BUILD_HEADROOM_MB = Number(
    process.env.ALPANEL_BUILD_HEADROOM_RAM_MB || 280
  );

  /** Estimación conservadora de RAM adicional por cada contenedor extra a encender */
  public static readonly PER_CONTAINER_ESTIMATE_MB = Number(
    process.env.ALPANEL_PER_CONTAINER_RAM_MB || 70
  );

  /** Porcentaje máximo de uso de RAM permitido antes de abortar en vivo */
  public static readonly CRITICAL_ABORT_PERCENT = 93;

  /** Porcentaje máximo de uso de RAM permitido para iniciar nuevas cargas */
  public static readonly PREFLIGHT_MAX_PERCENT = 91;

  constructor(
    private readonly snapshotProvider?: () => LiveMemorySnapshot
  ) {}

  private isBypassedInUnitTests(): boolean {
    return Boolean(process.env.JEST_WORKER_ID && !this.snapshotProvider);
  }

  readLiveMemorySnapshot(): LiveMemorySnapshot {
    if (this.snapshotProvider) {
      return this.snapshotProvider();
    }

    try {
      if (fs.existsSync('/proc/meminfo')) {
        const content = fs.readFileSync('/proc/meminfo', 'utf-8');
        const parseKb = (key: string): number => {
          const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(content);
          return m ? Number(m[1]) : 0;
        };
        const totalKb = parseKb('MemTotal');
        const availKb = parseKb('MemAvailable') || parseKb('MemFree');
        const swapTotalKb = parseKb('SwapTotal');
        const swapFreeKb = parseKb('SwapFree');

        if (totalKb > 0) {
          const totalMb = Math.round(totalKb / 1024);
          const availableMb = Math.round(availKb / 1024);
          const usedMb = Math.max(0, totalMb - availableMb);
          const usagePercent = Math.round((usedMb / totalMb) * 100);
          return {
            totalMb,
            availableMb,
            usedMb,
            usagePercent,
            swapTotalMb: Math.round(swapTotalKb / 1024),
            swapFreeMb: Math.round(swapFreeKb / 1024),
          };
        }
      }
    } catch {
      // Fallback to os module
    }

    const totalMb = Math.round(os.totalmem() / (1024 * 1024));
    const availableMb = Math.round(os.freemem() / (1024 * 1024));
    const usedMb = Math.max(0, totalMb - availableMb);
    const usagePercent =
      totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;

    return {
      totalMb,
      availableMb,
      usedMb,
      usagePercent,
      swapTotalMb: 0,
      swapFreeMb: 0,
    };
  }

  calculateRequiredAvailableMb(opts: MemoryCheckOptions): number {
    const buildBuffer = opts.requiresBuild
      ? ResourceGuardService.BUILD_HEADROOM_MB
      : 60;
    const extraContainers = Math.max(0, opts.additionalContainersCount || 0);
    const containersBuffer =
      extraContainers * ResourceGuardService.PER_CONTAINER_ESTIMATE_MB;
    return (
      ResourceGuardService.BASE_SAFETY_RESERVE_MB +
      buildBuffer +
      containersBuffer
    );
  }

  assertMemoryAvailableForOperation(opts: MemoryCheckOptions): LiveMemorySnapshot {
    if (this.isBypassedInUnitTests()) {
      return {
        totalMb: 4096,
        availableMb: 2048,
        usedMb: 2048,
        usagePercent: 50,
        swapTotalMb: 0,
        swapFreeMb: 0,
      };
    }

    const snap = this.readLiveMemorySnapshot();
    const requiredMb = this.calculateRequiredAvailableMb(opts);

    if (
      snap.availableMb < requiredMb ||
      snap.usagePercent >= ResourceGuardService.PREFLIGHT_MAX_PERCENT
    ) {
      const msg =
        `⛔ Operación bloqueada preventivamente por Protección de Memoria (RAM Guard): ` +
        `El servidor cuenta con ${snap.availableMb} MB disponibles (${snap.usagePercent}% de ${snap.totalMb} MB en uso) ` +
        `y ejecutar "${opts.operation}" en "${opts.targetProject}" requiere al menos ${requiredMb} MB libres para evitar un colapso OOM en el VPS. ` +
        `Detén contenedores que no estés utilizando o integra menos microservicios.`;
      taskTelemetryService.emitTaskLog(msg, {
        isError: true,
        phase: opts.operation,
      });
      throw new InsufficientServerMemoryException(msg);
    }

    taskTelemetryService.emitTaskLog(
      `[RAM-GUARD] OK — Disponible: ${snap.availableMb} MB / ${snap.totalMb} MB (Requerido mín.: ${requiredMb} MB para "${opts.operation}")`,
      { phase: opts.operation }
    );

    return snap;
  }

  async execWithMemoryWatchdog(
    command: string,
    opts: WatchdogExecOptions
  ): Promise<{ stdout: string; stderr: string }> {
    const timeoutMs = opts.timeout || 180000;
    const inheritedTaskId = taskTelemetryService.getCurrentContext()?.taskId;

    if (!this.isBypassedInUnitTests()) {
      const snap = this.readLiveMemorySnapshot();
      if (
        snap.availableMb < ResourceGuardService.CRITICAL_ABORT_AVAILABLE_MB ||
        snap.usagePercent >= ResourceGuardService.CRITICAL_ABORT_PERCENT
      ) {
        const msg =
          `⛔ Ejecución cancelada antes de iniciar: Memoria libre crítica (${snap.availableMb} MB disponibles / ${snap.usagePercent}% en uso). ` +
          `Se bloqueó "${opts.operation}" en "${opts.targetProject}" para proteger la estabilidad del VPS.`;
        taskTelemetryService.emitTaskLog(msg, {
          isError: true,
          phase: opts.operation,
          explicitTaskId: inheritedTaskId,
        });
        throw new InsufficientServerMemoryException(msg);
      }
    }

    taskTelemetryService.emitTaskLog(`$ ${command}`, {
      phase: opts.operation,
      explicitTaskId: inheritedTaskId,
    });

    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd: opts.cwd,
        env: opts.env || process.env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const MAX_BUF = 8 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      let settled = false;

      const killProcessGroup = () => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore
          }
        }
        setTimeout(() => {
          if (!child.pid) return;
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
        }, 250).unref();
      };

      let watchdogTimer: NodeJS.Timeout | null = null;
      let telemetryTimer: NodeJS.Timeout | null = null;

      const stopTimers = () => {
        if (watchdogTimer) {
          clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        if (telemetryTimer) {
          clearInterval(telemetryTimer);
          telemetryTimer = null;
        }
      };

      if (!this.isBypassedInUnitTests()) {
        if (inheritedTaskId) {
          taskTelemetryService
            .broadcastLiveTelemetry({
              explicitTaskId: inheritedTaskId,
              rootPid: child.pid,
              phase: opts.operation,
              targetProject: opts.targetProject,
              projectDir: opts.cleanupComposeDir || opts.cwd,
              safetyFloorMb: ResourceGuardService.CRITICAL_ABORT_AVAILABLE_MB,
            })
            .catch(() => null);

          telemetryTimer = setInterval(() => {
            if (settled) return;
            taskTelemetryService
              .broadcastLiveTelemetry({
                explicitTaskId: inheritedTaskId,
                rootPid: child.pid,
                phase: opts.operation,
                targetProject: opts.targetProject,
                projectDir: opts.cleanupComposeDir || opts.cwd,
                safetyFloorMb: ResourceGuardService.CRITICAL_ABORT_AVAILABLE_MB,
              })
              .catch(() => null);
          }, 1000);
        }

        watchdogTimer = setInterval(() => {
          if (settled) return;
          const snap = this.readLiveMemorySnapshot();
          if (
            snap.availableMb <
              ResourceGuardService.CRITICAL_ABORT_AVAILABLE_MB ||
            snap.usagePercent >= ResourceGuardService.CRITICAL_ABORT_PERCENT
          ) {
            settled = true;
            stopTimers();
            if (timeoutTimer) clearTimeout(timeoutTimer);

            killProcessGroup();

            if (opts.cleanupComposeDir) {
              exec(
                `docker ps -q --filter "status=created" | xargs -r docker rm -f 2>/dev/null || true`,
                () => {}
              );
            }

            const abortMsg =
              `🛑 Ejecución abortada automáticamente en caliente (RAM Watchdog): ` +
              `La memoria disponible del VPS cayó al umbral crítico (${snap.availableMb} MB libres / ${snap.usagePercent}% usado) ` +
              `durante "${opts.operation}" en "${opts.targetProject}". ` +
              `Se detuvo el subproceso de inmediato para impedir que el servidor se quede sin memoria.`;

            taskTelemetryService.emitTaskLog(abortMsg, {
              isError: true,
              phase: opts.operation,
              explicitTaskId: inheritedTaskId,
            });

            reject(new InsufficientServerMemoryException(abortMsg));
          }
        }, 400);
      }

      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stopTimers();
        killProcessGroup();
        const timeoutMsg = `⏱ Tiempo de espera agotado (${Math.round(
          timeoutMs / 1000
        )}s) ejecutando ${opts.operation} en ${opts.targetProject}.`;
        taskTelemetryService.emitTaskLog(timeoutMsg, {
          isError: true,
          phase: opts.operation,
          explicitTaskId: inheritedTaskId,
        });
        const err: any = new Error(timeoutMsg);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stdout.length < MAX_BUF) {
          stdout += text;
        }
        taskTelemetryService.emitTaskLog(text, {
          isError: false,
          phase: opts.operation,
          explicitTaskId: inheritedTaskId,
        });
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stderr.length < MAX_BUF) {
          stderr += text;
        }
        const looksLikeError = /\b(error|fatal|failed|exception|denied)\b/i.test(
          text
        );
        taskTelemetryService.emitTaskLog(text, {
          isError: looksLikeError,
          phase: opts.operation,
          explicitTaskId: inheritedTaskId,
        });
      });

      child.on('error', (err: any) => {
        if (settled) return;
        settled = true;
        stopTimers();
        clearTimeout(timeoutTimer);
        taskTelemetryService.emitTaskLog(`❌ Error de proceso: ${err.message}`, {
          isError: true,
          phase: opts.operation,
          explicitTaskId: inheritedTaskId,
        });
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        stopTimers();
        clearTimeout(timeoutTimer);

        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const exitMsg =
            stderr.trim() ||
            stdout.trim() ||
            `El comando finalizó con código de salida ${code}`;
          taskTelemetryService.emitTaskLog(
            `❌ Proceso terminado con código ${code}`,
            {
              isError: true,
              phase: opts.operation,
              explicitTaskId: inheritedTaskId,
            }
          );
          const err: any = new Error(exitMsg);
          err.code = code;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        }
      });
    });
  }
}

export const resourceGuardService = new ResourceGuardService();
