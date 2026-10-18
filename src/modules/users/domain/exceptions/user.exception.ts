import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';

export class InvalidUsernameException extends DomainException {
  constructor() {
    super(
      'El username debe tener al menos 3 caracteres válidos (letras, números, guion o punto).',
      400
    );
  }
}

export class UserNotFoundException extends DomainException {
  constructor() {
    super('El usuario no existe.', 404);
  }
}
