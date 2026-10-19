import { FastifyReply, FastifyRequest } from 'fastify';
import { manageAuditLogsUseCase } from '../../application/use-cases/manage-audit-logs.use-case';

export class SecurityController {
  async listAuditLogs(_request: FastifyRequest, _reply: FastifyReply) {
    const logs = await manageAuditLogsUseCase.getAuditLogs(150);
    return { logs };
  }
}

export const securityController = new SecurityController();
