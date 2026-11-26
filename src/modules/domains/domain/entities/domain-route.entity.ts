export interface DomainMicroserviceRoute {
  pathPrefix: string;
  target: string;
  stripPrefix?: boolean;
  serviceName?: string;
  serverId?: string;
}

export interface DomainRouteEntity {
  id: string;
  domain: string;
  projectName: string;
  serverId?: string;
  frontendTarget: string;
  apiPathPrefix?: string;
  backendTarget?: string;
  extraRoutes?: DomainMicroserviceRoute[];
  sslEnabled: boolean;
  createdAt: string;
}

export type DomainRouteDto = DomainRouteEntity;
