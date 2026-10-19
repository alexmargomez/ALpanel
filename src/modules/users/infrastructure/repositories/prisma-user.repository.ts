import {
  hashPassword,
  prisma,
} from '../../../../shared/infrastructure/database/prisma.service';
import { managePermissionsUseCase } from '../../../permissions/application/use-cases/manage-permissions.use-case';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepositoryPort,
} from '../../application/ports/repositories/user-repository.port';
import { UserEntity } from '../../domain/entities/user.entity';

export class PrismaUserRepository implements UserRepositoryPort {
  async findAll(): Promise<UserEntity[]> {
    const rows = await prisma.user.findMany({
      include: { roleRel: true },
      orderBy: { id: 'asc' },
    });

    return rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      fullName: r.fullName || '',
      role: r.roleRel?.code || r.role,
      roleId: r.roleId,
      roleName: r.roleRel?.name || r.role,
      lastLogin: r.lastLogin ? r.lastLogin.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async create(data: CreateUserInput): Promise<UserEntity> {
    const username = (data.username || '').trim().toLowerCase();
    const fullName = (data.fullName || '').trim();
    const password = data.password || '';

    if (!username || username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
      throw new Error(
        'El username debe tener al menos 3 caracteres válidos (letras, números, guion o punto).'
      );
    }
    if (username === 'superadmin') {
      throw new Error(
        'El username superadmin es único y exclusivo del propietario del sistema.'
      );
    }
    if (!fullName) {
      throw new Error('El nombre completo del usuario es obligatorio.');
    }
    if (!password || password.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }

    const dup = await prisma.user.findUnique({ where: { username } });
    if (dup) {
      throw new Error(`El usuario '${username}' ya existe.`);
    }

    let roleRow = data.roleId
      ? await prisma.role.findUnique({ where: { id: Number(data.roleId) } })
      : null;

    if (!roleRow && data.roleCode) {
      roleRow = await prisma.role.findUnique({
        where: { code: data.roleCode },
      });
    }
    if (!roleRow) {
      roleRow = await prisma.role.findFirst({
        where: { code: { not: 'superadmin' } },
        orderBy: { id: 'asc' },
      });
    }

    if (roleRow?.code === 'superadmin') {
      throw new Error(
        'El rol Super Administrador (superadmin) es único y no puede asignarse a ningún otro usuario.'
      );
    }

    const created = await prisma.user.create({
      data: {
        username,
        fullName,
        passwordHash: hashPassword(password),
        role: roleRow?.code || 'admin',
        roleId: roleRow?.id || null,
      },
      include: { roleRel: true },
    });

    if (
      roleRow &&
      Array.isArray(data.rolePermissions) &&
      data.rolePermissions.length > 0
    ) {
      await managePermissionsUseCase.updateRolePermissions(
        roleRow.id,
        data.rolePermissions
      );
    } else {
      managePermissionsUseCase.invalidateCache();
    }

    return {
      id: created.id,
      username: created.username,
      fullName: created.fullName,
      role: created.roleRel?.code || created.role,
      roleId: created.roleId,
      roleName: created.roleRel?.name || created.role,
      lastLogin: null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async update(id: number, data: UpdateUserInput): Promise<UserEntity> {
    const current = await prisma.user.findUnique({
      where: { id },
      include: { roleRel: true },
    });
    if (!current) {
      throw new Error('El usuario no existe.');
    }

    const isSuperAdmin =
      current.role === 'superadmin' ||
      current.roleRel?.code === 'superadmin' ||
      current.username === 'superadmin';

    const username = isSuperAdmin
      ? 'superadmin'
      : data.username
      ? data.username.trim().toLowerCase()
      : current.username;
    const fullName =
      data.fullName !== undefined ? data.fullName.trim() : current.fullName;

    if (!isSuperAdmin && username === 'superadmin') {
      throw new Error(
        'El username superadmin está reservado exclusivamente para el primer usuario.'
      );
    }
    if (!username || username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
      throw new Error('El username debe tener al menos 3 caracteres válidos.');
    }
    if (!fullName) {
      throw new Error('El nombre completo es obligatorio.');
    }

    const dup = await prisma.user.findFirst({
      where: { username, id: { not: id } },
    });
    if (dup) {
      throw new Error(
        `El username '${username}' ya está en uso por otro usuario.`
      );
    }

    let roleCode = current.role;
    let roleId: number | null = current.roleId;

    if (isSuperAdmin) {
      const superRole = await prisma.role.findUnique({
        where: { code: 'superadmin' },
      });
      roleCode = 'superadmin';
      roleId = superRole?.id || current.roleId;
    } else if (data.roleId || data.roleCode) {
      const roleRow = data.roleId
        ? await prisma.role.findUnique({ where: { id: Number(data.roleId) } })
        : await prisma.role.findUnique({
            where: { code: String(data.roleCode) },
          });

      if (roleRow) {
        if (roleRow.code === 'superadmin') {
          throw new Error(
            'El rol Super Administrador (superadmin) es único y no puede asignarse a otro usuario.'
          );
        }
        roleCode = roleRow.code;
        roleId = roleRow.id;
      }
    }

    const updatePayload: {
      username: string;
      fullName: string;
      role: string;
      roleId: number | null;
      passwordHash?: string;
    } = {
      username,
      fullName,
      role: roleCode,
      roleId,
    };

    if (data.password && data.password.trim().length > 0) {
      if (data.password.trim().length < 6) {
        throw new Error(
          'La nueva contraseña debe tener al menos 6 caracteres.'
        );
      }
      updatePayload.passwordHash = hashPassword(data.password.trim());
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updatePayload,
      include: { roleRel: true },
    });

    if (
      !isSuperAdmin &&
      roleId &&
      Array.isArray(data.rolePermissions) &&
      data.rolePermissions.length > 0
    ) {
      await managePermissionsUseCase.updateRolePermissions(
        roleId,
        data.rolePermissions
      );
    } else {
      managePermissionsUseCase.invalidateCache();
    }

    return {
      id: updated.id,
      username: updated.username,
      fullName: updated.fullName,
      role: updated.roleRel?.code || updated.role,
      roleId: updated.roleId,
      roleName: updated.roleRel?.name || updated.role,
      lastLogin: updated.lastLogin ? updated.lastLogin.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async delete(id: number): Promise<boolean> {
    const target = await prisma.user.findUnique({
      where: { id },
      include: { roleRel: true },
    });
    if (!target) return false;

    if (
      target.username === 'superadmin' ||
      target.role === 'superadmin' ||
      target.roleRel?.code === 'superadmin'
    ) {
      throw new Error(
        'El usuario principal Super Administrador (superadmin) no puede ser eliminado.'
      );
    }

    const total = await prisma.user.count();
    if (total <= 1) {
      throw new Error('No puedes eliminar el único usuario del panel.');
    }

    await prisma.user.delete({ where: { id } });
    managePermissionsUseCase.invalidateCache();
    return true;
  }

  async changeOwnPassword(
    username: string,
    newPasswordPlain: string
  ): Promise<boolean> {
    if (!newPasswordPlain || newPasswordPlain.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }
    await prisma.user.update({
      where: { username },
      data: { passwordHash: hashPassword(newPasswordPlain) },
    });
    return true;
  }
}

export const prismaUserRepository = new PrismaUserRepository();
