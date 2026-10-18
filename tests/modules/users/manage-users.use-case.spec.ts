import { UsernameVO } from '../../../src/modules/users/domain/value-objects/username.vo';
import {
  InvalidUsernameException,
  UserNotFoundException,
} from '../../../src/modules/users/domain/exceptions/user.exception';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepositoryPort,
} from '../../../src/modules/users/application/ports/repositories/user-repository.port';
import { ManageUsersUseCase } from '../../../src/modules/users/application/use-cases/manage-users.use-case';
import { UserEntity } from '../../../src/modules/users/domain/entities/user.entity';

class InMemoryUserRepositoryMock implements UserRepositoryPort {
  private users: UserEntity[] = [
    {
      id: 1,
      username: 'superadmin',
      fullName: 'Super Administrador',
      role: 'superadmin',
      roleId: 1,
      roleName: 'Super Administrador',
      lastLogin: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  private nextId = 2;

  async findAll(): Promise<UserEntity[]> {
    return [...this.users];
  }

  async create(data: CreateUserInput): Promise<UserEntity> {
    const username = new UsernameVO(data.username).value;
    const created: UserEntity = {
      id: this.nextId++,
      username,
      fullName: data.fullName,
      role: data.roleCode || 'operator',
      roleId: data.roleId || 2,
      roleName: 'Operador',
      lastLogin: null,
      createdAt: new Date().toISOString(),
    };
    this.users.push(created);
    return created;
  }

  async update(id: number, data: UpdateUserInput): Promise<UserEntity> {
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx === -1) throw new UserNotFoundException();
    const updated: UserEntity = {
      ...this.users[idx],
      ...(data.username
        ? { username: new UsernameVO(data.username).value }
        : {}),
      ...(data.fullName ? { fullName: data.fullName } : {}),
      ...(data.roleCode ? { role: data.roleCode } : {}),
    };
    this.users[idx] = updated;
    return updated;
  }

  async delete(id: number): Promise<boolean> {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    return this.users.length < before;
  }

  async changeOwnPassword(
    username: string,
    newPasswordPlain: string
  ): Promise<boolean> {
    return (
      this.users.some((u) => u.username === username) &&
      newPasswordPlain.length >= 6
    );
  }
}

describe('Users Module — UsernameVO & ManageUsersUseCase', () => {
  it('UsernameVO normaliza en minúsculas y rechaza usernames cortos o con símbolos inválidos', () => {
    const vo = new UsernameVO('  Alex.Dev_01 ');
    expect(vo.value).toBe('alex.dev_01');

    expect(() => new UsernameVO('ab')).toThrow(InvalidUsernameException);
    expect(() => new UsernameVO('usuario con espacio')).toThrow(
      InvalidUsernameException
    );
  });

  it('ManageUsersUseCase ejecuta CRUD completo sobre el puerto UserRepositoryPort', async () => {
    const repo = new InMemoryUserRepositoryMock();
    const useCase = new ManageUsersUseCase(repo);

    const initial = await useCase.listUsers();
    expect(initial).toHaveLength(1);

    const created = await useCase.createUser({
      username: 'Carlos_Ops',
      fullName: 'Carlos Operador',
      password: 'Password123!',
      roleCode: 'operator',
    });
    expect(created.id).toBe(2);
    expect(created.username).toBe('carlos_ops');

    const updated = await useCase.updateUser(2, {
      fullName: 'Carlos DevOps',
    });
    expect(updated.fullName).toBe('Carlos DevOps');

    const passChanged = await useCase.changeOwnPassword(
      'carlos_ops',
      'NuevaClaveSegura2026'
    );
    expect(passChanged).toBe(true);

    const deleted = await useCase.deleteUser(2);
    expect(deleted).toBe(true);
    expect(await useCase.listUsers()).toHaveLength(1);
  });
});
