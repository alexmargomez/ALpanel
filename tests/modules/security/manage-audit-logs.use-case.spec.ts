import { AuditLogRepositoryPort } from '../../../src/modules/security/application/ports/repositories/audit-log-repository.port';
import { ManageAuditLogsUseCase } from '../../../src/modules/security/application/use-cases/manage-audit-logs.use-case';
import { AuditLogEntity } from '../../../src/modules/security/domain/entities/audit-log.entity';

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
    expect(allLogs).toHaveLength(3);
    expect(allLogs[0].action).toBe('UFW_DENY');
    expect(allLogs[0].status).toBe('error');

    const topTwo = await useCase.getAuditLogs(2);
    expect(topTwo).toHaveLength(2);
    expect(topTwo[1].action).toBe('GIT_PULL');
  });

  it('reduce dinámicamente el límite del Token Bucket cuando la CPU supera el 80% y bloquea IPs atacantes en < 2ms', async () => {
    const repo = new InMemoryAuditLogRepositoryMock();
    const useCase = new ManageAuditLogsUseCase(repo);

    useCase.updateShieldConfig({
      baseCapacity: 40,
      refillRatePerSec: 10,
      cpuWarningThreshold: 70,
      cpuCriticalThreshold: 80,
      strikeThreshold: 5,
      blockDurationSec: 120,
    });

    const sim = await useCase.simulateDdosAttack({
      requestsCount: 50,
      simulatedIp: '203.0.113.99',
      simulatedCpuPercent: 85,
    });

    // Con CPU al 85% (>=80%), el factor dinámico es 0.25 -> capacidad efectiva = 10 tokens
    expect(sim.dynamicScaleFactor).toBe(0.25);
    expect(sim.effectiveCapacity).toBe(10);
    expect(sim.allowedCount).toBeLessThanOrEqual(11);
    expect(sim.throttledCount).toBeGreaterThan(0);
    expect(sim.ipWasBlocked).toBe(true);
    expect(sim.avgLatencyPerDecisionMs).toBeLessThan(2);

    const status = useCase.getShieldStatus();
    expect(status.blockedIps.some((b) => b.ip === '203.0.113.99')).toBe(true);

    // Desbloqueo manual desde memoria volátil
    const afterUnblock = useCase.unblockIp('203.0.113.99');
    expect(afterUnblock.blockedIps.some((b) => b.ip === '203.0.113.99')).toBe(false);
  });

  it('procesa ráfagas de ingesta masiva por lotes calculando las operaciones SQL ahorradas', async () => {
    const repo = new InMemoryAuditLogRepositoryMock();
    const useCase = new ManageAuditLogsUseCase(repo);

    const result = await useCase.simulateBatchIngest(1200, true);

    expect(result.accepted).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.ingestedCount).toBe(1200);
    expect(result.sqlWritesSaved).toBeGreaterThan(1000);
  });
});

