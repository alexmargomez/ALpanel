import { prisma } from '../../config/prisma';
import {
  discoverModulesAndServices,
  PANEL_MODULE_REGISTRY,
} from '../../services/service-registry';
import {
  ModuleDto,
  RolePermissionItemDto,
  UserPermissionsMap,
} from './permissions.model';

export class PermissionsService {
  async listModules(): Promise<ModuleDto[]> {
    return prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  getDiscoveredCatalog() {
    return discoverModulesAndServices();
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
      const enabled = isSuper ? true : Boolean(rp?.canView);
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
  }

  async getPermissionsMapForRole(
    roleCode: string,
    roleId?: number | null
  ): Promise<UserPermissionsMap> {
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
      const found = perms.find((p: any) => p.moduleId === mod.id);
      const enabled = Boolean(found?.canView);
      result[mod.code] = {
        canView: enabled,
        canCreate: enabled,
        canEdit: enabled,
        canDelete: enabled,
        canDeploy: enabled,
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
      throw new Error(
        'Los permisos del rol único Super Administrador están blindados y no pueden restringirse.'
      );
    }

    const modules = await this.listModules();
    const incomingMap = new Map<string, boolean>();
    for (const item of items) {
      if (!item?.moduleCode) continue;
      incomingMap.set(item.moduleCode, Boolean(item.canView));
    }

    for (const mod of modules) {
      if (!incomingMap.has(mod.code)) continue;
      let enabled = Boolean(incomingMap.get(mod.code));

      // Si es un sub-servicio de un módulo (`<modulo>.<servicio>`) y el módulo padre fue deshabilitado,
      // el sub-servicio queda deshabilitado también.
      if (mod.code.includes('.') && !mod.code.startsWith('services.')) {
        const parentCode = mod.code.split('.')[0];
        if (incomingMap.has(parentCode) && !incomingMap.get(parentCode)) {
          enabled = false;
        }
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_moduleId: { roleId: role.id, moduleId: mod.id },
        },
        update: {
          canView: enabled,
          canCreate: enabled,
          canEdit: enabled,
          canDelete: enabled,
          canDeploy: enabled,
        },
        create: {
          roleId: role.id,
          moduleId: mod.id,
          canView: enabled,
          canCreate: enabled,
          canEdit: enabled,
          canDelete: enabled,
          canDeploy: enabled,
        },
      });
    }

    return this.getRolePermissions(roleId);
  }

  private resolveServiceCode(moduleCode: string, actionOrService?: string): string | null {
    if (!actionOrService || actionOrService === 'view') {
      return null;
    }
    if (actionOrService.includes('.')) {
      return actionOrService;
    }
    // Mapeo automático de acciones semánticas hacia códigos de servicio `<modulo>.<servicio>`
    if (moduleCode === 'domains') return 'domains.manage';
    if (moduleCode === 'users') return 'users.manage';
    if (moduleCode === 'git' && actionOrService === 'create') return 'git.clone';
    if (moduleCode === 'git' && actionOrService === 'edit') return 'projects.dev_mode';
    if (moduleCode === 'git' && actionOrService === 'deploy') return 'projects.git_pull';
    if (moduleCode === 'security' && actionOrService === 'deploy') return 'services.docker_prune';
    if (moduleCode === 'projects' && actionOrService === 'edit') return 'projects.logs';
    if (moduleCode === 'projects' && actionOrService === 'deploy') return 'projects.restart_cache';
    if (moduleCode === 'projects' && actionOrService === 'delete') return 'projects.stop_rebuild';
    if (moduleCode === 'project_db' && actionOrService === 'view') return 'projects.db_view';
    if (moduleCode === 'project_db' && actionOrService === 'deploy') return 'projects.db_backup';
    if (moduleCode === 'project_env' && actionOrService === 'view') return 'projects.env_view';
    if (moduleCode === 'project_env' && actionOrService === 'edit') return 'projects.env_edit';

    return `${moduleCode}.${actionOrService}`;
  }

  async checkUserPermission(
    userId: number,
    moduleCode: string,
    actionOrService = 'view'
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

    const { ignoreConfig } = discoverModulesAndServices();
    if (
      ignoreConfig.ignoredModules.some((m) => m.toLowerCase() === moduleCode.toLowerCase()) ||
      ignoreConfig.ignoredServices.some((s) => s.toLowerCase().includes(moduleCode.toLowerCase()))
    ) {
      return true;
    }

    const map = await this.getPermissionsMapForRole(effectiveRoleCode, user.roleId);

    // 1. Si se consulta directamente un servicio independiente (`services.*`)
    if (moduleCode.startsWith('services.')) {
      return Boolean(map[moduleCode]?.canView);
    }

    const serviceCode = this.resolveServiceCode(moduleCode, actionOrService);
    if (serviceCode && serviceCode.startsWith('services.')) {
      return Boolean(map[serviceCode]?.canView);
    }

    // 2. Determinar el módulo padre real
    const parentModuleCode = serviceCode ? serviceCode.split('.')[0] : moduleCode.split('.')[0];
    const parentAllowed = Boolean(map[parentModuleCode]?.canView);
    if (!parentAllowed) {
      return false;
    }

    // 3. Si solo se consulta acceso al módulo (`view`), o si el módulo NO tiene sub-servicios registrados,
    // el permiso del módulo aplica al MÓDULO COMPLETO.
    const modDef = PANEL_MODULE_REGISTRY.find((m) => m.code === parentModuleCode);
    if (!serviceCode || !modDef || modDef.services.length === 0) {
      return true;
    }

    // 4. Si el módulo tiene sub-servicios, verificar el permiso del sub-servicio específico
    return Boolean(map[serviceCode]?.canView);
  }
}

export const permissionsService = new PermissionsService();
