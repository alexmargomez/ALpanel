import { FastifyInstance } from 'fastify';
import { dashboardController } from './dashboard.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get(
    '/api/dashboard/overview',
    { preHandler: [authenticate] },
    (req, reply) => dashboardController.overview(req, reply)
  );

  app.get(
    '/api/overview',
    { preHandler: [authenticate] },
    (req, reply) => dashboardController.overview(req, reply)
  );

  app.post(
    '/api/dashboard/prune',
    { preHandler: [authenticate, requirePermission('security', 'deploy')] },
    (req, reply) => dashboardController.prune(req, reply)
  );
}
