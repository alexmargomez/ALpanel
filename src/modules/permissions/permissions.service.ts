import { prisma } from '../../config/prisma';
import {
  ModuleDto,
  ModulePermissionFlags,
  PermissionAction,
  RolePermissionItemDto,
  UserPermissionsMap,
} from './permissions.model';

export class PermissionsService {
  async listModules(): Promise<ModuleDto[]> {
    return prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getRolePermissions(roleId: number): Promise<RolePermissionItemDto[]> {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new Error('El rol especificado no existe.');
    }

    const modules = await this.listModules();
    const rolePerms = await prisma.rolePermission.findMany({
      where: { roleId },
    });

    const mapByModId = new Map<number, (typeof rolePerms)[number]>();
    for (const rp of rolePerms) {
      mapByModId.set(rp.moduleId, rp);
    }

    const isSuper = role.code === 'superadmin';

    return modules.map((mod) => {
      const rp = mapByModId.get(mod.id);
      return {
        moduleId: mod.id,
        moduleCode: mod.code,
        moduleName: mod.name,
        moduleDescription: mod.description,
        moduleIcon: mod.icon,
        canView: isSuper ? true : Boolean(rp?.canView),
        canCreate: isSuper ? true : Boolean(rp?.canCreate),
        canEdit: isSuper ? true : Boolean(rp?.canEdit),
        canDelete: isSuper ? true : Boolean(rp?.canDelete),
        canDeploy: isSuper ? true : Boolean(rp?.canDeploy),
      };
    });
  }

  async getPermissionsMapForRole(roleCode: string, roleId?: number | null): Promise<UserPermissionsMap> {
    const modules = await this.listModules();
    const result: UserPermissionsMap = {};

    if (roleCode === 'superadmin') {
      for (const mod of modules) {
        result[mod.code] = {
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canDeploy: true,
        };
      }
      return result;
    }

    let targetRoleId = roleId || null;
    if (!targetRoleId) {
      const foundRole = await prisma.role.findUnique({ where: { code: roleCode } });
      targetRoleId = foundRole?.id || null;
    }

    const perms = targetRoleId
      ? await prisma.rolePermission.findMany({
          where: { roleId: targetRoleId },
          include: { module: true },
        })
      : [];

    for (const mod of modules) {
      const found = perms.find((p) => p.moduleId === mod.id);
      result[mod.code] = {
        canView: Boolean(found?.canView),
        canCreate: Boolean(found?.canCreate),
        canEdit: Boolean(found?.canEdit),
        canDelete: Boolean(found?.canDelete),
        canDeploy: Boolean(found?.canDeploy),
      };
    }

    return result;
  }

  async updateRolePermissions(
    roleId: number,
    items: Array<{
      moduleCode: string;
      canView?: boolean;
      canCreate?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canDeploy?: boolean;
    }>
  ): Promise<RolePermissionItemDto[]> {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new Error('El rol especificado no existe.');
    }
    if (role.code === 'superadmin') {
      throw new Error('Los permisos del rol único Super Administrador están blindados y no pueden restringirse.');
    }

    const modules = await this.listModules();
    for (const mod of modules) {
      const incoming = items.find((i) => i.moduleCode === mod.code);
      if (!incoming) continue;

      const canCreate = Boolean(incoming.canCreate);
      const canEdit = Boolean(incoming.canEdit);
      const canDelete = Boolean(incoming.canDelete);
      const canDeploy = Boolean(incoming.canDeploy);
      // Si tiene algún permiso de acción en el módulo, automáticamente puede ver el módulo
      const canView = Boolean(incoming.canView) || canCreate || canEdit || canDelete || canDeploy;

      await prisma.rolePermission.upsert({
        where: {
          roleId_moduleId: { roleId: role.id, moduleId: mod.id },
        },
        update: {
          canView,
          canCreate,
          canEdit,
          canDelete,
          canDeploy,
        },
        create: {
          roleId: role.id,
          moduleId: mod.id,
          canView,
          canCreate,
          canEdit,
          canDelete,
          canDeploy,
        },
      });
    }

    return this.getRolePermissions(roleId);
  }

  async checkUserPermission(
    userId: number,
    moduleCode: string,
    action: PermissionAction
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { roleRel: true },
    });
    if (!user) return false;

    const effectiveRoleCode = user.roleRel?.code || user.role;
    if (effectiveRoleCode === 'superadmin' || user.username === 'superadmin') {
      return true;
    }

    const map = await this.getPermissionsMapForRole(effectiveRoleCode, user.roleId);
    const modPerm: ModulePermissionFlags | undefined = map[moduleCode];
    if (!modPerm) return false;

    switch (action) {
      case 'view':
        return modPerm.canView;
      case 'create':
        return modPerm.canCreate;
      case 'edit':
        return modPerm.canEdit;
      case 'delete':
        return modPerm.canDelete;
      case 'deploy':
        return modPerm.canDeploy;
      default:
        return false;
    }
  }
}

export const permissionsService = new PermissionsService();
