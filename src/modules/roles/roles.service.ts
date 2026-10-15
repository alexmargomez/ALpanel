import { prisma } from '../../config/prisma';
import { permissionsService } from '../permissions/permissions.service';
import { RoleDto } from './roles.model';

export class RolesService {
  async listRoles(): Promise<RoleDto[]> {
    const roles = await prisma.role.findMany({
      orderBy: { id: 'asc' },
    });

    const enriched: RoleDto[] = [];
    for (const r of roles) {
      const perms = await permissionsService.getRolePermissions(r.id);
      enriched.push({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
        permissions: perms,
      });
    }
    return enriched;
  }

  async createRole(data: {
    code: string;
    name: string;
    description?: string;
    permissions?: Array<{
      moduleCode: string;
      canView?: boolean;
      canCreate?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canDeploy?: boolean;
    }>;
  }): Promise<RoleDto> {
    const code = (data.code || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const name = (data.name || '').trim();
    const description = (data.description || '').trim();

    if (!code || code.length < 2) {
      throw new Error('El código del rol debe tener al menos 2 caracteres alfanuméricos.');
    }
    if (code === 'superadmin') {
      throw new Error('El código superadmin está reservado exclusivamente para el propietario del sistema.');
    }
    if (!name) {
      throw new Error('El nombre del rol es obligatorio.');
    }

    const exists = await prisma.role.findUnique({ where: { code } });
    if (exists) {
      throw new Error(`El rol '${code}' ya existe.`);
    }

    const created = await prisma.role.create({
      data: { code, name, description },
    });

    const modules = await permissionsService.listModules();
    const defaultPerms =
      Array.isArray(data.permissions) && data.permissions.length > 0
        ? data.permissions
        : modules.map((m) => ({
            moduleCode: m.code,
            canView: m.code !== 'users',
            canCreate: false,
            canEdit: false,
            canDelete: false,
            canDeploy: false,
          }));

    const savedPerms = await permissionsService.updateRolePermissions(created.id, defaultPerms);

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      description: created.description,
      createdAt: created.createdAt.toISOString(),
      permissions: savedPerms,
    };
  }

  async updateRole(
    id: number,
    data: {
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
    }
  ): Promise<RoleDto> {
    const current = await prisma.role.findUnique({ where: { id } });
    if (!current) {
      throw new Error('El rol no existe.');
    }
    if (current.code === 'superadmin') {
      throw new Error('El rol único Super Administrador (superadmin) es del sistema y no puede modificarse.');
    }

    const code = data.code
      ? data.code
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
      : current.code;
    const name = data.name !== undefined ? data.name.trim() : current.name;
    const description = data.description !== undefined ? data.description.trim() : current.description;

    if (!code || !name) {
      throw new Error('El código y nombre del rol son obligatorios.');
    }
    if (code === 'superadmin') {
      throw new Error('No se puede renombrar ningún rol a superadmin.');
    }

    const dup = await prisma.role.findFirst({
      where: { code, id: { not: id } },
    });
    if (dup) {
      throw new Error(`Otro rol ya utiliza el código '${code}'.`);
    }

    const updated = await prisma.role.update({
      where: { id },
      data: { code, name, description },
    });

    await prisma.user.updateMany({
      where: { roleId: id },
      data: { role: code },
    });

    let perms = await permissionsService.getRolePermissions(id);
    if (Array.isArray(data.permissions) && data.permissions.length > 0) {
      perms = await permissionsService.updateRolePermissions(id, data.permissions);
    }

    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      description: updated.description,
      createdAt: updated.createdAt.toISOString(),
      permissions: perms,
    };
  }

  async deleteRole(id: number): Promise<boolean> {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return false;

    if (role.code === 'superadmin') {
      throw new Error('No se puede eliminar el rol único Super Administrador (superadmin).');
    }

    const usedCount = await prisma.user.count({ where: { roleId: id } });
    if (usedCount > 0) {
      throw new Error(
        `No se puede eliminar el rol '${role.name}' porque está asignado a ${usedCount} usuario(s).`
      );
    }

    await prisma.role.delete({ where: { id } });
    return true;
  }
}

export const rolesService = new RolesService();
