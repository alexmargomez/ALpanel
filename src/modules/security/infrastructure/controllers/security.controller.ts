import { FastifyReply, FastifyRequest } from 'fastify';
import { manageAuditLogsUseCase } from '../../application/use-cases/manage-audit-logs.use-case';
import { hostService } from '../../../../shared/infrastructure/services/host-metrics.service';
import { RateLimitShieldConfig } from '../../domain/entities/audit-log.entity';
import { RawIngestEvent } from '../../application/ports/repositories/audit-log-repository.port';

export class SecurityController {
  async listAuditLogs(_request: FastifyRequest, _reply: FastifyReply) {
    const [host, logs] = await Promise.all([
      hostService.getHostMetrics().catch(() => null),
      manageAuditLogsUseCase.getAuditLogs(150),
    ]);
    if (host) {
      manageAuditLogsUseCase.updateLiveHostLoad(
        host.cpu.usagePercent,
        host.memory.usagePercent
      );
    }
    return {
      logs,
      shield: manageAuditLogsUseCase.getShieldStatus(),
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }

  async updateShieldConfig(request: FastifyRequest, _reply: FastifyReply) {
    const body = (request.body || {}) as Partial<RateLimitShieldConfig>;
    const shield = manageAuditLogsUseCase.updateShieldConfig(body);
    await manageAuditLogsUseCase.recordAudit(
      'SHIELD_CONFIG_UPDATE',
      `Cap: ${shield.config.baseCapacity}, Refill: ${shield.config.refillRatePerSec}/s, CPU Crit: ${shield.config.cpuCriticalThreshold}%`,
      request.ip,
      'ok'
    );
    return {
      shield,
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }

  async unblockIp(request: FastifyRequest, _reply: FastifyReply) {
    const body = (request.body || {}) as { ip?: string; clearAll?: boolean };
    const shield = body.clearAll
      ? manageAuditLogsUseCase.clearAllBlockedIps()
      : manageAuditLogsUseCase.unblockIp(body.ip || '');
    await manageAuditLogsUseCase.recordAudit(
      'SHIELD_IP_UNBLOCK',
      body.clearAll ? 'ALL_IPS' : body.ip || '-',
      request.ip,
      'ok'
    );
    return {
      shield,
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }

  async simulateDdos(request: FastifyRequest, _reply: FastifyReply) {
    const body = (request.body || {}) as {
      requestsCount?: number;
      simulatedIp?: string;
      attackerIp?: string;
      simulatedCpuPercent?: number;
    };
    const simulation = await manageAuditLogsUseCase.simulateDdosAttack({
      requestsCount: body.requestsCount,
      simulatedIp: body.simulatedIp || body.attackerIp,
      simulatedCpuPercent: body.simulatedCpuPercent,
    });
    return {
      result: simulation,
      simulation,
      shield: manageAuditLogsUseCase.getShieldStatus(),
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }

  async ingestBatch(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body || {}) as {
      events?: RawIngestEvent[];
      simulateCount?: number;
      eventsCount?: number;
      flushImmediately?: boolean;
      forceFlushImmediately?: boolean;
    };

    const shouldFlush =
      body.forceFlushImmediately !== undefined
        ? Boolean(body.forceFlushImmediately)
        : body.flushImmediately !== false;

    const count = Number(body.eventsCount || body.simulateCount) || 1000;

    const result = Array.isArray(body.events)
      ? await manageAuditLogsUseCase.ingestBatchEvents(body.events, shouldFlush)
      : await manageAuditLogsUseCase.simulateBatchIngest(count, shouldFlush);

    if (!result.accepted) {
      return reply.code(429).send({
        result,
        shield: manageAuditLogsUseCase.getShieldStatus(),
        ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
      });
    }

    return {
      result,
      shield: manageAuditLogsUseCase.getShieldStatus(),
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }

  async flushIngestBuffer(_request: FastifyRequest, _reply: FastifyReply) {
    const flush = await manageAuditLogsUseCase.flushIngestBufferNow();
    return {
      flush,
      flushedCount: flush.flushedCount,
      durationMs: flush.durationMs,
      shield: manageAuditLogsUseCase.getShieldStatus(),
      ingest: manageAuditLogsUseCase.getIngestEngineStatus(),
    };
  }
}

export const securityController = new SecurityController();
