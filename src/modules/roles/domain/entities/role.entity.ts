import { RolePermissionItemDto } from '../../../permissions/domain/entities/permission.entity';

export interface RoleEntity {
  id: number;
  code: string;
  name: string;
  description: string;
  createdAt: string;
  permissions?: RolePermissionItemDto[];
}

export type RoleDto = RoleEntity;
