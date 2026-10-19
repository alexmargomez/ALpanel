import { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', (req, reply) =>
    authController.login(app, req, reply)
  );
  app.get('/api/auth/me', { preHandler: [authenticate] }, (req, reply) =>
    authController.me(req, reply)
  );
}
