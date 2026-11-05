import { FastifyReply, FastifyRequest } from 'fastify';
import { projectsService } from '../../application/use-cases/projects-facade.use-case';
import { hostService } from '../../../../shared/infrastructure/services/host-metrics.service';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';
import { manageProjectAppUsersUseCase } from '../../application/use-cases/manage-project-app-users.use-case';

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
    await manageAuditLogsUseCase.recordAudit(
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
    await manageAuditLogsUseCase.recordAudit(
      'DOCKER_START',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async stop(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.stopProject(name);
    await manageAuditLogsUseCase.recordAudit(
      'DOCKER_STOP',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async rebuild(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as {
      containerName?: string;
      serviceName?: string;
    };
    const res = await projectsService.rebuildProject(
      name,
      body.containerName,
      body.serviceName
    );
    await manageAuditLogsUseCase.recordAudit(
      'DOCKER_REBUILD',
      body.containerName ? `${name}/${body.containerName}` : name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async rebuildDestroy(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as {
      containerName?: string;
      serviceName?: string;
    };
    const res = await projectsService.rebuildDestroyProject(
      name,
      body.containerName,
      body.serviceName
    );
    await manageAuditLogsUseCase.recordAudit(
      'DOCKER_REBUILD_DESTROY',
      body.containerName ? `${name}/${body.containerName}` : name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async deleteProject(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.deleteProject(name);
    await manageAuditLogsUseCase.recordAudit(
      'PROJECT_DELETE',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    if (!res.success) {
      return reply.code(400).send({ error: res.output, output: res.output });
    }
    return res;
  }

  async clearCache(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await projectsService.clearProjectCache(name);
    await manageAuditLogsUseCase.recordAudit(
      'CLEAR_CACHE',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async dbDump(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      const { filename, sql } = await projectsService.dumpDatabaseSql(name);
      await manageAuditLogsUseCase.recordAudit(
        'DB_EXPORT_SQL',
        name,
        request.ip,
        'ok'
      );
      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(sql);
    } catch (error: any) {
      await manageAuditLogsUseCase.recordAudit(
        'DB_EXPORT_SQL',
        name,
        request.ip,
        'error'
      );
      return reply
        .code(400)
        .send({ error: error?.message || 'Error exportando base de datos' });
    }
  }

  async getLogs(request: FastifyRequest, _reply: FastifyReply) {
    const { container, tail } = request.query as {
      container: string;
      tail?: string;
    };
    const logs = await projectsService.getContainerLogs(
      container,
      Number(tail || 150)
    );
    return { logs };
  }

  async getEnv(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    return projectsService.getEnvFileContent(name);
  }

  async saveEnv(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = request.body as { content: string; restart?: boolean };
    const res = await projectsService.saveEnvFileContent(
      name,
      body.content || '',
      body.restart !== false
    );
    await manageAuditLogsUseCase.recordAudit(
      'ENV_UPDATE',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async getAppUsers(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      return await manageProjectAppUsersUseCase.getProjectUsers(name);
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Error consultando usuarios del proyecto',
      });
    }
  }

  async saveAppUser(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as any;
    try {
      const res = await manageProjectAppUsersUseCase.saveProjectUser(name, body);
      await manageAuditLogsUseCase.recordAudit(
        'APP_USER_SAVE',
        `${name}/${body.username || ''}`,
        request.ip,
        'ok'
      );
      return res;
    } catch (error: any) {
      await manageAuditLogsUseCase.recordAudit(
        'APP_USER_SAVE',
        name,
        request.ip,
        'error'
      );
      return reply.code(400).send({
        error: error?.message || 'Error guardando usuario del proyecto',
      });
    }
  }

  async deleteAppUser(request: FastifyRequest, reply: FastifyReply) {
    const { name, userId } = request.params as { name: string; userId: string };
    try {
      const res = await manageProjectAppUsersUseCase.deleteProjectUser(
        name,
        userId
      );
      await manageAuditLogsUseCase.recordAudit(
        'APP_USER_DELETE',
        `${name}/#${userId}`,
        request.ip,
        'ok'
      );
      return res;
    } catch (error: any) {
      await manageAuditLogsUseCase.recordAudit(
        'APP_USER_DELETE',
        `${name}/#${userId}`,
        request.ip,
        'error'
      );
      return reply.code(400).send({
        error: error?.message || 'Error eliminando usuario del proyecto',
      });
    }
  }

  async dbErd(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      const schema = await projectsService.inspectProjectErd(name);
      await manageAuditLogsUseCase.recordAudit(
        'DB_ERD_INSPECT',
        name,
        request.ip,
        'ok'
      );
      return schema;
    } catch (error: any) {
      await manageAuditLogsUseCase.recordAudit(
        'DB_ERD_INSPECT',
        name,
        request.ip,
        'error'
      );
      return reply.code(400).send({
        error:
          error?.message ||
          'Error inspeccionando modelo DER / ERD de la base de datos',
      });
    }
  }

  async getCronjobs(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      const cronjobs = projectsService.listProjectCronjobs(name);
      return { cronjobs };
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Error consultando cronjobs del proyecto',
      });
    }
  }

  async saveCronjob(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as any;
    try {
      const cronjob = await projectsService.saveProjectCronjob(name, body);
      await manageAuditLogsUseCase.recordAudit(
        'CRONJOB_SAVE',
        `${name}/${cronjob.name}`,
        request.ip,
        'ok'
      );
      return { cronjob };
    } catch (error: any) {
      await manageAuditLogsUseCase.recordAudit(
        'CRONJOB_SAVE',
        name,
        request.ip,
        'error'
      );
      return reply.code(400).send({
        error: error?.message || 'Error guardando cronjob del proyecto',
      });
    }
  }

  async deleteCronjob(request: FastifyRequest, reply: FastifyReply) {
    const { name, cronId } = request.params as {
      name: string;
      cronId: string;
    };
    try {
      const res = projectsService.deleteProjectCronjob(name, cronId);
      await manageAuditLogsUseCase.recordAudit(
        'CRONJOB_DELETE',
        `${name}/${cronId}`,
        request.ip,
        'ok'
      );
      return res;
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Error eliminando cronjob del proyecto',
      });
    }
  }

  async runCronjobNow(request: FastifyRequest, reply: FastifyReply) {
    const { name, cronId } = request.params as {
      name: string;
      cronId: string;
    };
    try {
      const cronjob = await projectsService.runProjectCronjobNow(name, cronId);
      await manageAuditLogsUseCase.recordAudit(
        'CRONJOB_EXEC',
        `${name}/${cronjob.name}`,
        request.ip,
        cronjob.lastStatus === 'ok' ? 'ok' : 'error'
      );
      return { cronjob };
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Error ejecutando cronjob del proyecto',
      });
    }
  }

  async executeTerminal(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as {
      targetType?: 'container' | 'host';
      containerName?: string;
      command: string;
      cwd?: string;
    };
    try {
      const res = await projectsService.executeTerminalCommand(name, body);
      await manageAuditLogsUseCase.recordAudit(
        'PROJECT_TERMINAL_EXEC',
        `${name} (${res.targetLabel}): ${(body.command || '').slice(0, 80)}`,
        request.ip,
        res.success ? 'ok' : 'error'
      );
      return res;
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Error ejecutando comando en terminal',
      });
    }
  }

  async getMicroservices(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    try {
      return await projectsService.getProjectMicroservices(name);
    } catch (error: any) {
      return reply.code(400).send({
        error:
          error?.message || 'Error consultando microservicios del proyecto',
      });
    }
  }

  async saveMicroservices(request: FastifyRequest, reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as { enabledMicroservices?: string[] };
    try {
      const enabled = Array.isArray(body.enabledMicroservices)
        ? body.enabledMicroservices
        : [];
      const res = await projectsService.applyProjectMicroservices(
        name,
        enabled
      );
      await manageAuditLogsUseCase.recordAudit(
        'PROJECT_MICROSERVICES_UPDATE',
        `${name} (${enabled.length} activos)`,
        request.ip,
        res.success ? 'ok' : 'error'
      );
      if (!res.success) {
        return reply.code(400).send({ error: res.output, output: res.output });
      }
      return res;
    } catch (error: any) {
      return reply.code(400).send({
        error:
          error?.message || 'Error aplicando configuración de microservicios',
      });
    }
  }

  async detectRemoteMicroservices(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const body = (request.body || {}) as { repoUrl: string; branch?: string };
    try {
      return await projectsService.detectRemoteRepoMicroservices(body);
    } catch (error: any) {
      return reply.code(400).send({
        error:
          error?.message ||
          'Error inspeccionando arquitectura del repositorio remoto',
      });
    }
  }
}

export const projectsController = new ProjectsController();
