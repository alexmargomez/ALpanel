import {
  CreateRoleInput,
  RoleRepositoryPort,
  UpdateRoleInput,
} from '../../application/ports/repositories/role-repository.port';
import { RoleEntity } from '../../domain/entities/role.entity';
import { rolesService } from '../../roles.service';

export class PrismaRoleRepository implements RoleRepositoryPort {
  findAll(): Promise<RoleEntity[]> {
    return rolesService.listRoles();
  }

  create(data: CreateRoleInput): Promise<RoleEntity> {
    return rolesService.createRole(data);
  }

  update(id: number, data: UpdateRoleInput): Promise<RoleEntity> {
    return rolesService.updateRole(id, data);
  }

  delete(id: number): Promise<boolean> {
    return rolesService.deleteRole(id);
  }
}

export const prismaRoleRepository = new PrismaRoleRepository();
