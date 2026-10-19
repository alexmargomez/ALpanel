import { FastifyReply, FastifyRequest } from 'fastify';
import { managePermissionsUseCase } from '../../application/use-cases/manage-permissions.use-case';
import { manageUsersUseCase } from '../../../users/application/use-cases/manage-users.use-case';
import { manageRolesUseCase } from '../../../roles/application/use-cases/manage-roles.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';

export class PermissionsController {
  async overview(_request: FastifyRequest, _reply: FastifyReply) {
    const [modules, roles, users] = await Promise.all([
      managePermissionsUseCase.listModules(),
      manageRolesUseCase.listRoles(),
      manageUsersUseCase.listUsers(),
    ]);
    const catalog = managePermissionsUseCase.getDiscoveredCatalog();
    return { modules, roles, users, catalog };
  }

  async listModules(_request: FastifyRequest, _reply: FastifyReply) {
    const modules = await managePermissionsUseCase.listModules();
    const catalog = managePermissionsUseCase.getDiscoveredCatalog();
    return { modules, catalog };
  }

  async getRolePermissions(request: FastifyRequest, reply: FastifyReply) {
    const { roleId } = request.params as { roleId: string };
    try {
      const permissions = await managePermissionsUseCase.getRolePermissions(
        Number(roleId)
      );
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
      const updated = await managePermissionsUseCase.updateRolePermissions(
        Number(roleId),
        Array.isArray(body?.permissions) ? body.permissions : []
      );
      await manageAuditLogsUseCase.recordAudit(
        'ROLE_PERMISSIONS_UPDATE',
        `roleId:${roleId}`,
        request.ip,
        'ok'
      );
      return { success: true, permissions: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
}

export const permissionsController = new PermissionsController();
