import { FastifyReply, FastifyRequest } from 'fastify';
import { permissionsService } from './permissions.service';
import { usersService } from '../users/users.service';
import { rolesService } from '../roles/roles.service';
import { securityService } from '../security/security.service';

export class PermissionsController {
  async overview(_request: FastifyRequest, _reply: FastifyReply) {
    const [modules, roles, users] = await Promise.all([
      permissionsService.listModules(),
      rolesService.listRoles(),
      usersService.listUsers(),
    ]);
    return { modules, roles, users };
  }

  async listModules(_request: FastifyRequest, _reply: FastifyReply) {
    const modules = await permissionsService.listModules();
    return { modules };
  }

  async getRolePermissions(request: FastifyRequest, reply: FastifyReply) {
    const { roleId } = request.params as { roleId: string };
    try {
      const permissions = await permissionsService.getRolePermissions(Number(roleId));
      return { permissions };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async updateRolePermissions(request: FastifyRequest, reply: FastifyReply) {
    const { roleId } = request.params as { roleId: string };
    const body = request.body as {
      permissions?: Array<{
        moduleCode: string;
        canView?: boolean;
        canCreate?: boolean;
        canEdit?: boolean;
        canDelete?: boolean;
        canDeploy?: boolean;
      }>;
    };
    try {
      const updated = await permissionsService.updateRolePermissions(
        Number(roleId),
        Array.isArray(body?.permissions) ? body.permissions : []
      );
      await securityService.recordAudit('ROLE_PERMISSIONS_UPDATE', `roleId:${roleId}`, request.ip, 'ok');
      return { success: true, permissions: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
}

export const permissionsController = new PermissionsController();
