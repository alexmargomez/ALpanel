export interface DomainRouteEntity {
  id: string;
  domain: string;
  projectName: string;
  frontendTarget: string;
  apiPathPrefix?: string;
  backendTarget?: string;
  sslEnabled: boolean;
  createdAt: string;
}

export type DomainRouteDto = DomainRouteEntity;
