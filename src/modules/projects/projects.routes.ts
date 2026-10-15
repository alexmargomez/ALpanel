import { FastifyInstance } from 'fastify';
import { projectsController } from './projects.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerProjectsRoutes(app: FastifyInstance) {
  app.get(
    '/api/projects',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => projectsController.list(req, reply)
  );

  app.post(
    '/api/projects/:name/restart',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.restart(req, reply)
  );

  app.post(
    '/api/projects/:name/start',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.start(req, reply)
  );

  app.post(
    '/api/projects/:name/stop',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.stop(req, reply)
  );

  app.post(
    '/api/projects/:name/rebuild',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.rebuild(req, reply)
  );

  app.post(
    '/api/projects/:name/clear-cache',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.clearCache(req, reply)
  );

  app.get(
    '/api/projects/:name/db-dump',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.dbDump(req, reply)
  );

  app.get(
    '/api/projects/:name/logs',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => projectsController.getLogs(req, reply)
  );

  app.get(
    '/api/projects/:name/env',
    { preHandler: [authenticate, requirePermission('projects', 'edit')] },
    (req, reply) => projectsController.getEnv(req, reply)
  );

  app.post(
    '/api/projects/:name/env',
    { preHandler: [authenticate, requirePermission('projects', 'edit')] },
    (req, reply) => projectsController.saveEnv(req, reply)
  );
}
