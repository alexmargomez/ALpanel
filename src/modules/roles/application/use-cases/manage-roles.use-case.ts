import {
  CreateRoleInput,
  RoleRepositoryPort,
  UpdateRoleInput,
} from '../ports/repositories/role-repository.port';
import { prismaRoleRepository } from '../../infrastructure/repositories/prisma-role.repository';

export class ManageRolesUseCase {
  constructor(
    private readonly repository: RoleRepositoryPort = prismaRoleRepository
  ) {}

  listRoles() {
    return this.repository.findAll();
  }

  createRole(data: CreateRoleInput) {
    return this.repository.create(data);
  }

  updateRole(id: number, data: UpdateRoleInput) {
    return this.repository.update(id, data);
  }

  deleteRole(id: number) {
    return this.repository.delete(id);
  }
}

export const manageRolesUseCase = new ManageRolesUseCase();
