import { FastifyReply, FastifyRequest } from 'fastify';
import { rolesService } from './roles.service';
import { permissionsService } from '../permissions/permissions.service';
import { securityService } from '../security/security.service';

export class RolesController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const [roles, modules] = await Promise.all([
      rolesService.listRoles(),
      permissionsService.listModules(),
    ]);
    return { roles, modules };
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as {
      code?: string;
      name?: string;
      description?: string;
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
      const created = await rolesService.createRole({
        code: body?.code || '',
        name: body?.name || '',
        description: body?.description || '',
        permissions: body?.permissions,
      });
      await securityService.recordAudit('ROLE_CREATE', `${created.code} (${created.name})`, request.ip, 'ok');
      return { success: true, role: created };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const body = request.body as {
      code?: string;
      name?: string;
      description?: string;
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
      const updated = await rolesService.updateRole(Number(id), {
        code: body?.code,
        name: body?.name,
        description: body?.description,
        permissions: body?.permissions,
      });
      await securityService.recordAudit('ROLE_UPDATE', `${updated.code} (${updated.name})`, request.ip, 'ok');
      return { success: true, role: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      await rolesService.deleteRole(Number(id));
      await securityService.recordAudit('ROLE_DELETE', `id:${id}`, request.ip, 'ok');
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
}

export const rolesController = new RolesController();
