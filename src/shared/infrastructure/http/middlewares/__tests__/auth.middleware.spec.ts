import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, requirePermission } from '../auth.middleware';
import { permissionsService } from '../../../../../modules/permissions/permissions.service';

function createMockReply() {
  let statusCode = 200;
  let payload: unknown = null;
  const reply: any = {
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(body: unknown) {
      payload = body;
      return reply;
    },
    getStatusCode: () => statusCode,
    getPayload: () => payload,
  };
  return reply;
}

describe('Auth & RBAC Middlewares (authenticate & requirePermission)', () => {
  it('authenticate permite el paso cuando jwtVerify tiene éxito', async () => {
    let verified = false;
    const req: any = {
      async jwtVerify() {
        verified = true;
      },
    };
    const reply = createMockReply();

    await authenticate(req, reply);
    assert.equal(verified, true);
    assert.equal(reply.getStatusCode(), 200);
  });

  it('authenticate responde 401 cuando jwtVerify lanza error', async () => {
    const req: any = {
      async jwtVerify() {
        throw new Error('Token expirado');
      },
    };
    const reply = createMockReply();

    await authenticate(req, reply);
    assert.equal(reply.getStatusCode(), 401);
    assert.deepEqual(reply.getPayload(), {
      error: 'No autorizado. Inicia sesión nuevamente.',
    });
  });

  it('requirePermission responde 401 si no existe usuario autenticado en request', async () => {
    const guard = requirePermission('projects', 'view');
    const req: any = { user: undefined };
    const reply = createMockReply();

    await guard(req, reply);
    assert.equal(reply.getStatusCode(), 401);
  });

  it('requirePermission permite acceso inmediato al rol superadmin sin consultar BD', async () => {
    const guard = requirePermission('security', 'delete');
    const req: any = {
      user: { id: 1, username: 'admin', role: 'superadmin' },
    };
    const reply = createMockReply();

    await guard(req, reply);
    assert.equal(reply.getStatusCode(), 200);
    assert.equal(reply.getPayload(), null);
  });

  it('requirePermission verifica permisos vía permissionsService para roles estándar', async () => {
    const originalCheck = permissionsService.checkUserPermission.bind(
      permissionsService
    );
    try {
      (permissionsService as any).checkUserPermission = async (
        userId: number,
        mod: string,
        act: string
      ) => {
        return userId === 10 && mod === 'projects' && act === 'deploy';
      };

      const allowedGuard = requirePermission('projects', 'deploy');
      const deniedGuard = requirePermission('projects', 'delete');

      const req: any = {
        user: { id: 10, username: 'operador', role: 'operator' },
      };

      const replyOk = createMockReply();
      await allowedGuard(req, replyOk);
      assert.equal(replyOk.getStatusCode(), 200);

      const replyDenied = createMockReply();
      await deniedGuard(req, replyDenied);
      assert.equal(replyDenied.getStatusCode(), 403);
      assert.match(
        String((replyDenied.getPayload() as any)?.error || ''),
        /Acceso denegado \(403\)/
      );
    } finally {
      (permissionsService as any).checkUserPermission = originalCheck;
    }
  });
});
