import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainNameVO } from '../../domain/value-objects/domain-name.vo';
import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';
import { DomainRouteRepositoryPort } from '../ports/repositories/domain-route-repository.port';
import { ReverseProxyPort } from '../ports/services/reverse-proxy.port';
import { ManageDomainsUseCase } from '../use-cases/manage-domains.use-case';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';

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
    assert.equal(vo.value, 'panel.integraweb.com.co');

    const invalidList = ['', 'localhost', 'http://dominio.com', 'dominio_invalido'];
    for (const bad of invalidList) {
      assert.throws(
        () => new DomainNameVO(bad),
        (err: unknown) => err instanceof DomainException && err.statusCode === 400
      );
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
    assert.equal(saved.domain, 'hc.integraweb.com.co');

    const routes = await useCase.listRoutes();
    assert.equal(routes.length, 1);

    const caddyfile = await useCase.generateCaddyfile(routes);
    assert.match(caddyfile, /hc\.integraweb\.com\.co/);
    assert.match(caddyfile, /reverse_proxy hc_version2_web:80/);

    const reloadRes = await useCase.reloadCaddy();
    assert.equal(reloadRes.success, true);
    assert.equal(proxy.reloaded, 1);

    const deleted = await useCase.deleteRoute(saved.id);
    assert.equal(deleted, true);
    assert.equal((await useCase.listRoutes()).length, 0);
  });
});
