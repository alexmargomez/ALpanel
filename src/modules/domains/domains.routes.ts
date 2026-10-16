import { FastifyInstance } from 'fastify';
import { domainsController } from './domains.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerDomainsRoutes(app: FastifyInstance) {
  app.get(
    '/api/domains',
    { preHandler: [authenticate, requirePermission('domains', 'view')] },
    (req, reply) => domainsController.list(req, reply)
  );

  app.post(
    '/api/domains',
    { preHandler: [authenticate, requirePermission('domains', 'create')] },
    (req, reply) => domainsController.save(req, reply)
  );

  app.delete(
    '/api/domains/:id',
    { preHandler: [authenticate, requirePermission('domains', 'delete')] },
    (req, reply) => domainsController.remove(req, reply)
  );
}
