import { FastifyInstance } from 'fastify';
import { systemController } from './system.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get(
    '/api/system/metrics',
    { preHandler: [authenticate] },
    (req, reply) => systemController.metrics(req, reply)
  );

  app.post(
    '/api/system/prune',
    { preHandler: [authenticate, requirePermission('security', 'deploy')] },
    (req, reply) => systemController.prune(req, reply)
  );
}
