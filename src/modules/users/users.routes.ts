import { FastifyInstance } from 'fastify';
import { usersController } from './users.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerUsersRoutes(app: FastifyInstance) {
  app.get(
    '/api/users',
    { preHandler: [authenticate, requirePermission('users', 'view')] },
    (req, reply) => usersController.list(req, reply)
  );

  app.post(
    '/api/users',
    { preHandler: [authenticate, requirePermission('users', 'create')] },
    (req, reply) => usersController.create(req, reply)
  );

  app.put(
    '/api/users/:id',
    { preHandler: [authenticate, requirePermission('users', 'edit')] },
    (req, reply) => usersController.update(req, reply)
  );

  app.delete(
    '/api/users/:id',
    { preHandler: [authenticate, requirePermission('users', 'delete')] },
    (req, reply) => usersController.remove(req, reply)
  );

  app.post(
    '/api/users/password',
    { preHandler: [authenticate] },
    (req, reply) => usersController.changePassword(req, reply)
  );
}
