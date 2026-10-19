import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';
import { AuthRepositoryPort } from '../ports/auth-repository.port';
import { AuthUserProfile } from '../../domain/entities/auth-profile.entity';
import { prismaAuthRepository } from '../../infrastructure/repositories/prisma-auth.repository';

export interface LoginRequestDto {
  username: string;
  password?: string;
}

export { AuthUserProfile };

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('Usuario o contraseña incorrectos.', 401);
  }
}

export class LoginUserUseCase {
  constructor(
    private readonly repository: AuthRepositoryPort = prismaAuthRepository
  ) {}

  async execute(username: string, passwordPlain: string) {
    return this.repository.verifyCredentials(username, passwordPlain);
  }
}

export class GetUserProfileUseCase {
  constructor(
    private readonly repository: AuthRepositoryPort = prismaAuthRepository
  ) {}

  async execute(userId: number) {
    return this.repository.getUserProfile(userId);
  }
}

export const loginUserUseCase = new LoginUserUseCase();
export const getUserProfileUseCase = new GetUserProfileUseCase();
