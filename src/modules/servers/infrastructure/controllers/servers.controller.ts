import { FastifyReply, FastifyRequest } from 'fastify';
import { manageServersUseCase } from '../../application/use-cases/manage-servers.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';

export class ServersController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const [servers, gitCredentials] = await Promise.all([
      manageServersUseCase.listServers(),
      manageServersUseCase.listGitCredentials(),
    ]);
    return { servers, gitCredentials };
  }

  async save(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body || {}) as any;
      const server = await manageServersUseCase.saveServer(body);
      await manageAuditLogsUseCase.recordAudit(
        'SERVER_SAVE',
        `${server.name} (${server.host})`,
        request.ip,
        'ok'
      );
      return { server };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      await manageServersUseCase.deleteServer(id);
      await manageAuditLogsUseCase.recordAudit('SERVER_DELETE', id, request.ip, 'ok');
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async testConnection(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const server = await manageServersUseCase.testServerConnection(id);
      return { server };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async listContainers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const containers = await manageServersUseCase.listContainersOnServer(id);
      return { containers };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async provision(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const res = await manageServersUseCase.provisionServer(id);
      await manageAuditLogsUseCase.recordAudit(
        'SERVER_PROVISION',
        id,
        request.ip,
        res.success ? 'ok' : 'error'
      );
      return res;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async saveGitCredential(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = (request.body || {}) as any;
      const credential = await manageServersUseCase.saveGitCredential(body);
      return { credential };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async deleteGitCredential(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      await manageServersUseCase.deleteGitCredential(id);
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }
}

export const serversController = new ServersController();
