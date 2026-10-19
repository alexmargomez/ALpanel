import {
  authenticate,
  requirePermission,
} from '../../src/shared/infrastructure/http/middlewares/auth.middleware';
import { managePermissionsUseCase } from '../../src/modules/permissions/application/use-cases/manage-permissions.use-case';

function createMockReply() {
  const reply: any = {
    statusCode: 200,
    payload: null,
    code: jest.fn((c: number) => {
      reply.statusCode = c;
      return reply;
    }),
    send: jest.fn((body: unknown) => {
      reply.payload = body;
      return reply;
    }),
  };
  return reply;
}

describe('Auth & RBAC Middlewares (authenticate & requirePermission)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticate permite el paso cuando jwtVerify tiene éxito', async () => {
    const req: any = {
      jwtVerify: jest.fn().mockResolvedValue(undefined),
    };
    const reply = createMockReply();

    await authenticate(req, reply);
    expect(req.jwtVerify).toHaveBeenCalledTimes(1);
    expect(reply.statusCode).toBe(200);
  });

  it('authenticate responde 401 cuando jwtVerify lanza error', async () => {
    const req: any = {
      jwtVerify: jest.fn().mockRejectedValue(new Error('Token expirado')),
    };
    const reply = createMockReply();

    await authenticate(req, reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toEqual({
      error: 'No autorizado. Inicia sesión nuevamente.',
    });
  });

  it('requirePermission responde 401 si no existe usuario autenticado en request', async () => {
    const guard = requirePermission('projects', 'view');
    const req: any = { user: undefined };
    const reply = createMockReply();

    await guard(req, reply);
    expect(reply.statusCode).toBe(401);
  });

  it('requirePermission permite acceso inmediato al rol superadmin sin consultar BD', async () => {
    const spy = jest.spyOn(managePermissionsUseCase, 'checkUserPermission');
    const guard = requirePermission('security', 'delete');
    const req: any = {
      user: { id: 1, username: 'admin', role: 'superadmin' },
    };
    const reply = createMockReply();

    await guard(req, reply);
    expect(spy).not.toHaveBeenCalled();
    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeNull();
  });

  it('requirePermission verifica permisos vía managePermissionsUseCase para roles estándar', async () => {
    jest
      .spyOn(managePermissionsUseCase, 'checkUserPermission')
      .mockImplementation(async (userId, mod, act) => {
        return userId === 10 && mod === 'projects' && act === 'deploy';
      });

    const allowedGuard = requirePermission('projects', 'deploy');
    const deniedGuard = requirePermission('projects', 'delete');

    const req: any = {
      user: { id: 10, username: 'operador', role: 'operator' },
    };

    const replyOk = createMockReply();
    await allowedGuard(req, replyOk);
    expect(replyOk.statusCode).toBe(200);

    const replyDenied = createMockReply();
    await deniedGuard(req, replyDenied);
    expect(replyDenied.statusCode).toBe(403);
    expect((replyDenied.payload as any)?.error).toMatch(
      /Acceso denegado \(403\)/
    );
  });
});
