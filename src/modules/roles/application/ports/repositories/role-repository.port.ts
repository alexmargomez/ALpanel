import { RoleEntity } from '../../../domain/entities/role.entity';

export interface RolePermissionInput {
  moduleCode: string;
  canView?: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canDeploy?: boolean;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string;
  permissions?: RolePermissionInput[];
}

export interface UpdateRoleInput {
  code?: string;
  name?: string;
  description?: string;
  permissions?: RolePermissionInput[];
}

export interface RoleRepositoryPort {
  findAll(): Promise<RoleEntity[]>;
  create(data: CreateRoleInput): Promise<RoleEntity>;
  update(id: number, data: UpdateRoleInput): Promise<RoleEntity>;
  delete(id: number): Promise<boolean>;
}
