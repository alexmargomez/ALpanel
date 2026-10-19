import { FastifyInstance } from 'fastify';
import { securityController } from '../controllers/security.controller';
import {
  authenticate,
  requirePermission,
} from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export async function registerSecurityRoutes(app: FastifyInstance) {
  app.get(
    '/api/audit',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.listAuditLogs(req, reply)
  );
}
