import { DomainException } from '../../src/shared/domain/exceptions/domain.exception';
import {
  InvalidProjectNameException,
  ProjectAccessDeniedException,
  ProjectNotFoundException,
} from '../../src/modules/projects/domain/exceptions/project.exception';
import {
  InvalidUsernameException,
  UserNotFoundException,
} from '../../src/modules/users/domain/exceptions/user.exception';
import {
  ProtectedSuperAdminRoleException,
  RoleNotFoundException,
} from '../../src/modules/roles/domain/exceptions/role.exception';
import { InvalidCredentialsException } from '../../src/modules/auth/application/use-cases/login-user.use-case';

describe('DomainException & Module Exceptions', () => {
  it('usa statusCode 400 por defecto cuando no se especifica', () => {
    const err = new DomainException('Error de validación de negocio');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainException);
    expect(err.message).toBe('Error de validación de negocio');
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('DomainException');
  });

  it('respeta un statusCode personalizado', () => {
    const err = new DomainException('Recurso prohibido', 403);
    expect(err.statusCode).toBe(403);
  });

  it('instancia correctamente excepciones del módulo projects', () => {
    const invalidName = new InvalidProjectNameException('../hack');
    expect(invalidName).toBeInstanceOf(DomainException);
    expect(invalidName.statusCode).toBe(400);
    expect(invalidName.message).toMatch(/Nombre de proyecto inválido: \.\.\/hack/);

    const accessDenied = new ProjectAccessDeniedException();
    expect(accessDenied.statusCode).toBe(403);

    const notFound = new ProjectNotFoundException('hc_version2');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.message).toMatch(/hc_version2/);
  });

  it('instancia correctamente excepciones de users, roles y auth', () => {
    const invalidUser = new InvalidUsernameException();
    expect(invalidUser.statusCode).toBe(400);

    const userNotFound = new UserNotFoundException();
    expect(userNotFound.statusCode).toBe(404);

    const roleNotFound = new RoleNotFoundException();
    expect(roleNotFound.statusCode).toBe(404);

    const protectedRole = new ProtectedSuperAdminRoleException();
    expect(protectedRole.statusCode).toBe(403);
    expect(protectedRole.message).toMatch(/superadmin/i);

    const invalidCreds = new InvalidCredentialsException();
    expect(invalidCreds.statusCode).toBe(401);
  });
});
