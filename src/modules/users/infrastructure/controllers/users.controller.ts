import { FastifyReply, FastifyRequest } from 'fastify';
import { manageUsersUseCase } from '../../application/use-cases/manage-users.use-case';
import { manageRolesUseCase } from '../../../roles/application/use-cases/manage-roles.use-case';
import { managePermissionsUseCase } from '../../../permissions/application/use-cases/manage-permissions.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';
import { JwtUserPayload } from '../../../../shared/infrastructure/http/middlewares/auth.middleware';

export class UsersController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const [users, roles, modules] = await Promise.all([
      manageUsersUseCase.listUsers(),
      manageRolesUseCase.listRoles(),
      managePermissionsUseCase.listModules(),
    ]);
    const catalog = managePermissionsUseCase.getDiscoveredCatalog();
    return { users, roles, modules, catalog };
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as {
      username?: string;
      fullName?: string;
      password?: string;
      roleId?: number;
      rolePermissions?: Array<{
        moduleCode: string;
        canView?: boolean;
        canCreate?: boolean;
        canEdit?: boolean;
        canDelete?: boolean;
        canDeploy?: boolean;
      }>;
    };
    try {
      const created = await manageUsersUseCase.createUser({
        username: body?.username || '',
        fullName: body?.fullName || '',
        password: body?.password || '',
        roleId: body?.roleId ? Number(body.roleId) : undefined,
        rolePermissions: body?.rolePermissions,
      });
      await manageAuditLogsUseCase.recordAudit(
        'USER_CREATE',
        `${created.username} (${created.role})`,
        request.ip,
        'ok'
      );
      return { success: true, user: created };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const body = request.body as {
      username?: string;
      fullName?: string;
      password?: string;
      roleId?: number;
      rolePermissions?: Array<{
        moduleCode: string;
        canView?: boolean;
        canCreate?: boolean;
        canEdit?: boolean;
        canDelete?: boolean;
        canDeploy?: boolean;
      }>;
    };
    try {
      const updated = await manageUsersUseCase.updateUser(Number(id), {
        username: body?.username || '',
        fullName: body?.fullName || '',
        password: body?.password,
        roleId: body?.roleId ? Number(body.roleId) : undefined,
        rolePermissions: body?.rolePermissions,
      });
      await manageAuditLogsUseCase.recordAudit(
        'USER_UPDATE',
        `${updated.username} (${updated.role})`,
        request.ip,
        'ok'
      );
      return { success: true, user: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      await manageUsersUseCase.deleteUser(Number(id));
      await manageAuditLogsUseCase.recordAudit(
        'USER_DELETE',
        `id:${id}`,
        request.ip,
        'ok'
      );
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async changePassword(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { newPassword?: string };
    const user = request.user as JwtUserPayload;
    try {
      await manageUsersUseCase.changeOwnPassword(
        user.username,
        body?.newPassword || ''
      );
      await manageAuditLogsUseCase.recordAudit(
        'USER_PASSWORD_CHANGE',
        user.username,
        request.ip,
        'ok'
      );
      return {
        success: true,
        message: 'Contraseña actualizada con hash scrypt en MariaDB.',
      };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
}

export const usersController = new UsersController();
