import {
  AuditLogEntity,
  BatchIngestEngineStatus,
  BatchIngestSimulationResult,
} from '../../../domain/entities/audit-log.entity';

export interface RawIngestEvent {
  action: string;
  target: string;
  ip?: string;
  status?: 'ok' | 'error';
}

export interface AuditLogRepositoryPort {
  recordAudit(
    action: string,
    target: string,
    ip: string,
    status?: 'ok' | 'error'
  ): Promise<void>;
  getAuditLogs(limit?: number): Promise<AuditLogEntity[]>;
  enqueueBatch?(
    events: RawIngestEvent[],
    flushImmediately?: boolean
  ): Promise<BatchIngestSimulationResult>;
  flushBufferNow?(): Promise<{ flushedCount: number; durationMs: number }>;
  getIngestStatus?(): BatchIngestEngineStatus;
}
