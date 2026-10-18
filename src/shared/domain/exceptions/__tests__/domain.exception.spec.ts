import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainException } from '../domain.exception';
import {
  InvalidProjectNameException,
  ProjectAccessDeniedException,
  ProjectNotFoundException,
} from '../../../../modules/projects/domain/exceptions/project.exception';
import {
  InvalidUsernameException,
  UserNotFoundException,
} from '../../../../modules/users/domain/exceptions/user.exception';
import {
  ProtectedSuperAdminRoleException,
  RoleNotFoundException,
} from '../../../../modules/roles/domain/exceptions/role.exception';
import { InvalidCredentialsException } from '../../../../modules/auth/application/use-cases/login-user.use-case';

describe('DomainException & Module Exceptions', () => {
  it('usa statusCode 400 por defecto cuando no se especifica', () => {
    const err = new DomainException('Error de validación de negocio');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof DomainException);
    assert.equal(err.message, 'Error de validación de negocio');
    assert.equal(err.statusCode, 400);
    assert.equal(err.name, 'DomainException');
  });

  it('respeta un statusCode personalizado', () => {
    const err = new DomainException('Recurso prohibido', 403);
    assert.equal(err.statusCode, 403);
  });

  it('instancia correctamente excepciones del módulo projects', () => {
    const invalidName = new InvalidProjectNameException('../hack');
    assert.ok(invalidName instanceof DomainException);
    assert.equal(invalidName.statusCode, 400);
    assert.match(invalidName.message, /Nombre de proyecto inválido: \.\.\/hack/);

    const accessDenied = new ProjectAccessDeniedException();
    assert.equal(accessDenied.statusCode, 403);

    const notFound = new ProjectNotFoundException('hc_version2');
    assert.equal(notFound.statusCode, 404);
    assert.match(notFound.message, /hc_version2/);
  });

  it('instancia correctamente excepciones de users, roles y auth', () => {
    const invalidUser = new InvalidUsernameException();
    assert.equal(invalidUser.statusCode, 400);

    const userNotFound = new UserNotFoundException();
    assert.equal(userNotFound.statusCode, 404);

    const roleNotFound = new RoleNotFoundException();
    assert.equal(roleNotFound.statusCode, 404);

    const protectedRole = new ProtectedSuperAdminRoleException();
    assert.equal(protectedRole.statusCode, 403);
    assert.match(protectedRole.message, /superadmin/i);

    const invalidCreds = new InvalidCredentialsException();
    assert.equal(invalidCreds.statusCode, 401);
  });
});
