import { DomainRouteEntity } from '../../../domain/entities/domain-route.entity';

export interface ReverseProxyPort {
  generateCaddyfile(routes?: DomainRouteEntity[]): Promise<string>;
  reloadCaddy(): Promise<{ success: boolean; output: string }>;
}
