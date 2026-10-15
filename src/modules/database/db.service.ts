import { initDatabase, prisma } from '../../config/prisma';
import { authService } from '../auth/auth.service';
import { usersService } from '../users/users.service';
import { rolesService } from '../roles/roles.service';
import { permissionsService } from '../permissions/permissions.service';
import { securityService } from '../security/security.service';

export { prisma, initDatabase };

/**
 * Fachada de compatibilidad delegando a Prisma ORM y a los servicios modulares.
 */
export class DatabaseService {
  async init() {
    await initDatabase();
  }

  async verifyUserCredentials(username: string, passwordPlain: string) {
    const res = await authService.verifyCredentials(username, passwordPlain);
    if (!res.valid || !res.profile) return { valid: false };
    return {
      valid: true,
      user: {
        id: res.profile.id,
        username: res.profile.username,
        role: res.profile.role,
      },
    };
  }

  async listRoles() {
    return rolesService.listRoles();
  }

  async listUsers() {
    return usersService.listUsers();
  }

  async listModules() {
    return permissionsService.listModules();
  }

  async recordAudit(action: string, target: string, ip: string, status: 'ok' | 'error' = 'ok') {
    return securityService.recordAudit(action, target, ip, status);
  }

  async getAuditLogs(limit = 150) {
    return securityService.getAuditLogs(limit);
  }
}

export const dbService = new DatabaseService();
