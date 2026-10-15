import { FastifyReply, FastifyRequest } from 'fastify';
import { systemService } from './system.service';
import { securityService } from '../security/security.service';

export class SystemController {
  async metrics(_request: FastifyRequest, _reply: FastifyReply) {
    return systemService.getHostMetrics();
  }

  async prune(request: FastifyRequest, _reply: FastifyReply) {
    const res = await systemService.pruneDockerCache();
    await securityService.recordAudit('DOCKER_PRUNE', 'server', request.ip, res.success ? 'ok' : 'error');
    return res;
  }
}

export const systemController = new SystemController();
