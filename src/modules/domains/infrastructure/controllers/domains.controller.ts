import { FastifyReply, FastifyRequest } from 'fastify';
import { manageDomainsUseCase } from '../../application/use-cases/manage-domains.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';

export class DomainsController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const routes = await manageDomainsUseCase.listRoutes();
    const caddyfile = await manageDomainsUseCase.generateCaddyfile(routes);
    return { routes, caddyfile };
  }

  async save(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any;
    try {
      const saved = await manageDomainsUseCase.saveRoute(body);
      const reload = await manageDomainsUseCase.reloadCaddy();
      await manageAuditLogsUseCase.recordAudit(
        'DOMAIN_SAVE',
        saved.domain,
        request.ip,
        'ok'
      );
      return { route: saved, reload };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async remove(request: FastifyRequest, _reply: FastifyReply) {
    const { id } = request.params as { id: string };
    await manageDomainsUseCase.deleteRoute(id);
    const reload = await manageDomainsUseCase.reloadCaddy();
    await manageAuditLogsUseCase.recordAudit(
      'DOMAIN_DELETE',
      id,
      request.ip,
      'ok'
    );
    return { success: true, reload };
  }
}

export const domainsController = new DomainsController();
