import { AuthUserProfile } from '../../domain/entities/auth-profile.entity';

export interface AuthRepositoryPort {
  verifyCredentials(
    username: string,
    passwordPlain: string
  ): Promise<{ valid: boolean; profile?: AuthUserProfile }>;
  getUserProfile(userId: number): Promise<AuthUserProfile | null>;
}
