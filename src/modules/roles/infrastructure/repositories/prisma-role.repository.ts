import { prisma } from '../../../../shared/infrastructure/database/prisma.service';
import { managePermissionsUseCase } from '../../../permissions/application/use-cases/manage-permissions.use-case';
import {
  CreateRoleInput,
  RoleRepositoryPort,
  UpdateRoleInput,
} from '../../application/ports/repositories/role-repository.port';
import { RoleEntity } from '../../domain/entities/role.entity';

export class PrismaRoleRepository implements RoleRepositoryPort {
  async findAll(): Promise<RoleEntity[]> {
    const [roles, modules, allRolePerms] = await Promise.all([
      prisma.role.findMany({ orderBy: { id: 'asc' } }),
      managePermissionsUseCase.listModules(),
      prisma.rolePermission.findMany(),
    ]);

    const permsByRoleAndMod = new Map<string, boolean>();
    for (const rp of allRolePerms) {
      permsByRoleAndMod.set(`${rp.roleId}:${rp.moduleId}`, Boolean(rp.canView));
    }

    return roles.map((r: any) => {
      const isSuper = r.code === 'superadmin';
      const permissions = modules.map((mod) => {
        const enabled = isSuper
          ? true
          : Boolean(permsByRoleAndMod.get(`${r.id}:${mod.id}`));
        return {
          moduleId: mod.id,
          moduleCode: mod.code,
          moduleName: mod.name,
          moduleDescription: mod.description,
          moduleIcon: mod.icon,
          canView: enabled,
          canCreate: enabled,
          canEdit: enabled,
          canDelete: enabled,
          canDeploy: enabled,
        };
      });

      return {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
        permissions,
      };
    });
  }

  async create(data: CreateRoleInput): Promise<RoleEntity> {
    const code = (data.code || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const name = (data.name || '').trim();
    const description = (data.description || '').trim();

    if (!code || code.length < 2) {
      throw new Error(
        'El código del rol debe tener al menos 2 caracteres alfanuméricos.'
      );
    }
    if (code === 'superadmin') {
      throw new Error(
        'El código superadmin está reservado exclusivamente para el propietario del sistema.'
      );
    }
    if (!name) {
      throw new Error('El nombre del rol es obligatorio.');
    }

    const exists = await prisma.role.findUnique({ where: { code } });
    if (exists) {
      throw new Error(`El rol '${code}' ya existe.`);
    }

    const [created, modules] = await Promise.all([
      prisma.role.create({ data: { code, name, description } }),
      managePermissionsUseCase.listModules(),
    ]);

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

    const savedPerms = await managePermissionsUseCase.updateRolePermissions(
      created.id,
      defaultPerms
    );

    return {
      id: created.id,
      code: created.code,
      name: created.name,
      description: created.description,
      createdAt: created.createdAt.toISOString(),
      permissions: savedPerms,
    };
  }

  async update(id: number, data: UpdateRoleInput): Promise<RoleEntity> {
    const current = await prisma.role.findUnique({ where: { id } });
    if (!current) {
      throw new Error('El rol no existe.');
    }
    if (current.code === 'superadmin') {
      throw new Error(
        'El rol único Super Administrador (superadmin) es del sistema y no puede modificarse.'
      );
    }

    const code = data.code
      ? data.code
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
      : current.code;
    const name = data.name !== undefined ? data.name.trim() : current.name;
    const description =
      data.description !== undefined
        ? data.description.trim()
        : current.description;

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

    const [updated] = await Promise.all([
      prisma.role.update({
        where: { id },
        data: { code, name, description },
      }),
      prisma.user.updateMany({
        where: { roleId: id },
        data: { role: code },
      }),
    ]);

    managePermissionsUseCase.invalidateCache();

    const perms =
      Array.isArray(data.permissions) && data.permissions.length > 0
        ? await managePermissionsUseCase.updateRolePermissions(
            id,
            data.permissions
          )
        : await managePermissionsUseCase.getRolePermissions(id);

    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      description: updated.description,
      createdAt: updated.createdAt.toISOString(),
      permissions: perms,
    };
  }

  async delete(id: number): Promise<boolean> {
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return false;

    if (role.code === 'superadmin') {
      throw new Error(
        'No se puede eliminar el rol único Super Administrador (superadmin).'
      );
    }

    const usedCount = await prisma.user.count({ where: { roleId: id } });
    if (usedCount > 0) {
      throw new Error(
        `No se puede eliminar el rol '${role.name}' porque está asignado a ${usedCount} usuario(s).`
      );
    }

    await prisma.role.delete({ where: { id } });
    managePermissionsUseCase.invalidateCache();
    return true;
  }
}

export const prismaRoleRepository = new PrismaRoleRepository();
