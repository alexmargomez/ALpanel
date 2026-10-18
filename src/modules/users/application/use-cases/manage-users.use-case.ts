import {
  CreateUserInput,
  UpdateUserInput,
  UserRepositoryPort,
} from '../ports/repositories/user-repository.port';
import { prismaUserRepository } from '../../infrastructure/repositories/prisma-user.repository';

export class ManageUsersUseCase {
  constructor(
    private readonly repository: UserRepositoryPort = prismaUserRepository
  ) {}

  listUsers() {
    return this.repository.findAll();
  }

  createUser(data: CreateUserInput) {
    return this.repository.create(data);
  }

  updateUser(id: number, data: UpdateUserInput) {
    return this.repository.update(id, data);
  }

  deleteUser(id: number) {
    return this.repository.delete(id);
  }

  changeOwnPassword(username: string, newPasswordPlain: string) {
    return this.repository.changeOwnPassword(username, newPasswordPlain);
  }
}

export const manageUsersUseCase = new ManageUsersUseCase();
