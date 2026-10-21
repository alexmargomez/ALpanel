import { prisma } from '../../../../shared/infrastructure/database/prisma.service';
import {
  AuditLogRepositoryPort,
  RawIngestEvent,
} from '../../application/ports/repositories/audit-log-repository.port';
import {
  AuditLogEntity,
  BatchIngestEngineStatus,
  BatchIngestSimulationResult,
} from '../../domain/entities/audit-log.entity';

interface BufferedAuditRow {
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
  createdAt: Date;
}

export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  private memoryFallback: AuditLogEntity[] = [];
  private writeBuffer: BufferedAuditRow[] = [];
  private isFlushing = false;
  private flushTimer: NodeJS.Timeout | null = null;

  private readonly maxBufferCapacity = 25000;
  private readonly batchFlushThreshold = 500;
  private readonly flushIntervalMs = 2000;

  private totalEventsIngested = 0;
  private totalSqlBatchesFlushed = 0;
  private lastFlushCount = 0;
  private lastFlushDurationMs = 0;
  private lastFlushAt: string | null = null;
  private totalIngestMemoryNs = 0n;
  private totalIngestCalls = 0;

  constructor() {
    this.startPeriodicFlush();
  }

  private startPeriodicFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.writeBuffer.length > 0 && !this.isFlushing) {
        this.flushBufferNow().catch(() => null);
      }
    }, this.flushIntervalMs);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private computeBackpressureState():
    | 'HEALTHY'
    | 'ELEVATED'
    | 'BACKPRESSURE_429' {
    const ratio = this.writeBuffer.length / this.maxBufferCapacity;
    if (
      ratio >= 0.85 ||
      (this.lastFlushDurationMs > 1200 && this.writeBuffer.length > 2000)
    ) {
      return 'BACKPRESSURE_429';
    }
    if (ratio >= 0.4 || this.lastFlushDurationMs > 450) {
      return 'ELEVATED';
    }
    return 'HEALTHY';
  }

  getIngestStatus(): BatchIngestEngineStatus {
    const avgMs =
      this.totalIngestCalls > 0
        ? Number(this.totalIngestMemoryNs / BigInt(this.totalIngestCalls)) /
          1_000_000
        : 0.01;
    const saved = Math.max(
      0,
      this.totalEventsIngested - this.totalSqlBatchesFlushed
    );

    return {
      bufferSize: this.writeBuffer.length,
      maxBufferCapacity: this.maxBufferCapacity,
      batchFlushThreshold: this.batchFlushThreshold,
      flushIntervalMs: this.flushIntervalMs,
      backpressureState: this.computeBackpressureState(),
      totalEventsIngested: this.totalEventsIngested,
      totalSqlBatchesFlushed: this.totalSqlBatchesFlushed,
      totalSqlOperationsSaved: saved,
      lastFlushCount: this.lastFlushCount,
      lastFlushDurationMs: Math.round(this.lastFlushDurationMs * 100) / 100,
      lastFlushAt: this.lastFlushAt,
      avgIngestMemoryLatencyMs: Math.round(avgMs * 1000) / 1000,
    };
  }

  async flushBufferNow(): Promise<{ flushedCount: number; durationMs: number }> {
    if (this.isFlushing || this.writeBuffer.length === 0) {
      return { flushedCount: 0, durationMs: 0 };
    }

    this.isFlushing = true;
    const startNs = process.hrtime.bigint();
    let totalFlushed = 0;

    try {
      while (this.writeBuffer.length > 0) {
        const chunk = this.writeBuffer.splice(0, 2500);
        try {
          await prisma.auditLog.createMany({
            data: chunk.map((item) => ({
              action: item.action,
              target: item.target,
              ip: item.ip,
              status: item.status,
              createdAt: item.createdAt,
            })),
          });
          totalFlushed += chunk.length;
          this.totalSqlBatchesFlushed += 1;
        } catch {
          // Si la BD no está lista aún, mantenemos la muestra en memoryFallback
          break;
        }
      }

      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      if (totalFlushed > 0) {
        this.lastFlushCount = totalFlushed;
        this.lastFlushDurationMs = elapsedMs;
        this.lastFlushAt = new Date().toISOString();
      }
      return {
        flushedCount: totalFlushed,
        durationMs: Math.round(elapsedMs * 100) / 100,
      };
    } finally {
      this.isFlushing = false;
    }
  }

  async enqueueBatch(
    events: RawIngestEvent[],
    flushImmediately = false
  ): Promise<BatchIngestSimulationResult> {
    const startNs = process.hrtime.bigint();
    const stateBefore = this.computeBackpressureState();

    if (
      stateBefore === 'BACKPRESSURE_429' ||
      this.writeBuffer.length + events.length > this.maxBufferCapacity
    ) {
      return {
        accepted: false,
        statusCode: 429,
        ingestedCount: 0,
        bufferSizeAfter: this.writeBuffer.length,
        flushedToDbCount: 0,
        sqlBatchesExecuted: 0,
        sqlWritesSaved: 0,
        memoryEnqueueDurationMs: 0,
        dbFlushDurationMs: 0,
        throughputEventsPerSec: 0,
        backpressureState: 'BACKPRESSURE_429',
        message:
          'HTTP 429 Backpressure Activo: El buffer de memoria superó el umbral de seguridad para proteger MariaDB.',
      };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const baseId = Date.now();

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const cleanAction = (ev.action || 'EVENT').slice(0, 100);
      const cleanTarget = (ev.target || '-').slice(0, 255);
      const cleanIp = (ev.ip || '127.0.0.1').slice(0, 100);
      const cleanStatus: 'ok' | 'error' =
        ev.status === 'error' ? 'error' : 'ok';

      this.writeBuffer.push({
        action: cleanAction,
        target: cleanTarget,
        ip: cleanIp,
        status: cleanStatus,
        createdAt: now,
      });

      if (i === 0 || events.length <= 20 || i === events.length - 1) {
        this.memoryFallback.unshift({
          id: baseId + i,
          timestamp: nowIso,
          action: cleanAction,
          target: cleanTarget,
          ip: cleanIp,
          status: cleanStatus,
        });
      }
    }

    if (this.memoryFallback.length > 250) {
      this.memoryFallback.length = 250;
    }

    const memElapsedNs = process.hrtime.bigint() - startNs;
    const memDurationMs = Number(memElapsedNs) / 1_000_000;
    this.totalEventsIngested += events.length;
    this.totalIngestMemoryNs += memElapsedNs;
    this.totalIngestCalls += 1;

    let flushedCount = 0;
    let dbDurationMs = 0;
    const batchesBefore = this.totalSqlBatchesFlushed;

    if (
      flushImmediately ||
      this.writeBuffer.length >= this.batchFlushThreshold
    ) {
      const flushRes = await this.flushBufferNow();
      flushedCount = flushRes.flushedCount;
      dbDurationMs = flushRes.durationMs;
    }

    const batchesUsed = Math.max(
      0,
      this.totalSqlBatchesFlushed - batchesBefore
    );
    const totalTimeSec = Math.max(
      0.0001,
      (memDurationMs + dbDurationMs) / 1000
    );
    const throughput = Math.round(events.length / totalTimeSec);
    const writesSaved = Math.max(0, events.length - Math.max(1, batchesUsed));

    return {
      accepted: true,
      statusCode: 200,
      ingestedCount: events.length,
      bufferSizeAfter: this.writeBuffer.length,
      flushedToDbCount: flushedCount,
      sqlBatchesExecuted: batchesUsed,
      sqlWritesSaved: writesSaved,
      memoryEnqueueDurationMs: Math.round(memDurationMs * 1000) / 1000,
      dbFlushDurationMs: dbDurationMs,
      throughputEventsPerSec: throughput,
      backpressureState: this.computeBackpressureState(),
      message:
        flushedCount > 0
          ? `Lote de ${events.length} eventos procesado en memoria (${memDurationMs.toFixed(
              2
            )}ms) y volcado en bloque a MariaDB en ${batchesUsed} transacción(es) SQL (${dbDurationMs.toFixed(
              1
            )}ms). Se ahorraron ${writesSaved} escrituras individuales a disco.`
          : `${events.length} eventos encolados en el Ring Buffer en ${memDurationMs.toFixed(
              2
            )}ms (esperando lote de ${this.batchFlushThreshold} o ventana de ${
              this.flushIntervalMs / 1000
            }s).`,
    };
  }

  async recordAudit(
    action: string,
    target: string,
    ip: string,
    status: 'ok' | 'error' = 'ok'
  ): Promise<void> {
    await this.enqueueBatch([{ action, target, ip, status }], false);
  }

  async getAuditLogs(limit = 150): Promise<AuditLogEntity[]> {
    if (this.writeBuffer.length > 0 && !this.isFlushing) {
      await this.flushBufferNow().catch(() => null);
    }
    try {
      const rows = await prisma.auditLog.findMany({
        orderBy: { id: 'desc' },
        take: limit,
      });
      if (rows.length > 0) {
        return rows.map((r: any) => ({
          id: r.id,
          timestamp: r.createdAt.toISOString(),
          action: r.action,
          target: r.target,
          ip: r.ip,
          status: (r.status === 'error' ? 'error' : 'ok') as 'ok' | 'error',
        }));
      }
    } catch {
      // Fallback en memoria si la BD está reiniciando
    }
    return this.memoryFallback.slice(0, limit);
  }
}

export const prismaAuditLogRepository = new PrismaAuditLogRepository();
