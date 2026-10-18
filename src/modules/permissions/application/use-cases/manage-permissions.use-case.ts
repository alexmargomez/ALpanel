import { PermissionRepositoryPort } from '../ports/repositories/permission-repository.port';
import { prismaPermissionRepository } from '../../infrastructure/repositories/prisma-permission.repository';

export class ManagePermissionsUseCase {
  constructor(
    private readonly repository: PermissionRepositoryPort = prismaPermissionRepository
  ) {}

  listModules() {
    return this.repository.listModules();
  }

  getRolePermissions(roleId: number) {
    return this.repository.getRolePermissions(roleId);
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
