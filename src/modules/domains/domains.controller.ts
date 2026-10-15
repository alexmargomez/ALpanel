import { FastifyReply, FastifyRequest } from 'fastify';
import { domainsService } from './domains.service';
import { securityService } from '../security/security.service';

export class DomainsController {
  async list(_request: FastifyRequest, _reply: FastifyReply) {
    const routes = await domainsService.listRoutes();
    const caddyfile = await domainsService.generateCaddyfile(routes);
    return { routes, caddyfile };
  }

  async save(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as any;
    try {
      const saved = await domainsService.saveRoute(body);
      const reload = await domainsService.reloadCaddy();
      await securityService.recordAudit('DOMAIN_SAVE', saved.domain, request.ip, 'ok');
      return { route: saved, reload };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  }

  async remove(request: FastifyRequest, _reply: FastifyReply) {
    const { id } = request.params as { id: string };
    await domainsService.deleteRoute(id);
    const reload = await domainsService.reloadCaddy();
    await securityService.recordAudit('DOMAIN_DELETE', id, request.ip, 'ok');
    return { success: true, reload };
  }
}

export const domainsController = new DomainsController();
