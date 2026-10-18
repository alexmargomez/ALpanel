import { AuditLogRepositoryPort } from '../../application/ports/repositories/audit-log-repository.port';
import { AuditLogEntity } from '../../domain/entities/audit-log.entity';
import { securityService } from '../../security.service';

export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  recordAudit(
    action: string,
    target: string,
    ip: string,
    status: 'ok' | 'error' = 'ok'
  ): Promise<void> {
    return securityService.recordAudit(action, target, ip, status);
  }

  getAuditLogs(limit = 150): Promise<AuditLogEntity[]> {
    return securityService.getAuditLogs(limit);
  }
}

export const prismaAuditLogRepository = new PrismaAuditLogRepository();
