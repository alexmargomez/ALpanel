import { RolePermissionItemDto } from '../permissions/permissions.model';

export interface RoleDto {
  id: number;
  code: string;
  name: string;
  description: string;
  createdAt: string;
  permissions?: RolePermissionItemDto[];
}
