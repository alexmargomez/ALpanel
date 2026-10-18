import { DomainRouteRepositoryPort } from '../../application/ports/repositories/domain-route-repository.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { domainsService } from '../../domains.service';

export class PrismaDomainRouteRepository implements DomainRouteRepositoryPort {
  listRoutes(): Promise<DomainRouteEntity[]> {
    return domainsService.listRoutes();
  }

  saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ): Promise<DomainRouteEntity> {
    return domainsService.saveRoute(route);
  }

  deleteRoute(id: string): Promise<boolean> {
    return domainsService.deleteRoute(id);
  }
}

export const prismaDomainRouteRepository = new PrismaDomainRouteRepository();
