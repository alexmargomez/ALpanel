import { DomainRouteRepositoryPort } from '../ports/repositories/domain-route-repository.port';
import { ReverseProxyPort } from '../ports/services/reverse-proxy.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { prismaDomainRouteRepository } from '../../infrastructure/repositories/prisma-domain-route.repository';
import { caddyProxyAdapter } from '../../infrastructure/adapters/caddy-proxy.adapter';
import {
  normalizeDomainRouteTargets,
  syncDomainRoutePortsToProjectEnv,
} from '../../../projects/application/use-cases/manage-container-power.use-case';

export class ManageDomainsUseCase {
  constructor(
    private readonly repository: DomainRouteRepositoryPort = prismaDomainRouteRepository,
    private readonly proxy: ReverseProxyPort = caddyProxyAdapter
  ) {}

  listRoutes() {
    return this.repository.listRoutes();
  }

  async saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ) {
    const normalized = normalizeDomainRouteTargets(route);
    const saved = await this.repository.saveRoute(normalized);
    syncDomainRoutePortsToProjectEnv(saved);
    const allRoutes = await this.repository.listRoutes();
    await this.proxy.generateCaddyfile(allRoutes);
    return saved;
  }

  async deleteRoute(id: string) {
    const ok = await this.repository.deleteRoute(id);
    const allRoutes = await this.repository.listRoutes();
    await this.proxy.generateCaddyfile(allRoutes);
    return ok;
  }

  generateCaddyfile(routes?: DomainRouteEntity[]) {
    return this.proxy.generateCaddyfile(routes);
  }

  reloadCaddy() {
    return this.proxy.reloadCaddy();
  }
}

export const manageDomainsUseCase = new ManageDomainsUseCase();
export type DomainsService = ManageDomainsUseCase;
export const domainsService = manageDomainsUseCase;
