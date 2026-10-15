import { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionAction } from '../modules/permissions/permissions.model';
import { permissionsService } from '../modules/permissions/permissions.service';

export interface JwtUserPayload {
  id: number;
  username: string;
  role: string;
  roleId?: number | null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'No autorizado. Inicia sesión nuevamente.' });
  }
}

export function requirePermission(moduleCode: string, action: PermissionAction) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUserPayload | undefined;
    if (!user || !user.id) {
      return reply.code(401).send({ error: 'Sesión inválida.' });
    }

    if (user.role === 'superadmin' || user.username === 'superadmin') {
      return;
    }

    const allowed = await permissionsService.checkUserPermission(user.id, moduleCode, action);
    if (!allowed) {
      const actionLabels: Record<PermissionAction, string> = {
        view: 'ver',
        create: 'crear',
        edit: 'editar',
        delete: 'eliminar',
        deploy: 'desplegar/ejecutar',
      };
      return reply.code(403).send({
        error: `Acceso denegado (403): Tu rol (${user.role}) no tiene permiso para [${actionLabels[action]}] en el módulo [${moduleCode}].`,
      });
    }
  };
}
