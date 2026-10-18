import {
  ModuleDto,
  RolePermissionItemDto,
  UserPermissionsMap,
} from '../../../domain/entities/permission.entity';

export interface PermissionRepositoryPort {
  listModules(): Promise<ModuleDto[]>;
  getRolePermissions(roleId: number): Promise<RolePermissionItemDto[]>;
  getPermissionsMapForRole(
    roleCode: string,
    roleId?: number | null
  ): Promise<UserPermissionsMap>;
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
  ): Promise<RolePermissionItemDto[]>;
  checkUserPermission(
    userId: number,
    moduleCode: string,
    actionOrService?: string
  ): Promise<boolean>;
}
