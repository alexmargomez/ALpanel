import { AuditLogRepositoryPort } from '../ports/repositories/audit-log-repository.port';
import { prismaAuditLogRepository } from '../../infrastructure/repositories/prisma-audit-log.repository';

export class ManageAuditLogsUseCase {
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
}

export const manageAuditLogsUseCase = new ManageAuditLogsUseCase();
