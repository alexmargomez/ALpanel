import { FastifyInstance } from 'fastify';
import { DomainException } from '../../../domain/exceptions/domain.exception';
import { manageAuditLogsUseCase } from '../../../../modules/security/application/use-cases/manage-audit-logs.use-case';
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
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof DomainException) {
      if (error.statusCode === 507) {
        await manageAuditLogsUseCase
          .recordAudit(
            'RESOURCE_GUARD_ABORT',
            request.url,
            request.ip,
            'error'
          )
          .catch(() => null);
      }
      return reply
        .code(error.statusCode)
        .send({ error: error.message, output: error.message });
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
