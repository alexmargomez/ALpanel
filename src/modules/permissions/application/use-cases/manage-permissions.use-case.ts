import { discoverModulesAndServices } from '../../../../shared/infrastructure/services/service-registry';
import { PermissionRepositoryPort } from '../ports/repositories/permission-repository.port';
import { prismaPermissionRepository } from '../../infrastructure/repositories/prisma-permission.repository';

export class ManagePermissionsUseCase {
  constructor(
    private readonly repository: PermissionRepositoryPort = prismaPermissionRepository
  ) {}

  invalidateCache() {
    this.repository.invalidateCache?.();
  }

  listModules() {
    return this.repository.listModules();
  }

  getDiscoveredCatalog(forceRescan = false) {
    return discoverModulesAndServices(forceRescan);
  }

  getRolePermissions(roleId: number) {
    return this.repository.getRolePermissions(roleId);
  }

  getPermissionsMapForRole(roleCode: string, roleId?: number | null) {
    return this.repository.getPermissionsMapForRole(roleCode, roleId);
  }

  updateRolePermissions(
    roleId: number,
    items: Array<{
      moduleCode: string;
      canView?: boolean;
      canCreate?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canDeploy?: boolean;
    }>
  ) {
    return this.repository.updateRolePermissions(roleId, items);
  }

  checkUserPermission(
    userId: number,
    moduleCode: string,
    actionOrService = 'view'
  ) {
    return this.repository.checkUserPermission(
      userId,
      moduleCode,
      actionOrService
    );
  }
}

export const managePermissionsUseCase = new ManagePermissionsUseCase();
