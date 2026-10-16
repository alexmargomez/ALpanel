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
  private modulesCache: { data: ModuleDto[]; expiresAt: number } | null = null;
  private roleMapCache = new Map<string, { data: UserPermissionsMap; expiresAt: number }>();
  private userRoleCache = new Map<
    number,
    { username: string; roleCode: string; roleId: number | null; expiresAt: number }
  >();

  invalidateCache(): void {
    this.modulesCache = null;
    this.roleMapCache.clear();
    this.userRoleCache.clear();
  }

  async listModules(): Promise<ModuleDto[]> {
    const now = Date.now();
    if (this.modulesCache && this.modulesCache.expiresAt > now) {
      return this.modulesCache.data;
    }
    const data = await prisma.module.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    this.modulesCache = { data, expiresAt: now + 30_000 };
    return data;
  }

  getDiscoveredCatalog(forceRescan = false) {
    return discoverModulesAndServices(forceRescan);
  }

  async getRolePermissions(roleId: number): Promise<RolePermissionItemDto[]> {
    const [role, modules, rolePerms] = await Promise.all([
      prisma.role.findUnique({ where: { id: roleId } }),
      this.listModules(),
      prisma.rolePermission.findMany({ where: { roleId } }),
    ]);

    if (!role) {
      throw new Error('El rol especificado no existe.');
    }

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
    const cacheKey = `${roleCode}:${roleId || 0}`;
    const now = Date.now();
    const cached = this.roleMapCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

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
      this.roleMapCache.set(cacheKey, { data: result, expiresAt: now + 30_000 });
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
        })
      : [];

    const permByModId = new Map<number, boolean>();
    for (const p of perms) {
      permByModId.set(p.moduleId, Boolean(p.canView));
    }

    for (const mod of modules) {
      const enabled = Boolean(permByModId.get(mod.id));
      result[mod.code] = {
        canView: enabled,
        canCreate: enabled,
        canEdit: enabled,
        canDelete: enabled,
        canDeploy: enabled,
      };
    }

    this.roleMapCache.set(cacheKey, { data: result, expiresAt: now + 30_000 });
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
    const [role, modules, existingPerms] = await Promise.all([
      prisma.role.findUnique({ where: { id: roleId } }),
      this.listModules(),
      prisma.rolePermission.findMany({ where: { roleId } }),
    ]);

    if (!role) {
      throw new Error('El rol especificado no existe.');
    }
    if (role.code === 'superadmin') {
      throw new Error(
        'Los permisos del rol único Super Administrador están blindados y no pueden restringirse.'
      );
    }

    const existingByModId = new Map<number, boolean>();
    for (const ep of existingPerms) {
      existingByModId.set(ep.moduleId, Boolean(ep.canView));
    }

    const incomingMap = new Map<string, boolean>();
    for (const item of items) {
      if (!item?.moduleCode) continue;
      incomingMap.set(item.moduleCode, Boolean(item.canView));
    }

    const rowsToCreate: Array<{
      roleId: number;
      moduleId: number;
      canView: boolean;
      canCreate: boolean;
      canEdit: boolean;
      canDelete: boolean;
      canDeploy: boolean;
    }> = [];

    const responseItems: RolePermissionItemDto[] = [];

    for (const mod of modules) {
      let enabled = incomingMap.has(mod.code)
        ? Boolean(incomingMap.get(mod.code))
        : Boolean(existingByModId.get(mod.id));

      // Si es un sub-servicio de un módulo (`<modulo>.<servicio>`) y el módulo padre fue deshabilitado,
      // el sub-servicio queda deshabilitado también.
      if (mod.code.includes('.') && !mod.code.startsWith('services.')) {
        const parentCode = mod.code.split('.')[0];
        const parentEnabled = incomingMap.has(parentCode)
          ? Boolean(incomingMap.get(parentCode))
          : true;
        if (!parentEnabled) {
          enabled = false;
        }
      }

      rowsToCreate.push({
        roleId: role.id,
        moduleId: mod.id,
        canView: enabled,
        canCreate: enabled,
        canEdit: enabled,
        canDelete: enabled,
        canDeploy: enabled,
      });

      responseItems.push({
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
      });
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({ data: rowsToCreate }),
    ]);

    this.invalidateCache();
    return responseItems;
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
    const now = Date.now();
    let userInfo = this.userRoleCache.get(userId);
    if (!userInfo || userInfo.expiresAt <= now) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { roleRel: true },
      });
      if (!user) return false;
      userInfo = {
        username: user.username,
        roleCode: user.roleRel?.code || user.role,
        roleId: user.roleId,
        expiresAt: now + 15_000,
      };
      this.userRoleCache.set(userId, userInfo);
    }

    const effectiveRoleCode = userInfo.roleCode;
    if (effectiveRoleCode === 'superadmin' || userInfo.username === 'superadmin') {
      return true;
    }

    const { ignoreConfig } = discoverModulesAndServices();
    if (
      ignoreConfig.ignoredModules.some((m) => m.toLowerCase() === moduleCode.toLowerCase()) ||
      ignoreConfig.ignoredServices.some((s) => s.toLowerCase().includes(moduleCode.toLowerCase()))
    ) {
      return true;
    }

    const map = await this.getPermissionsMapForRole(effectiveRoleCode, userInfo.roleId);

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
