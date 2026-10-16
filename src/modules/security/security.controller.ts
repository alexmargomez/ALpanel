import { FastifyReply, FastifyRequest } from 'fastify';
import { securityService } from './security.service';

export class SecurityController {
  async listAuditLogs(_request: FastifyRequest, _reply: FastifyReply) {
    const logs = await securityService.getAuditLogs(150);
    return { logs };
  }
}

export const securityController = new SecurityController();
