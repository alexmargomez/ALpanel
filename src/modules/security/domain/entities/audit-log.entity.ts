export interface AuditLogEntity {
  id: number;
  timestamp: string;
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
}

export type AuditLogDto = AuditLogEntity;

export interface RateLimitShieldConfig {
  enabled: boolean;
  baseCapacity: number;
  refillRatePerSec: number;
  cpuWarningThreshold: number;
  cpuCriticalThreshold: number;
  blockDurationSec: number;
  strikeThreshold: number;
}

export interface BlockedIpInfo {
  ip: string;
  blockedAt: string;
  expiresAt: string;
  remainingSec: number;
  reason: string;
  blockedHits: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  statusCode: 200 | 429;
  reason: 'ALLOWED' | 'TOKEN_BUCKET_EXHAUSTED' | 'IP_BLOCKED_MEMORY';
  remainingTokens: number;
  effectiveCapacity: number;
  effectiveRefillPerSec: number;
  dynamicScaleFactor: number;
  protectionMode: 'NORMAL' | 'THROTTLING_CPU_HIGH' | 'CRITICAL_DDOS_SHIELD';
  retryAfterSec: number;
  latencyMs: number;
}

export interface RateLimitShieldStatus {
  config: RateLimitShieldConfig;
  currentCpuPercent: number;
  currentMemoryPercent: number;
  dynamicScaleFactor: number;
  effectiveCapacity: number;
  effectiveRefillPerSec: number;
  protectionMode: 'NORMAL' | 'THROTTLING_CPU_HIGH' | 'CRITICAL_DDOS_SHIELD';
  activeIpBuckets: number;
  blockedIps: BlockedIpInfo[];
  metrics: {
    totalEvaluated: number;
    totalAllowed: number;
    totalThrottled: number;
    totalBlockedHits: number;
    lastDecisionLatencyMs: number;
    avgDecisionLatencyMs: number;
  };
}

export interface BatchIngestEngineStatus {
  bufferSize: number;
  maxBufferCapacity: number;
  batchFlushThreshold: number;
  flushIntervalMs: number;
  backpressureState: 'HEALTHY' | 'ELEVATED' | 'BACKPRESSURE_429';
  totalEventsIngested: number;
  totalSqlBatchesFlushed: number;
  totalSqlOperationsSaved: number;
  lastFlushCount: number;
  lastFlushDurationMs: number;
  lastFlushAt: string | null;
  avgIngestMemoryLatencyMs: number;
}

export interface DdosSimulationResult {
  simulatedIp: string;
  totalRequests: number;
  simulatedCpuPercent: number;
  dynamicScaleFactor: number;
  effectiveCapacity: number;
  allowedCount: number;
  throttledCount: number;
  blockedMemoryCount: number;
  ipWasBlocked: boolean;
  totalDurationMs: number;
  avgLatencyPerDecisionMs: number;
}

export interface BatchIngestSimulationResult {
  accepted: boolean;
  statusCode: 200 | 429;
  ingestedCount: number;
  bufferSizeAfter: number;
  flushedToDbCount: number;
  sqlBatchesExecuted: number;
  sqlWritesSaved: number;
  memoryEnqueueDurationMs: number;
  dbFlushDurationMs: number;
  throughputEventsPerSec: number;
  backpressureState: 'HEALTHY' | 'ELEVATED' | 'BACKPRESSURE_429';
  message: string;
}
