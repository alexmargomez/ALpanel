import { FastifyReply, FastifyRequest } from 'fastify';
import { projectsService } from './projects.service';
import { hostService } from '../../services/host.service';
import { securityService } from '../security/security.service';

export class ProjectsController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const [host, projects] = await Promise.all([
      hostService.getHostMetrics(),
      projectsService.listProjects(),
    ]);
    return {
      host,
      projectsRoot: projectsService.getProjectsRoot(),
      projects,
    };
  }

  async restart(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as { containerName?: string };
    const res = await projectsService.restartProject(name, body.containerName);
    await securityService.recordAudit(
      'DOCKER_RESTART',
      body.containerName ? `${name}/${body.containerName}` : name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async start(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.startProject(name);
    await securityService.recordAudit('DOCKER_START', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async stop(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.stopProject(name);
    await securityService.recordAudit('DOCKER_STOP', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async rebuild(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.rebuildProject(name);
    await securityService.recordAudit('DOCKER_REBUILD', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async clearCache(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.clearProjectCache(name);
    await securityService.recordAudit('CLEAR_CACHE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async dbDump(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      const { filename, sql } = await projectsService.dumpDatabaseSql(name);
      await securityService.recordAudit('DB_EXPORT_SQL', name, request.ip, 'ok');
      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(sql);
    } catch (error: any) {
      await securityService.recordAudit('DB_EXPORT_SQL', name, request.ip, 'error');
      return reply.code(400).send({ error: error?.message || 'Error exportando base de datos' });
    }
  }

  async getLogs(request: FastifyRequest, _reply: FastifyReply) {
    const { container, tail } = request.query as { container: string; tail?: string };
    const logs = await projectsService.getContainerLogs(container, Number(tail || 150));
    return { logs };
  }

  async getEnv(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    return projectsService.getEnvFileContent(name);
  }

  async saveEnv(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = request.body as { content: string; restart?: boolean };
    const res = await projectsService.saveEnvFileContent(name, body.content || '', body.restart !== false);
    await securityService.recordAudit('ENV_UPDATE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }
}

export const projectsController = new ProjectsController();
