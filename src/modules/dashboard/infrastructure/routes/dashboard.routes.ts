import { FastifyInstance } from 'fastify';
import { dashboardController } from '../controllers/dashboard.controller';
import {
  authenticate,
  requirePermission,
} from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

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

  app.get(
    '/api/system/metrics',
    { preHandler: [authenticate] },
    (req, reply) => dashboardController.metrics(req, reply)
  );

  app.post(
    '/api/system/prune',
    { preHandler: [authenticate, requirePermission('security', 'deploy')] },
    (req, reply) => dashboardController.prune(req, reply)
  );
}
