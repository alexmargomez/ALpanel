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

  app.post(
    '/api/security/shield/config',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.updateShieldConfig(req, reply)
  );

  app.post(
    '/api/security/shield/unblock',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.unblockIp(req, reply)
  );

  app.post(
    '/api/security/shield/simulate',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.simulateDdos(req, reply)
  );

  app.post(
    '/api/security/ingest/batch',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.ingestBatch(req, reply)
  );

  app.post(
    '/api/security/ingest/flush',
    { preHandler: [authenticate, requirePermission('security', 'view')] },
    (req, reply) => securityController.flushIngestBuffer(req, reply)
  );
}
