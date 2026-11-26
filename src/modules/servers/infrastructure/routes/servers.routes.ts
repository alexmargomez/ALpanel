import { FastifyInstance } from 'fastify';
import { serversController } from '../controllers/servers.controller';
import {
  authenticate,
  requirePermission,
} from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export async function registerServersRoutes(app: FastifyInstance) {
  app.get(
    '/api/servers',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => serversController.list(req, reply)
  );

  app.post(
    '/api/servers',
    { preHandler: [authenticate, requirePermission('projects', 'create')] },
    (req, reply) => serversController.save(req, reply)
  );

  app.delete(
    '/api/servers/:id',
    { preHandler: [authenticate, requirePermission('projects', 'delete')] },
    (req, reply) => serversController.remove(req, reply)
  );

  app.post(
    '/api/servers/:id/test',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => serversController.testConnection(req, reply)
  );

  app.get(
    '/api/servers/:id/containers',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => serversController.listContainers(req, reply)
  );

  app.post(
    '/api/servers/:id/provision',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => serversController.provision(req, reply)
  );

  app.post(
    '/api/servers/git-credentials',
    { preHandler: [authenticate, requirePermission('projects', 'create')] },
    (req, reply) => serversController.saveGitCredential(req, reply)
  );

  app.delete(
    '/api/servers/git-credentials/:id',
    { preHandler: [authenticate, requirePermission('projects', 'delete')] },
    (req, reply) => serversController.deleteGitCredential(req, reply)
  );
}
