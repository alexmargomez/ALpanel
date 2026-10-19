import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  getUserProfileUseCase,
  loginUserUseCase,
} from '../../application/use-cases/login-user.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';
import { JwtUserPayload } from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

const loginAttempts = new Map<string, { count: number; lockUntil: number }>();

export class AuthController {
  async login(
    app: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const ip = request.ip || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (record && record.lockUntil > now) {
      const waitSec = Math.ceil((record.lockUntil - now) / 1000);
      return reply.code(429).send({
        error: `Demasiados intentos fallidos. Intenta de nuevo en ${waitSec} segundos.`,
      });
    }

    const body = request.body as { username?: string; password?: string };
    const authRes = await loginUserUseCase.execute(
      body?.username || '',
      body?.password || ''
    );

    if (authRes.valid && authRes.profile) {
      loginAttempts.delete(ip);
      await manageAuditLogsUseCase.recordAudit(
        'AUTH_LOGIN_DB',
        authRes.profile.username,
        ip,
        'ok'
      );
      const token = app.jwt.sign(
        {
          id: authRes.profile.id,
          username: authRes.profile.username,
          role: authRes.profile.role,
          roleId: authRes.profile.roleId,
        },
        { expiresIn: '24h' }
      );
      return {
        token,
        username: authRes.profile.username,
        fullName: authRes.profile.fullName,
        role: authRes.profile.role,
        roleName: authRes.profile.roleName,
        permissions: authRes.profile.permissions,
      };
    }

    const attempts = (record?.count || 0) + 1;
    const lockUntil = attempts >= 5 ? now + 10 * 60 * 1000 : 0;
    loginAttempts.set(ip, { count: attempts, lockUntil });
    await manageAuditLogsUseCase.recordAudit(
      'AUTH_FAILED',
      body?.username || 'unknown',
      ip,
      'error'
    );

    return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const jwtUser = request.user as JwtUserPayload;
    const profile = await getUserProfileUseCase.execute(jwtUser.id);
    if (!profile) {
      return reply.code(401).send({ error: 'Usuario no encontrado' });
    }
    return { user: profile };
  }
}

export const authController = new AuthController();
