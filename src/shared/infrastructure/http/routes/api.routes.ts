import { FastifyInstance } from 'fastify';
import { DomainException } from '../../../domain/exceptions/domain.exception';
import { registerDashboardRoutes } from '../../../../modules/dashboard/infrastructure/routes/dashboard.routes';
import { registerAuthRoutes } from '../../../../modules/auth/infrastructure/routes/auth.routes';
import { registerUsersRoutes } from '../../../../modules/users/infrastructure/routes/users.routes';
import { registerRolesRoutes } from '../../../../modules/roles/infrastructure/routes/roles.routes';
import { registerPermissionsRoutes } from '../../../../modules/permissions/infrastructure/routes/permissions.routes';
import { registerProjectsRoutes } from '../../../../modules/projects/infrastructure/routes/projects.routes';
import { registerGitRoutes } from '../../../../modules/git/infrastructure/routes/git.routes';
import { registerDomainsRoutes } from '../../../../modules/domains/infrastructure/routes/domains.routes';
import { registerSecurityRoutes } from '../../../../modules/security/infrastructure/routes/security.routes';

/**
 * Enrutador Maestro de la Arquitectura Hexagonal de ALpanel
 * Registra todos los adaptadores HTTP (Routes/Controllers) y el manejador central de DomainException.
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainException) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply
      .code(error.statusCode || 500)
      .send({ error: error.message || 'Error interno del servidor' });
  });

  await registerDashboardRoutes(app);
  await registerAuthRoutes(app);
  await registerUsersRoutes(app);
  await registerRolesRoutes(app);
  await registerPermissionsRoutes(app);
  await registerProjectsRoutes(app);
  await registerGitRoutes(app);
  await registerDomainsRoutes(app);
  await registerSecurityRoutes(app);
}
