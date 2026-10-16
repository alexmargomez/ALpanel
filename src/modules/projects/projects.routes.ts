import { FastifyInstance } from 'fastify';
import { projectsController } from './projects.controller';
import { authenticate, requirePermission } from '../../middlewares/auth.middleware';

export async function registerProjectsRoutes(app: FastifyInstance) {
  // Ver tarjetas de proyectos y contenedores
  app.get(
    '/api/projects',
    { preHandler: [authenticate, requirePermission('projects', 'view')] },
    (req, reply) => projectsController.list(req, reply)
  );

  // Reiniciar contenedor o limpiar caché (projects -> deploy)
  app.post(
    '/api/projects/:name/restart',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.restart(req, reply)
  );

  app.post(
    '/api/projects/:name/clear-cache',
    { preHandler: [authenticate, requirePermission('projects', 'deploy')] },
    (req, reply) => projectsController.clearCache(req, reply)
  );

  // Detener, Iniciar o Rebuild completo del servidor/proyecto (projects -> delete)
  app.post(
    '/api/projects/:name/start',
    { preHandler: [authenticate, requirePermission('projects', 'delete')] },
    (req, reply) => projectsController.start(req, reply)
  );

  app.post(
    '/api/projects/:name/stop',
    { preHandler: [authenticate, requirePermission('projects', 'delete')] },
    (req, reply) => projectsController.stop(req, reply)
  );

  app.post(
    '/api/projects/:name/rebuild',
    { preHandler: [authenticate, requirePermission('projects', 'delete')] },
    (req, reply) => projectsController.rebuild(req, reply)
  );

  // Servicio Base de Datos de Proyectos: Descargar Backup .SQL (project_db -> deploy)
  app.get(
    '/api/projects/:name/db-dump',
    { preHandler: [authenticate, requirePermission('project_db', 'deploy')] },
    (req, reply) => projectsController.dbDump(req, reply)
  );

  // Ver Logs en vivo de contenedores (projects -> edit)
  app.get(
    '/api/projects/:name/logs',
    { preHandler: [authenticate, requirePermission('projects', 'edit')] },
    (req, reply) => projectsController.getLogs(req, reply)
  );

  // Servicio Variables de Entorno (.env): Ver (project_env -> view) y Guardar (project_env -> edit)
  app.get(
    '/api/projects/:name/env',
    { preHandler: [authenticate, requirePermission('project_env', 'view')] },
    (req, reply) => projectsController.getEnv(req, reply)
  );

  app.post(
    '/api/projects/:name/env',
    { preHandler: [authenticate, requirePermission('project_env', 'edit')] },
    (req, reply) => projectsController.saveEnv(req, reply)
  );

  // Servicio Usuarios Internos de cada Proyecto (projects.app_users)
  app.get(
    '/api/projects/:name/app-users',
    { preHandler: [authenticate, requirePermission('projects.app_users', 'view')] },
    (req, reply) => projectsController.getAppUsers(req, reply)
  );

  app.post(
    '/api/projects/:name/app-users',
    { preHandler: [authenticate, requirePermission('projects.app_users', 'edit')] },
    (req, reply) => projectsController.saveAppUser(req, reply)
  );

  app.delete(
    '/api/projects/:name/app-users/:userId',
    { preHandler: [authenticate, requirePermission('projects.app_users', 'delete')] },
    (req, reply) => projectsController.deleteAppUser(req, reply)
  );
}
