import { FastifyInstance } from 'fastify';
import { permissionsController } from '../controllers/permissions.controller';
import {
  authenticate,
  requirePermission,
} from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export async function registerPermissionsRoutes(app: FastifyInstance) {
  app.get(
    '/api/permissions/overview',
    { preHandler: [authenticate, requirePermission('users', 'view')] },
    (req, reply) => permissionsController.overview(req, reply)
  );

  app.get(
    '/api/permissions/modules',
    { preHandler: [authenticate] },
    (req, reply) => permissionsController.listModules(req, reply)
  );

  app.get(
    '/api/permissions/roles/:roleId',
    { preHandler: [authenticate, requirePermission('users', 'view')] },
    (req, reply) => permissionsController.getRolePermissions(req, reply)
  );

  app.put(
    '/api/permissions/roles/:roleId',
    { preHandler: [authenticate, requirePermission('users', 'edit')] },
    (req, reply) => permissionsController.updateRolePermissions(req, reply)
  );
}
