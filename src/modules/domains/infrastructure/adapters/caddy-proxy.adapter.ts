import { ReverseProxyPort } from '../../application/ports/services/reverse-proxy.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { domainsService } from '../../domains.service';

export class CaddyProxyAdapter implements ReverseProxyPort {
  generateCaddyfile(routes?: DomainRouteEntity[]): Promise<string> {
    return domainsService.generateCaddyfile(routes);
  }

  reloadCaddy(): Promise<{ success: boolean; output: string }> {
    return domainsService.reloadCaddy();
  }
}

export const caddyProxyAdapter = new CaddyProxyAdapter();
