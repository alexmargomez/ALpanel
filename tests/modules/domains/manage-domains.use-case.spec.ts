import { DomainNameVO } from '../../../src/modules/domains/domain/value-objects/domain-name.vo';
import { DomainException } from '../../../src/shared/domain/exceptions/domain.exception';
import { DomainRouteRepositoryPort } from '../../../src/modules/domains/application/ports/repositories/domain-route-repository.port';
import { ReverseProxyPort } from '../../../src/modules/domains/application/ports/services/reverse-proxy.port';
import { ManageDomainsUseCase } from '../../../src/modules/domains/application/use-cases/manage-domains.use-case';
import { DomainRouteEntity } from '../../../src/modules/domains/domain/entities/domain-route.entity';

class InMemoryDomainRouteRepositoryMock implements DomainRouteRepositoryPort {
  private routes: DomainRouteEntity[] = [];

  async listRoutes(): Promise<DomainRouteEntity[]> {
    return [...this.routes];
  }

  async saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ): Promise<DomainRouteEntity> {
    const cleanDomain = new DomainNameVO(route.domain).value;
    const entity: DomainRouteEntity = {
      id: route.id || `route-${this.routes.length + 1}`,
      domain: cleanDomain,
      projectName: route.projectName,
      frontendTarget: route.frontendTarget,
      apiPathPrefix: route.apiPathPrefix || '',
      backendTarget: route.backendTarget || '',
      sslEnabled: route.sslEnabled,
      createdAt: new Date().toISOString(),
    };
    const existingIdx = this.routes.findIndex((r) => r.id === entity.id);
    if (existingIdx >= 0) this.routes[existingIdx] = entity;
    else this.routes.push(entity);
    return entity;
  }

  async deleteRoute(id: string): Promise<boolean> {
    const before = this.routes.length;
    this.routes = this.routes.filter((r) => r.id !== id);
    return this.routes.length < before;
  }
}

class InMemoryReverseProxyMock implements ReverseProxyPort {
  public reloaded = 0;

  async generateCaddyfile(routes: DomainRouteEntity[] = []): Promise<string> {
    return routes
      .map((r) => `${r.domain} {\n  reverse_proxy ${r.frontendTarget}\n}`)
      .join('\n\n');
  }

  async reloadCaddy(): Promise<{ success: boolean; output: string }> {
    this.reloaded += 1;
    return { success: true, output: 'Caddy recargado correctamente (mock)' };
  }
}

describe('Domains Module — DomainNameVO & ManageDomainsUseCase', () => {
  it('DomainNameVO valida y normaliza dominios y rechaza formatos inválidos', () => {
    const vo = new DomainNameVO('  Panel.IntegraWeb.com.co ');
    expect(vo.value).toBe('panel.integraweb.com.co');

    const invalidList = ['', 'localhost', 'http://dominio.com', 'dominio_invalido'];
    for (const bad of invalidList) {
      expect(() => new DomainNameVO(bad)).toThrow(DomainException);
    }
  });

  it('ManageDomainsUseCase administra rutas, genera Caddyfile y recarga el proxy SSL', async () => {
    const repo = new InMemoryDomainRouteRepositoryMock();
    const proxy = new InMemoryReverseProxyMock();
    const useCase = new ManageDomainsUseCase(repo, proxy);

    const saved = await useCase.saveRoute({
      domain: 'hc.integraweb.com.co',
      projectName: 'hc_version2',
      frontendTarget: 'hc_version2_web:80',
      sslEnabled: true,
    });
    expect(saved.domain).toBe('hc.integraweb.com.co');

    const routes = await useCase.listRoutes();
    expect(routes).toHaveLength(1);

    const caddyfile = await useCase.generateCaddyfile(routes);
    expect(caddyfile).toMatch(/hc\.integraweb\.com\.co/);
    expect(caddyfile).toMatch(/reverse_proxy hc_version2_web:80/);

    const reloadRes = await useCase.reloadCaddy();
    expect(reloadRes.success).toBe(true);
    expect(proxy.reloaded).toBe(1);

    const deleted = await useCase.deleteRoute(saved.id);
    expect(deleted).toBe(true);
    expect(await useCase.listRoutes()).toHaveLength(0);
  });
});
