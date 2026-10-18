import { DomainRouteRepositoryPort } from '../ports/repositories/domain-route-repository.port';
import { ReverseProxyPort } from '../ports/services/reverse-proxy.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { prismaDomainRouteRepository } from '../../infrastructure/repositories/prisma-domain-route.repository';
import { caddyProxyAdapter } from '../../infrastructure/adapters/caddy-proxy.adapter';

export class ManageDomainsUseCase {
  constructor(
    private readonly repository: DomainRouteRepositoryPort = prismaDomainRouteRepository,
    private readonly proxy: ReverseProxyPort = caddyProxyAdapter
  ) {}

  listRoutes() {
    return this.repository.listRoutes();
  }

  saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ) {
    return this.repository.saveRoute(route);
  }

  deleteRoute(id: string) {
    return this.repository.deleteRoute(id);
  }

  generateCaddyfile(routes?: DomainRouteEntity[]) {
    return this.proxy.generateCaddyfile(routes);
  }

  reloadCaddy() {
    return this.proxy.reloadCaddy();
  }
}

export const manageDomainsUseCase = new ManageDomainsUseCase();
