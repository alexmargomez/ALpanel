import { FastifyInstance } from 'fastify';
import { gitController } from '../controllers/git.controller';
import {
  authenticate,
  requirePermission,
} from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export async function registerGitRoutes(app: FastifyInstance) {
  app.post(
    '/api/projects/:name/check-updates',
    { preHandler: [authenticate, requirePermission('git', 'view')] },
    (req, reply) => gitController.checkUpdates(req, reply)
  );

  app.post(
    '/api/projects/:name/pull',
    { preHandler: [authenticate, requirePermission('git', 'deploy')] },
    (req, reply) => gitController.pull(req, reply)
  );

  app.post(
    '/api/projects/clone',
    { preHandler: [authenticate, requirePermission('git', 'create')] },
    (req, reply) => gitController.clone(req, reply)
  );
}
