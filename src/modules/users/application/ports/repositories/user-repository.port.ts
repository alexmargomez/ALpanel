import { UserEntity } from '../../../domain/entities/user.entity';

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  roleId?: number;
  roleCode?: string;
  rolePermissions?: Array<{
    moduleCode: string;
    canView?: boolean;
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    canDeploy?: boolean;
  }>;
}

export interface UpdateUserInput {
  username?: string;
  fullName?: string;
  password?: string;
  roleId?: number;
  roleCode?: string;
  rolePermissions?: Array<{
    moduleCode: string;
    canView?: boolean;
    canCreate?: boolean;
    canEdit?: boolean;
    canDelete?: boolean;
    canDeploy?: boolean;
  }>;
}

export interface UserRepositoryPort {
  findAll(): Promise<UserEntity[]>;
  create(data: CreateUserInput): Promise<UserEntity>;
  update(id: number, data: UpdateUserInput): Promise<UserEntity>;
  delete(id: number): Promise<boolean>;
  changeOwnPassword(username: string, newPasswordPlain: string): Promise<boolean>;
}
