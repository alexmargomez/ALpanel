import { FastifyInstance } from 'fastify';
import { gitController } from './git.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerGitRoutes(app: FastifyInstance) {
  app.post(
    '/api/projects/:name/check-updates',
    { preHandler: [authenticate, requirePermission('git', 'view')] },
    (req, reply) => gitController.checkUpdates(req, reply)
  );

  // Git Pull & Restart en Producción (rama main) -> requiere git:deploy
  app.post(
    '/api/projects/:name/pull',
    { preHandler: [authenticate, requirePermission('git', 'deploy')] },
    (req, reply) => gitController.pull(req, reply)
  );

  // Modo Desarrollador (rama develop) -> requiere git:edit
  app.post(
    '/api/projects/:name/dev-activate',
    { preHandler: [authenticate, requirePermission('git', 'edit')] },
    (req, reply) => gitController.activateDev(req, reply)
  );

  app.post(
    '/api/projects/:name/dev-deactivate',
    { preHandler: [authenticate, requirePermission('git', 'edit')] },
    (req, reply) => gitController.deactivateDev(req, reply)
  );

  // Clonar nuevo proyecto -> requiere git:create
  app.post(
    '/api/projects/clone',
    { preHandler: [authenticate, requirePermission('git', 'create')] },
    (req, reply) => gitController.clone(req, reply)
  );
}
