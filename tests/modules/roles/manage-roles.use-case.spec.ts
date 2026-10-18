import {
  CreateRoleInput,
  RoleRepositoryPort,
  UpdateRoleInput,
} from '../../../src/modules/roles/application/ports/repositories/role-repository.port';
import { ManageRolesUseCase } from '../../../src/modules/roles/application/use-cases/manage-roles.use-case';
import { RoleEntity } from '../../../src/modules/roles/domain/entities/role.entity';
import {
  ProtectedSuperAdminRoleException,
  RoleNotFoundException,
} from '../../../src/modules/roles/domain/exceptions/role.exception';

class InMemoryRoleRepositoryMock implements RoleRepositoryPort {
  private roles: RoleEntity[] = [
    {
      id: 1,
      code: 'superadmin',
      name: 'Super Administrador',
      description: 'Acceso total al sistema',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  private nextId = 2;

  async findAll(): Promise<RoleEntity[]> {
    return [...this.roles];
  }

  async create(data: CreateRoleInput): Promise<RoleEntity> {
    if (data.code.toLowerCase() === 'superadmin') {
      throw new ProtectedSuperAdminRoleException();
    }
    const role: RoleEntity = {
      id: this.nextId++,
      code: data.code.toLowerCase(),
      name: data.name,
      description: data.description || '',
      createdAt: new Date().toISOString(),
    };
    this.roles.push(role);
    return role;
  }

  async update(id: number, data: UpdateRoleInput): Promise<RoleEntity> {
    const role = this.roles.find((r) => r.id === id);
    if (!role) throw new RoleNotFoundException();
    if (role.code === 'superadmin') {
      throw new ProtectedSuperAdminRoleException();
    }
    if (data.name) role.name = data.name;
    if (data.description !== undefined) role.description = data.description;
    return role;
  }

  async delete(id: number): Promise<boolean> {
    const role = this.roles.find((r) => r.id === id);
    if (!role) throw new RoleNotFoundException();
    if (role.code === 'superadmin') {
      throw new ProtectedSuperAdminRoleException();
    }
    this.roles = this.roles.filter((r) => r.id !== id);
    return true;
  }
}

describe('Roles Module — ManageRolesUseCase & Protección SuperAdmin', () => {
  it('permite crear, listar, actualizar y eliminar roles personalizados y protege superadmin', async () => {
    const repo = new InMemoryRoleRepositoryMock();
    const useCase = new ManageRolesUseCase(repo);

    await expect(useCase.deleteRole(1)).rejects.toThrow(
      ProtectedSuperAdminRoleException
    );

    const auditor = await useCase.createRole({
      code: 'auditor',
      name: 'Auditor de Seguridad',
      description: 'Solo lectura de logs y métricas',
    });
    expect(auditor.id).toBe(2);
    expect(auditor.code).toBe('auditor');

    const updated = await useCase.updateRole(2, {
      name: 'Auditor Senior',
    });
    expect(updated.name).toBe('Auditor Senior');

    const deleted = await useCase.deleteRole(2);
    expect(deleted).toBe(true);

    await expect(
      useCase.updateRole(999, { name: 'Inexistente' })
    ).rejects.toThrow(RoleNotFoundException);
  });
});
