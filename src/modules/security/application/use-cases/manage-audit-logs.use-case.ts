import {
  AuditLogRepositoryPort,
  RawIngestEvent,
} from '../ports/repositories/audit-log-repository.port';
import { prismaAuditLogRepository } from '../../infrastructure/repositories/prisma-audit-log.repository';
import {
  BatchIngestEngineStatus,
  BatchIngestSimulationResult,
  BlockedIpInfo,
  DdosSimulationResult,
  RateLimitDecision,
  RateLimitShieldConfig,
  RateLimitShieldStatus,
} from '../../domain/entities/audit-log.entity';

interface TokenBucketEntry {
  tokens: number;
  lastRefillMs: number;
  strikes: number;
}

interface BlockedIpRecord {
  ip: string;
  blockedAtMs: number;
  expiresAtMs: number;
  reason: string;
  blockedHits: number;
}

export class ManageAuditLogsUseCase {
  private shieldConfig: RateLimitShieldConfig = {
    enabled: true,
    baseCapacity: 120,
    refillRatePerSec: 25,
    cpuWarningThreshold: 70,
    cpuCriticalThreshold: 80,
    blockDurationSec: 60,
    strikeThreshold: 15,
  };

  private buckets = new Map<string, TokenBucketEntry>();
  private blockedIps = new Map<string, BlockedIpRecord>();

  private currentCpuPercent = 8;
  private currentMemoryPercent = 35;

  private totalEvaluated = 0;
  private totalAllowed = 0;
  private totalThrottled = 0;
  private totalBlockedHits = 0;
  private lastDecisionLatencyMs = 0.02;
  private totalDecisionNs = 0n;

  constructor(
    private readonly repository: AuditLogRepositoryPort = prismaAuditLogRepository
  ) {}

  recordAudit(
    action: string,
    target: string,
    ip: string,
    status: 'ok' | 'error' = 'ok'
  ) {
    return this.repository.recordAudit(action, target, ip, status);
  }

  getAuditLogs(limit = 150) {
    return this.repository.getAuditLogs(limit);
  }

  updateLiveHostLoad(cpuPercent: number, memoryPercent: number): void {
    if (Number.isFinite(cpuPercent) && cpuPercent >= 0) {
      this.currentCpuPercent = Math.round(cpuPercent * 10) / 10;
    }
    if (Number.isFinite(memoryPercent) && memoryPercent >= 0) {
      this.currentMemoryPercent = Math.round(memoryPercent * 10) / 10;
    }
  }

  private computeDynamicScale(cpuPercent: number): {
    scaleFactor: number;
    effectiveCapacity: number;
    effectiveRefillPerSec: number;
    protectionMode:
      | 'NORMAL'
      | 'THROTTLING_CPU_HIGH'
      | 'CRITICAL_DDOS_SHIELD';
  } {
    let scaleFactor = 1.0;
    let protectionMode:
      | 'NORMAL'
      | 'THROTTLING_CPU_HIGH'
      | 'CRITICAL_DDOS_SHIELD' = 'NORMAL';

    if (cpuPercent >= this.shieldConfig.cpuCriticalThreshold) {
      scaleFactor = 0.25;
      protectionMode = 'CRITICAL_DDOS_SHIELD';
    } else if (cpuPercent >= this.shieldConfig.cpuWarningThreshold) {
      scaleFactor = 0.6;
      protectionMode = 'THROTTLING_CPU_HIGH';
    }

    const effectiveCapacity = Math.max(
      5,
      Math.round(this.shieldConfig.baseCapacity * scaleFactor)
    );
    const effectiveRefillPerSec = Math.max(
      1,
      Math.round(this.shieldConfig.refillRatePerSec * scaleFactor * 10) / 10
    );

    return {
      scaleFactor,
      effectiveCapacity,
      effectiveRefillPerSec,
      protectionMode,
    };
  }

  private pruneExpiredMemoryEntries(nowMs: number): void {
    for (const [ip, rec] of this.blockedIps.entries()) {
      if (nowMs >= rec.expiresAtMs) {
        this.blockedIps.delete(ip);
      }
    }
    if (this.buckets.size > 5000) {
      for (const [ip, b] of this.buckets.entries()) {
        if (nowMs - b.lastRefillMs > 120000) {
          this.buckets.delete(ip);
        }
      }
    }
  }

  evaluateRequest(
    rawIp: string,
    _path = '/api',
    cpuOverride?: number
  ): RateLimitDecision {
    const startNs = process.hrtime.bigint();
    const nowMs = Date.now();
    const ip = (rawIp || '127.0.0.1').trim();
    const cpu =
      cpuOverride !== undefined ? cpuOverride : this.currentCpuPercent;

    const {
      scaleFactor,
      effectiveCapacity,
      effectiveRefillPerSec,
      protectionMode,
    } = this.computeDynamicScale(cpu);

    if (!this.shieldConfig.enabled) {
      const elapsedNs = process.hrtime.bigint() - startNs;
      const latencyMs = Number(elapsedNs) / 1_000_000;
      return {
        allowed: true,
        statusCode: 200,
        reason: 'ALLOWED',
        remainingTokens: effectiveCapacity,
        effectiveCapacity,
        effectiveRefillPerSec,
        dynamicScaleFactor: scaleFactor,
        protectionMode,
        retryAfterSec: 0,
        latencyMs: Math.round(latencyMs * 1000) / 1000,
      };
    }

    // 1. Verificar bloqueo atómico de IP en memoria volátil (O(1))
    const blocked = this.blockedIps.get(ip);
    if (blocked) {
      if (nowMs < blocked.expiresAtMs) {
        blocked.blockedHits += 1;
        this.totalEvaluated += 1;
        this.totalBlockedHits += 1;
        const elapsedNs = process.hrtime.bigint() - startNs;
        const latencyMs = Number(elapsedNs) / 1_000_000;
        this.lastDecisionLatencyMs = latencyMs;
        this.totalDecisionNs += elapsedNs;
        return {
          allowed: false,
          statusCode: 429,
          reason: 'IP_BLOCKED_MEMORY',
          remainingTokens: 0,
          effectiveCapacity,
          effectiveRefillPerSec,
          dynamicScaleFactor: scaleFactor,
          protectionMode,
          retryAfterSec: Math.max(
            1,
            Math.ceil((blocked.expiresAtMs - nowMs) / 1000)
          ),
          latencyMs: Math.round(latencyMs * 1000) / 1000,
        };
      } else {
        this.blockedIps.delete(ip);
      }
    }

    // 2. Algoritmo Token Bucket en memoria volátil (O(1))
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      if (this.buckets.size > 5000) {
        this.pruneExpiredMemoryEntries(nowMs);
      }
      bucket = {
        tokens: effectiveCapacity,
        lastRefillMs: nowMs,
        strikes: 0,
      };
      this.buckets.set(ip, bucket);
    } else {
      const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
      if (elapsedSec > 0) {
        bucket.tokens = Math.min(
          effectiveCapacity,
          bucket.tokens + elapsedSec * effectiveRefillPerSec
        );
        bucket.lastRefillMs = nowMs;
      } else if (bucket.tokens > effectiveCapacity) {
        bucket.tokens = effectiveCapacity;
      }
    }

    this.totalEvaluated += 1;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.strikes = Math.max(0, bucket.strikes - 0.15);
      this.totalAllowed += 1;

      const elapsedNs = process.hrtime.bigint() - startNs;
      const latencyMs = Number(elapsedNs) / 1_000_000;
      this.lastDecisionLatencyMs = latencyMs;
      this.totalDecisionNs += elapsedNs;

      return {
        allowed: true,
        statusCode: 200,
        reason: 'ALLOWED',
        remainingTokens: Math.floor(bucket.tokens),
        effectiveCapacity,
        effectiveRefillPerSec,
        dynamicScaleFactor: scaleFactor,
        protectionMode,
        retryAfterSec: 0,
        latencyMs: Math.round(latencyMs * 1000) / 1000,
      };
    }

    // 3. Bucket agotado -> Throttling HTTP 429 y penalización de ráfaga DDoS
    this.totalThrottled += 1;
    const strikeIncrement = scaleFactor < 1 ? 2 : 1;
    bucket.strikes += strikeIncrement;

    if (bucket.strikes >= this.shieldConfig.strikeThreshold) {
      const durationMs = this.shieldConfig.blockDurationSec * 1000;
      this.blockedIps.set(ip, {
        ip,
        blockedAtMs: nowMs,
        expiresAtMs: nowMs + durationMs,
        reason: `Ráfaga DDoS detectada (Token Bucket agotado + ${Math.round(
          bucket.strikes
        )} strikes con CPU al ${cpu}%)`,
        blockedHits: 1,
      });
      bucket.strikes = 0;
      this.recordAudit(
        'DDOS_SHIELD_BLOCK',
        `IP bloqueada en RAM por ${this.shieldConfig.blockDurationSec}s (Capacidad dinámica: ${effectiveCapacity} tokens, CPU: ${cpu}%)`,
        ip,
        'error'
      ).catch(() => null);
    }

    const elapsedNs = process.hrtime.bigint() - startNs;
    const latencyMs = Number(elapsedNs) / 1_000_000;
    this.lastDecisionLatencyMs = latencyMs;
    this.totalDecisionNs += elapsedNs;

    return {
      allowed: false,
      statusCode: 429,
      reason: 'TOKEN_BUCKET_EXHAUSTED',
      remainingTokens: 0,
      effectiveCapacity,
      effectiveRefillPerSec,
      dynamicScaleFactor: scaleFactor,
      protectionMode,
      retryAfterSec: Math.max(1, Math.ceil(1 / effectiveRefillPerSec)),
      latencyMs: Math.round(latencyMs * 1000) / 1000,
    };
  }

  getShieldStatus(): RateLimitShieldStatus {
    const nowMs = Date.now();
    this.pruneExpiredMemoryEntries(nowMs);

    const {
      scaleFactor,
      effectiveCapacity,
      effectiveRefillPerSec,
      protectionMode,
    } = this.computeDynamicScale(this.currentCpuPercent);

    const blockedList: BlockedIpInfo[] = Array.from(
      this.blockedIps.values()
    ).map((b) => ({
      ip: b.ip,
      blockedAt: new Date(b.blockedAtMs).toISOString(),
      expiresAt: new Date(b.expiresAtMs).toISOString(),
      remainingSec: Math.max(0, Math.ceil((b.expiresAtMs - nowMs) / 1000)),
      reason: b.reason,
      blockedHits: b.blockedHits,
    }));

    const avgLatencyMs =
      this.totalEvaluated > 0
        ? Number(this.totalDecisionNs / BigInt(this.totalEvaluated)) / 1_000_000
        : 0.02;

    return {
      config: { ...this.shieldConfig },
      currentCpuPercent: this.currentCpuPercent,
      currentMemoryPercent: this.currentMemoryPercent,
      dynamicScaleFactor: scaleFactor,
      effectiveCapacity,
      effectiveRefillPerSec,
      protectionMode,
      activeIpBuckets: this.buckets.size,
      blockedIps: blockedList,
      metrics: {
        totalEvaluated: this.totalEvaluated,
        totalAllowed: this.totalAllowed,
        totalThrottled: this.totalThrottled,
        totalBlockedHits: this.totalBlockedHits,
        lastDecisionLatencyMs:
          Math.round(this.lastDecisionLatencyMs * 1000) / 1000,
        avgDecisionLatencyMs: Math.round(avgLatencyMs * 1000) / 1000,
      },
    };
  }

  updateShieldConfig(
    partial: Partial<RateLimitShieldConfig>
  ): RateLimitShieldStatus {
    if (typeof partial.enabled === 'boolean') {
      this.shieldConfig.enabled = partial.enabled;
    }
    if (
      typeof partial.baseCapacity === 'number' &&
      partial.baseCapacity >= 10 &&
      partial.baseCapacity <= 10000
    ) {
      this.shieldConfig.baseCapacity = Math.round(partial.baseCapacity);
    }
    if (
      typeof partial.refillRatePerSec === 'number' &&
      partial.refillRatePerSec >= 1 &&
      partial.refillRatePerSec <= 5000
    ) {
      this.shieldConfig.refillRatePerSec = Math.round(partial.refillRatePerSec);
    }
    if (
      typeof partial.cpuWarningThreshold === 'number' &&
      partial.cpuWarningThreshold >= 30 &&
      partial.cpuWarningThreshold <= 95
    ) {
      this.shieldConfig.cpuWarningThreshold = Math.round(
        partial.cpuWarningThreshold
      );
    }
    if (
      typeof partial.cpuCriticalThreshold === 'number' &&
      partial.cpuCriticalThreshold >= 40 &&
      partial.cpuCriticalThreshold <= 99
    ) {
      this.shieldConfig.cpuCriticalThreshold = Math.round(
        partial.cpuCriticalThreshold
      );
    }
    if (
      typeof partial.blockDurationSec === 'number' &&
      partial.blockDurationSec >= 5 &&
      partial.blockDurationSec <= 86400
    ) {
      this.shieldConfig.blockDurationSec = Math.round(partial.blockDurationSec);
    }
    if (
      typeof partial.strikeThreshold === 'number' &&
      partial.strikeThreshold >= 3 &&
      partial.strikeThreshold <= 500
    ) {
      this.shieldConfig.strikeThreshold = Math.round(partial.strikeThreshold);
    }
    return this.getShieldStatus();
  }

  unblockIp(ip: string): RateLimitShieldStatus {
    const clean = (ip || '').trim();
    this.blockedIps.delete(clean);
    this.buckets.delete(clean);
    return this.getShieldStatus();
  }

  clearAllBlockedIps(): RateLimitShieldStatus {
    this.blockedIps.clear();
    this.buckets.clear();
    return this.getShieldStatus();
  }

  async simulateDdosAttack(payload: {
    requestsCount?: number;
    simulatedIp?: string;
    simulatedCpuPercent?: number;
  }): Promise<DdosSimulationResult> {
    const totalRequests = Math.min(
      5000,
      Math.max(20, Number(payload.requestsCount) || 300)
    );
    const simulatedIp =
      (payload.simulatedIp || '').trim() ||
      `203.0.113.${Math.floor(10 + Math.random() * 230)}`;
    const simulatedCpuPercent =
      payload.simulatedCpuPercent !== undefined
        ? Number(payload.simulatedCpuPercent)
        : this.currentCpuPercent;

    // Limpiar estado previo de esa IP simulada para medir el ciclo completo limpio
    this.blockedIps.delete(simulatedIp);
    this.buckets.delete(simulatedIp);

    const startNs = process.hrtime.bigint();
    let allowedCount = 0;
    let throttledCount = 0;
    let blockedMemoryCount = 0;
    let lastDecision: RateLimitDecision | null = null;

    for (let i = 0; i < totalRequests; i++) {
      const dec = this.evaluateRequest(
        simulatedIp,
        '/api/simulate-ddos',
        simulatedCpuPercent
      );
      lastDecision = dec;
      if (dec.allowed) {
        allowedCount += 1;
      } else if (dec.reason === 'IP_BLOCKED_MEMORY') {
        blockedMemoryCount += 1;
      } else {
        throttledCount += 1;
      }
    }

    const totalDurationMs =
      Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const avgLatencyPerDecisionMs = totalDurationMs / totalRequests;

    return {
      simulatedIp,
      totalRequests,
      simulatedCpuPercent,
      dynamicScaleFactor: lastDecision?.dynamicScaleFactor ?? 1,
      effectiveCapacity:
        lastDecision?.effectiveCapacity ?? this.shieldConfig.baseCapacity,
      allowedCount,
      throttledCount,
      blockedMemoryCount,
      ipWasBlocked: this.blockedIps.has(simulatedIp),
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      avgLatencyPerDecisionMs:
        Math.round(avgLatencyPerDecisionMs * 10000) / 10000,
    };
  }

  getIngestEngineStatus(): BatchIngestEngineStatus {
    if (this.repository.getIngestStatus) {
      return this.repository.getIngestStatus();
    }
    return {
      bufferSize: 0,
      maxBufferCapacity: 25000,
      batchFlushThreshold: 500,
      flushIntervalMs: 2000,
      backpressureState: 'HEALTHY',
      totalEventsIngested: 0,
      totalSqlBatchesFlushed: 0,
      totalSqlOperationsSaved: 0,
      lastFlushCount: 0,
      lastFlushDurationMs: 0,
      lastFlushAt: null,
      avgIngestMemoryLatencyMs: 0.01,
    };
  }

  async ingestBatchEvents(
    events: RawIngestEvent[],
    flushImmediately = false
  ): Promise<BatchIngestSimulationResult> {
    if (this.repository.enqueueBatch) {
      return this.repository.enqueueBatch(events, flushImmediately);
    }
    for (const ev of events) {
      await this.repository.recordAudit(
        ev.action,
        ev.target,
        ev.ip || '127.0.0.1',
        ev.status || 'ok'
      );
    }
    return {
      accepted: true,
      statusCode: 200,
      ingestedCount: events.length,
      bufferSizeAfter: 0,
      flushedToDbCount: events.length,
      sqlBatchesExecuted: 1,
      sqlWritesSaved: Math.max(0, events.length - 1),
      memoryEnqueueDurationMs: 0.1,
      dbFlushDurationMs: 1,
      throughputEventsPerSec: events.length * 1000,
      backpressureState: 'HEALTHY',
      message: `${events.length} eventos procesados.`,
    };
  }

  async simulateBatchIngest(
    count = 1000,
    flushImmediately = true
  ): Promise<BatchIngestSimulationResult> {
    const safeCount = Math.min(10000, Math.max(10, Number(count) || 1000));
    const sampleActions = [
      'API_METRIC_INGEST',
      'CONTAINER_HEALTH_PING',
      'SSL_PROXY_ACCESS',
      'DB_QUERY_TELEMETRY',
      'AUTH_TOKEN_VERIFY',
    ];
    const sampleTargets = [
      'API_SM/cie10',
      'API_SM/cups',
      'API_SM/fhir-inspector',
      'alpanel_caddy/https',
      'alpanel_server/metrics',
    ];

    const batch: RawIngestEvent[] = new Array(safeCount);
    for (let i = 0; i < safeCount; i++) {
      batch[i] = {
        action: sampleActions[i % sampleActions.length],
        target: `${sampleTargets[i % sampleTargets.length]} [lote #${i + 1}]`,
        ip: `10.24.${(i % 10) + 1}.${(i % 200) + 10}`,
        status: i % 25 === 0 ? 'error' : 'ok',
      };
    }

    return this.ingestBatchEvents(batch, flushImmediately);
  }

  async flushIngestBufferNow(): Promise<{
    flushedCount: number;
    durationMs: number;
  }> {
    if (this.repository.flushBufferNow) {
      return this.repository.flushBufferNow();
    }
    return { flushedCount: 0, durationMs: 0 };
  }
}

export const manageAuditLogsUseCase = new ManageAuditLogsUseCase();
