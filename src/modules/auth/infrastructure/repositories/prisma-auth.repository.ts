import {
  prisma,
  verifyPasswordHash,
} from '../../../../shared/infrastructure/database/prisma.service';
import { managePermissionsUseCase } from '../../../permissions/application/use-cases/manage-permissions.use-case';
import { AuthRepositoryPort } from '../../application/ports/auth-repository.port';
import { AuthUserProfile } from '../../domain/entities/auth-profile.entity';

export class PrismaAuthRepository implements AuthRepositoryPort {
  async verifyCredentials(
    username: string,
    passwordPlain: string
  ): Promise<{ valid: boolean; profile?: AuthUserProfile }> {
    const cleanUser = (username || '').trim();
    if (!cleanUser || !passwordPlain) return { valid: false };

    const user = await prisma.user.findUnique({
      where: { username: cleanUser },
      include: { roleRel: true },
    });

    if (!user) return { valid: false };

    const ok = verifyPasswordHash(passwordPlain, user.passwordHash);
    if (!ok) return { valid: false };

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const roleCode = user.roleRel?.code || user.role;
    const roleName = user.roleRel?.name || user.role;
    const permissions = await managePermissionsUseCase.getPermissionsMapForRole(
      roleCode,
      user.roleId
    );

    return {
      valid: true,
      profile: {
        id: user.id,
        username: user.username,
        fullName: user.fullName || user.username,
        role: roleCode,
        roleId: user.roleId,
        roleName,
        permissions,
      },
    };
  }

  async getUserProfile(userId: number): Promise<AuthUserProfile | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { roleRel: true },
    });
    if (!user) return null;

    const roleCode = user.roleRel?.code || user.role;
    const roleName = user.roleRel?.name || user.role;
    const permissions = await managePermissionsUseCase.getPermissionsMapForRole(
      roleCode,
      user.roleId
    );

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName || user.username,
      role: roleCode,
      roleId: user.roleId,
      roleName,
      permissions,
    };
  }
}

export const prismaAuthRepository = new PrismaAuthRepository();
