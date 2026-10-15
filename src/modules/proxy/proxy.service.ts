import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DomainRoute {
  id: string;
  domain: string;
  projectName: string;
  frontendTarget: string; // e.g. "web:8000" or "mi_front:3000"
  apiPathPrefix?: string; // e.g. "/api/*"
  backendTarget?: string; // e.g. "mi_back:8080"
  sslEnabled: boolean;
  createdAt: string;
}

export class ProxyService {
  private dataFile: string;
  private caddyfilePath: string;

  constructor() {
    const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFile = path.join(dataDir, 'domains.json');
    this.caddyfilePath = process.env.CADDYFILE_PATH || path.join(dataDir, 'Caddyfile');
    this.ensureStorage();
  }

  private ensureStorage() {
    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  listRoutes(): DomainRoute[] {
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  saveRoute(route: Omit<DomainRoute, 'id' | 'createdAt'> & { id?: string }): DomainRoute {
    const cleanDomain = (route.domain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
      throw new Error('Formato de dominio inválido.');
    }

    const routes = this.listRoutes();
    const id = route.id || `route-${Date.now()}`;
    const existingIdx = routes.findIndex((r) => r.id === id || r.domain === cleanDomain);

    const record: DomainRoute = {
      id,
      domain: cleanDomain,
      projectName: route.projectName.trim(),
      frontendTarget: route.frontendTarget.trim(),
      apiPathPrefix: route.apiPathPrefix?.trim() || '',
      backendTarget: route.backendTarget?.trim() || '',
      sslEnabled: route.sslEnabled !== false,
      createdAt: existingIdx >= 0 ? routes[existingIdx].createdAt : new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      routes[existingIdx] = record;
    } else {
      routes.push(record);
    }

    fs.writeFileSync(this.dataFile, JSON.stringify(routes, null, 2), 'utf-8');
    this.generateCaddyfile(routes);
    return record;
  }

  deleteRoute(id: string): boolean {
    const routes = this.listRoutes();
    const filtered = routes.filter((r) => r.id !== id);
    fs.writeFileSync(this.dataFile, JSON.stringify(filtered, null, 2), 'utf-8');
    this.generateCaddyfile(filtered);
    return filtered.length !== routes.length;
  }

  generateCaddyfile(routes?: DomainRoute[]): string {
    const list = routes || this.listRoutes();
    const blocks: string[] = [
      '# Archivo autogenerado por ALpanel',
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
    const caddyfileContent = this.generateCaddyfile();
    try {
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
      await execAsync(
        `docker exec ${caddyContainer} caddy reload --config /etc/caddy/Caddyfile`
      ).catch(() => null);
      return {
        success: true,
        output: `Configuración guardada y recargada en vivo en ${caddyContainer}.\n\n${caddyfileContent}`,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Error al sincronizar Caddy',
      };
    }
  }
}
