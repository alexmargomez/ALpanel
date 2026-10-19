export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'deploy';

export interface ModuleDto {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
}

export interface ModulePermissionFlags {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canDeploy: boolean;
}

export interface RolePermissionItemDto extends ModulePermissionFlags {
  moduleId: number;
  moduleCode: string;
  moduleName: string;
  moduleDescription: string;
  moduleIcon: string;
}

export type UserPermissionsMap = Record<string, ModulePermissionFlags>;
