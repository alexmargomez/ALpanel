import { FastifyReply, FastifyRequest } from 'fastify';
import { dashboardService } from './dashboard.service';
import { securityService } from '../security/security.service';

export class DashboardController {
  async overview(_request: FastifyRequest, _reply: FastifyReply) {
    return dashboardService.getOverview();
  }

  async metrics(_request: FastifyRequest, _reply: FastifyReply) {
    return dashboardService.getHostMetrics();
  }

  async prune(request: FastifyRequest, _reply: FastifyReply) {
    const res = await dashboardService.pruneCache();
    await securityService.recordAudit('DOCKER_PRUNE', 'server', request.ip, res.success ? 'ok' : 'error');
    return res;
  }
}

export const dashboardController = new DashboardController();
