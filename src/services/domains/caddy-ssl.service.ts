import { domainsService } from '../../modules/domains/domains.service';
import { DomainRouteDto } from '../../modules/domains/domains.model';

/**
 * Servicio Técnico del Módulo `domains` (`domains.manage`)
 * Gestiona rutas de dominios y recarga en vivo los certificados Let's Encrypt en Caddy.
 */
export class CaddySslService {
  async listRoutes() {
    return domainsService.listRoutes();
  }

  async saveRoute(route: Omit<DomainRouteDto, 'id' | 'createdAt'> & { id?: string }) {
    return domainsService.saveRoute(route);
  }

  async deleteRoute(id: string) {
    return domainsService.deleteRoute(id);
  }

  async reloadCaddy() {
    return domainsService.reloadCaddy();
  }
}

export const caddySslService = new CaddySslService();
