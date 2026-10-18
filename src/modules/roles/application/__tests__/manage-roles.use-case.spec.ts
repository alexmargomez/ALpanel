import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CreateRoleInput,
  RoleRepositoryPort,
  UpdateRoleInput,
} from '../ports/repositories/role-repository.port';
import { ManageRolesUseCase } from '../use-cases/manage-roles.use-case';
import { RoleEntity } from '../../domain/entities/role.entity';
import {
  ProtectedSuperAdminRoleException,
  RoleNotFoundException,
} from '../../domain/exceptions/role.exception';

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

    await assert.rejects(
      () => useCase.deleteRole(1),
      (err: unknown) =>
        err instanceof ProtectedSuperAdminRoleException &&
        err.statusCode === 403
    );

    const auditor = await useCase.createRole({
      code: 'auditor',
      name: 'Auditor de Seguridad',
      description: 'Solo lectura de logs y métricas',
    });
    assert.equal(auditor.id, 2);
    assert.equal(auditor.code, 'auditor');

    const updated = await useCase.updateRole(2, {
      name: 'Auditor Senior',
    });
    assert.equal(updated.name, 'Auditor Senior');

    const deleted = await useCase.deleteRole(2);
    assert.equal(deleted, true);

    await assert.rejects(
      () => useCase.updateRole(999, { name: 'Inexistente' }),
      (err: unknown) =>
        err instanceof RoleNotFoundException && err.statusCode === 404
    );
  });
});
