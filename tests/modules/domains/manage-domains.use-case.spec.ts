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

  it('CaddyProxyAdapter genera bloques handle y handle_path ordenados para múltiples microservicios', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-ms-test-'));
    const prevDataDir = process.env.PANEL_DATA_DIR;
    const prevCaddyPath = process.env.CADDYFILE_PATH;
    process.env.PANEL_DATA_DIR = tmpDir;
    process.env.CADDYFILE_PATH = path.join(tmpDir, 'Caddyfile');

    try {
      const { CaddyProxyAdapter } = await import(
        '../../../src/modules/domains/infrastructure/adapters/caddy-proxy.adapter'
      );
      const adapter = new CaddyProxyAdapter();
      const generated = await adapter.generateCaddyfile([
        {
          id: 'r-ms-1',
          domain: 'erp.sudoalexmar.tech',
          projectName: 'ClusterERP',
          frontendTarget: 'erp_web:5173',
          apiPathPrefix: '/api/*',
          backendTarget: 'erp_core:4000',
          extraRoutes: [
            {
              pathPrefix: '/api/facturacion/*',
              target: 'erp-ms-facturacion-1:4101',
              stripPrefix: false,
            },
            {
              pathPrefix: '/ms-nomina/*',
              target: 'erp-ms-nomina-1:4112',
              stripPrefix: true,
            },
          ],
          sslEnabled: true,
          createdAt: new Date().toISOString(),
        },
      ]);

      expect(generated).toContain('handle /api/facturacion/* {');
      expect(generated).toContain('reverse_proxy erp-ms-facturacion-1:4101');
      expect(generated).toContain('handle_path /ms-nomina/* {');
      expect(generated).toContain('reverse_proxy erp-ms-nomina-1:4112');
      expect(generated).toContain('handle /api/* {');
      expect(generated).toContain('reverse_proxy erp_core:4000');
      expect(generated).toContain('reverse_proxy erp_web:5173');
    } finally {
      if (prevDataDir === undefined) delete process.env.PANEL_DATA_DIR;
      else process.env.PANEL_DATA_DIR = prevDataDir;
      if (prevCaddyPath === undefined) delete process.env.CADDYFILE_PATH;
      else process.env.CADDYFILE_PATH = prevCaddyPath;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('syncDomainRoutePortsToProjectEnv preserva PORT intacto y agrega ALLOWED_ORIGINS en clústeres de microservicios', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { syncDomainRoutePortsToProjectEnv } = await import(
      '../../../src/modules/projects/application/use-cases/manage-container-power.use-case'
    );

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-env-sync-'));
    const projDir = path.join(rootDir, 'Proveko');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, 'docker-compose.yml'),
      [
        'services:',
        '  core:',
        '    container_name: proveko_core',
        '    ports:',
        '      - "${PORT:-4000}:4000"',
        '    environment:',
        '      PORT: 4000',
        '  ms-facturacion:',
        '    environment:',
        '      PORT: 4101',
        '  ms-nomina:',
        '    environment:',
        '      PORT: 4112',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(projDir, '.env'),
      'PORT=4000\nALLOWED_ORIGINS=http://localhost:4000\n',
      'utf-8'
    );

    try {
      syncDomainRoutePortsToProjectEnv(
        {
          domain: 'proveko.sudoalexmar.tech',
          projectName: 'Proveko',
          frontendTarget: 'proveko-ms-nomina-1:4112',
        },
        rootDir,
        '/opt/alpanel'
      );

      const finalEnv = fs.readFileSync(path.join(projDir, '.env'), 'utf-8');
      expect(finalEnv).toContain('PORT=4000');
      expect(finalEnv).not.toContain('PORT=4112');
      expect(finalEnv).toContain('https://proveko.sudoalexmar.tech');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
