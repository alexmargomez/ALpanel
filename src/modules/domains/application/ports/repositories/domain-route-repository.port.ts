import { DomainRouteEntity } from '../../../domain/entities/domain-route.entity';

export interface DomainRouteRepositoryPort {
  listRoutes(): Promise<DomainRouteEntity[]>;
  saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ): Promise<DomainRouteEntity>;
  deleteRoute(id: string): Promise<boolean>;
}
