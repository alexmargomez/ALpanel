import {
  CreateUserInput,
  UpdateUserInput,
  UserRepositoryPort,
} from '../../application/ports/repositories/user-repository.port';
import { UserEntity } from '../../domain/entities/user.entity';
import { usersService } from '../../users.service';

export class PrismaUserRepository implements UserRepositoryPort {
  async findAll(): Promise<UserEntity[]> {
    return usersService.listUsers();
  }

  async create(data: CreateUserInput): Promise<UserEntity> {
    return usersService.createUser(data);
  }

  async update(id: number, data: UpdateUserInput): Promise<UserEntity> {
    return usersService.updateUser(id, data);
  }

  async delete(id: number): Promise<boolean> {
    return usersService.deleteUser(id);
  }

  async changeOwnPassword(
    username: string,
    newPasswordPlain: string
  ): Promise<boolean> {
    return usersService.changeOwnPassword(username, newPasswordPlain);
  }
}

export const prismaUserRepository = new PrismaUserRepository();
