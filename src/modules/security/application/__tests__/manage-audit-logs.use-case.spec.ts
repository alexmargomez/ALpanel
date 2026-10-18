import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuditLogRepositoryPort } from '../ports/repositories/audit-log-repository.port';
import { ManageAuditLogsUseCase } from '../use-cases/manage-audit-logs.use-case';
import { AuditLogEntity } from '../../domain/entities/audit-log.entity';

class InMemoryAuditLogRepositoryMock implements AuditLogRepositoryPort {
  private logs: AuditLogEntity[] = [];

  async recordAudit(
    action: string,
    target: string,
    ip: string,
    status: 'ok' | 'error' = 'ok'
  ): Promise<void> {
    this.logs.unshift({
      id: this.logs.length + 1,
      timestamp: new Date().toISOString(),
      action,
      target,
      ip,
      status,
    });
  }

  async getAuditLogs(limit = 150): Promise<AuditLogEntity[]> {
    return this.logs.slice(0, limit);
  }
}

describe('Security Module — ManageAuditLogsUseCase', () => {
  it('registra eventos de auditoría y respeta el límite de consulta', async () => {
    const repo = new InMemoryAuditLogRepositoryMock();
    const useCase = new ManageAuditLogsUseCase(repo);

    await useCase.recordAudit('LOGIN', 'superadmin', '192.168.1.10', 'ok');
    await useCase.recordAudit('GIT_PULL', 'hc_version2', '192.168.1.10', 'ok');
    await useCase.recordAudit('UFW_DENY', 'port:3306', '10.0.0.5', 'error');

    const allLogs = await useCase.getAuditLogs();
    assert.equal(allLogs.length, 3);
    assert.equal(allLogs[0].action, 'UFW_DENY');
    assert.equal(allLogs[0].status, 'error');

    const topTwo = await useCase.getAuditLogs(2);
    assert.equal(topTwo.length, 2);
    assert.equal(topTwo[1].action, 'GIT_PULL');
  });
});
