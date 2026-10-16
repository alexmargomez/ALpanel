import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../config/prisma';
import { DomainRouteDto } from './domains.model';

const execAsync = promisify(exec);

export class DomainsService {
  private dataFile: string;
  private caddyfilePath: string;

  constructor() {
    const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFile = path.join(dataDir, 'domains.json');
    this.caddyfilePath = process.env.CADDYFILE_PATH || path.join(dataDir, 'Caddyfile');
  }

  async listRoutes(): Promise<DomainRouteDto[]> {
    try {
      const rows = await prisma.domainRoute.findMany({
        orderBy: { createdAt: 'asc' },
      });
      const mapped: DomainRouteDto[] = rows.map((r: any) => ({
        id: r.id,
        domain: r.domain,
        projectName: r.projectName,
        frontendTarget: r.frontendTarget,
        apiPathPrefix: r.apiPathPrefix || '',
        backendTarget: r.backendTarget || '',
        sslEnabled: r.sslEnabled,
        createdAt: r.createdAt.toISOString(),
      }));
      this.syncMirrorFile(mapped);
      return mapped;
    } catch {
      return this.readMirrorFile();
    }
  }

  private readMirrorFile(): DomainRouteDto[] {
    try {
      if (fs.existsSync(this.dataFile)) {
        return JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      }
    } catch {}
    return [];
  }

  private syncMirrorFile(routes: DomainRouteDto[]) {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(routes, null, 2), 'utf-8');
    } catch {}
  }

  async saveRoute(
    route: Omit<DomainRouteDto, 'id' | 'createdAt'> & { id?: string }
  ): Promise<DomainRouteDto> {
    const cleanDomain = (route.domain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
      throw new Error('Formato de dominio inválido.');
    }

    const existing = await prisma.domainRoute.findFirst({
      where: route.id ? { OR: [{ id: route.id }, { domain: cleanDomain }] } : { domain: cleanDomain },
    });

    const id = existing?.id || route.id || `route-${Date.now()}`;
    const saved = await prisma.domainRoute.upsert({
      where: { id },
      update: {
        domain: cleanDomain,
        projectName: (route.projectName || '').trim(),
        frontendTarget: (route.frontendTarget || '').trim(),
        apiPathPrefix: route.apiPathPrefix?.trim() || '',
        backendTarget: route.backendTarget?.trim() || '',
        sslEnabled: route.sslEnabled !== false,
      },
      create: {
        id,
        domain: cleanDomain,
        projectName: (route.projectName || '').trim(),
        frontendTarget: (route.frontendTarget || '').trim(),
        apiPathPrefix: route.apiPathPrefix?.trim() || '',
        backendTarget: route.backendTarget?.trim() || '',
        sslEnabled: route.sslEnabled !== false,
      },
    });

    const allRoutes = await this.listRoutes();
    await this.generateCaddyfile(allRoutes);

    return {
      id: saved.id,
      domain: saved.domain,
      projectName: saved.projectName,
      frontendTarget: saved.frontendTarget,
      apiPathPrefix: saved.apiPathPrefix,
      backendTarget: saved.backendTarget,
      sslEnabled: saved.sslEnabled,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async deleteRoute(id: string): Promise<boolean> {
    await prisma.domainRoute.deleteMany({ where: { id } });
    const allRoutes = await this.listRoutes();
    await this.generateCaddyfile(allRoutes);
    return true;
  }

  async generateCaddyfile(routes?: DomainRouteDto[]): Promise<string> {
    const list = routes || (await this.listRoutes());
    const blocks: string[] = [
      '# Archivo autogenerado por ALpanel (Prisma ORM)',
      '# Enruta múltiples dominios (Frontend + Backend) con HTTPS automático',
      '',
    ];

    for (const r of list) {
      blocks.push(`${r.domain} {`);
      if (r.apiPathPrefix && r.backendTarget && r.backendTarget !== r.frontendTarget) {
        blocks.push(`    handle ${r.apiPathPrefix} {`);
        blocks.push(`        reverse_proxy ${r.backendTarget}`);
        blocks.push(`    }`);
        blocks.push(`    handle {`);
        blocks.push(`        reverse_proxy ${r.frontendTarget}`);
        blocks.push(`    }`);
      } else {
        blocks.push(`    reverse_proxy ${r.frontendTarget}`);
      }
      blocks.push(`}\n`);
    }

    const content = blocks.join('\n');
    fs.writeFileSync(this.caddyfilePath, content, 'utf-8');
    return content;
  }

  async reloadCaddy(): Promise<{ success: boolean; output: string }> {
    const routes = await this.listRoutes();
    const caddyfileContent = await this.generateCaddyfile(routes);
    try {
      for (const r of routes) {
        for (const t of [r.frontendTarget, r.backendTarget]) {
          const host = (t || '').split(':')[0].trim().replace(/[^a-zA-Z0-9._-]/g, '');
          if (host && host !== 'localhost' && host !== '127.0.0.1') {
            await execAsync(`docker network connect alpanel_proxy_net ${host} 2>/dev/null || true`).catch(
              () => null
            );
          }
        }
      }

      const { stdout } = await execAsync(
        'docker ps --filter "ancestor=caddy:2" --format "{{.Names}}" | head -n 1'
      );
      const caddyContainer = stdout.trim();
      if (!caddyContainer) {
        return {
          success: true,
          output: `Caddyfile actualizado correctamente.\n\n${caddyfileContent}`,
        };
      }
      await execAsync(`docker exec ${caddyContainer} caddy reload --config /etc/caddy/Caddyfile`).catch(
        () => null
      );
      return {
        success: true,
        output: `Configuración guardada en MariaDB (Prisma) y recargada en vivo en ${caddyContainer}.\n\n${caddyfileContent}`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Error al sincronizar Caddy',
      };
    }
  }
}

export const domainsService = new DomainsService();
