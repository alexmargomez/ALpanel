import { FastifyReply, FastifyRequest } from 'fastify';
import { getDashboardOverviewUseCase } from '../../application/use-cases/get-dashboard-overview.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';

export class DashboardController {
  async overview(_request: FastifyRequest, _reply: FastifyReply) {
    return getDashboardOverviewUseCase.getOverview();
  }

  async metrics(_request: FastifyRequest, _reply: FastifyReply) {
    return getDashboardOverviewUseCase.getHostMetrics();
  }

  async prune(request: FastifyRequest, _reply: FastifyReply) {
    const res = await getDashboardOverviewUseCase.pruneCache();
    await manageAuditLogsUseCase.recordAudit(
      'DOCKER_PRUNE',
      'server',
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }
}

export const dashboardController = new DashboardController();
