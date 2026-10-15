import { FastifyInstance } from 'fastify';
import { rolesController } from './roles.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerRolesRoutes(app: FastifyInstance) {
  app.get(
    '/api/roles',
    { preHandler: [authenticate, requirePermission('users', 'view')] },
    (req, reply) => rolesController.list(req, reply)
  );

  app.post(
    '/api/roles',
    { preHandler: [authenticate, requirePermission('users', 'create')] },
    (req, reply) => rolesController.create(req, reply)
  );

  app.put(
    '/api/roles/:id',
    { preHandler: [authenticate, requirePermission('users', 'edit')] },
    (req, reply) => rolesController.update(req, reply)
  );

  app.delete(
    '/api/roles/:id',
    { preHandler: [authenticate, requirePermission('users', 'delete')] },
    (req, reply) => rolesController.remove(req, reply)
  );
}
