import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';

export class InvalidProjectNameException extends DomainException {
  constructor(name: string) {
    super(`Nombre de proyecto inválido: ${name}`, 400);
  }
}

export class ProjectAccessDeniedException extends DomainException {
  constructor() {
    super('Acceso fuera de PROJECTS_ROOT denegado', 403);
  }
}

export class ProjectNotFoundException extends DomainException {
  constructor(name: string) {
    super(`El proyecto '${name}' no fue encontrado.`, 404);
  }
}
