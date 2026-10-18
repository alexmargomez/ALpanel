import { PermissionRepositoryPort } from '../../application/ports/repositories/permission-repository.port';
import { permissionsService } from '../../permissions.service';

export class PrismaPermissionRepository implements PermissionRepositoryPort {
  listModules() {
    return permissionsService.listModules();
  }

  getRolePermissions(roleId: number) {
    return permissionsService.getRolePermissions(roleId);
  }

  getPermissionsMapForRole(roleCode: string, roleId?: number | null) {
    return permissionsService.getPermissionsMapForRole(roleCode, roleId);
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
    return permissionsService.updateRolePermissions(roleId, items);
  }

  checkUserPermission(
    userId: number,
    moduleCode: string,
    actionOrService = 'view'
  ) {
    return permissionsService.checkUserPermission(
      userId,
      moduleCode,
      actionOrService
    );
  }
}

export const prismaPermissionRepository = new PrismaPermissionRepository();
