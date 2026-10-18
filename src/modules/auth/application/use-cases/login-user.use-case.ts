import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';
import { AuthUserProfile } from '../../auth.model';
import { authService } from '../../auth.service';

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
  async execute(username: string, passwordPlain: string) {
    return authService.verifyCredentials(username, passwordPlain);
  }
}

export class GetUserProfileUseCase {
  async execute(userId: number) {
    return authService.getUserProfile(userId);
  }
}

export const loginUserUseCase = new LoginUserUseCase();
export const getUserProfileUseCase = new GetUserProfileUseCase();
