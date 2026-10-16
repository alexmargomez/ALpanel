import { usersService } from '../../modules/users/users.service';
import { rolesService } from '../../modules/roles/roles.service';

/**
 * Servicio Técnico del Módulo `users` (`users.manage`)
 * Permite administrar usuarios, roles y permisos de servicios RBAC.
 */
export class UsersRolesService {
  async listUsers() {
    return usersService.listUsers();
  }

  async listRoles() {
    return rolesService.listRoles();
  }
}

export const usersRolesService = new UsersRolesService();
