import { AuditLogEntity } from '../../../domain/entities/audit-log.entity';

export interface AuditLogRepositoryPort {
  recordAudit(
    action: string,
    target: string,
    ip: string,
    status?: 'ok' | 'error'
  ): Promise<void>;
  getAuditLogs(limit?: number): Promise<AuditLogEntity[]>;
}
