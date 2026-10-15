import { FastifyInstance } from 'fastify';
import { authController } from './auth.controller';
import { authenticate } from '../../middlewares/auth.middleware';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', (req, reply) => authController.login(app, req, reply));
  app.get('/api/auth/me', { preHandler: [authenticate] }, (req, reply) => authController.me(req, reply));
}
