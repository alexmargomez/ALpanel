import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';

export class RoleNotFoundException extends DomainException {
  constructor() {
    super('El rol especificado no existe.', 404);
  }
}

export class ProtectedSuperAdminRoleException extends DomainException {
  constructor() {
    super(
      'El rol único Super Administrador (superadmin) es del sistema y no puede modificarse ni eliminarse.',
      403
    );
  }
}
