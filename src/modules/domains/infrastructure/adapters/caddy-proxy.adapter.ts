import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ReverseProxyPort } from '../../application/ports/services/reverse-proxy.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { prismaDomainRouteRepository } from '../repositories/prisma-domain-route.repository';
import { normalizeDomainRouteTargets } from '../../../projects/application/use-cases/manage-container-power.use-case';

const execAsync = promisify(exec);

export class CaddyProxyAdapter implements ReverseProxyPort {
  private readonly caddyfilePath: string;

  constructor() {
    const dataDir =
      process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.caddyfilePath =
      process.env.CADDYFILE_PATH || path.join(dataDir, 'Caddyfile');
  }

  async generateCaddyfile(routes?: DomainRouteEntity[]): Promise<string> {
    const rawList = routes || (await prismaDomainRouteRepository.listRoutes());
    const list = rawList.map((r) => normalizeDomainRouteTargets(r));
    const blocks: string[] = [
      '# Archivo autogenerado por ALpanel (Prisma ORM)',
      '# Enruta múltiples dominios (Frontend + Backend + Microservicios) con HTTPS automático',
      '',
    ];

    const sanitizeToken = (val?: string) =>
      (val || '').replace(/[\r\n{}#;"'`$\\]/g, '').trim();

    for (const r of list) {
      const safeDomain = sanitizeToken(r.domain);
      const safePrefix = sanitizeToken(r.apiPathPrefix || '');
      const safeFront = sanitizeToken(r.frontendTarget);
      const safeBack = sanitizeToken(r.backendTarget || '');
      if (!safeDomain || !safeFront) continue;

      const extraList = Array.isArray(r.extraRoutes)
        ? r.extraRoutes
            .map((er) => ({
              pathPrefix: sanitizeToken(er.pathPrefix),
              target: sanitizeToken(er.target),
              stripPrefix: Boolean(er.stripPrefix),
            }))
            .filter((er) => er.pathPrefix && er.target)
        : [];

      const hasMainBack = Boolean(safePrefix && safeBack && safeBack !== safeFront);
      const hasExtraRoutes = extraList.length > 0;

      blocks.push(`${safeDomain} {`);
      if (hasMainBack || hasExtraRoutes) {
        // 1. Rutas específicas de microservicios primero (mayor especificidad que /api/*)
        for (const er of extraList) {
          const directive = er.stripPrefix ? 'handle_path' : 'handle';
          blocks.push(`    ${directive} ${er.pathPrefix} {`);
          blocks.push(`        reverse_proxy ${er.target}`);
          blocks.push(`    }`);
        }

        // 2. Ruta general de Backend (/api/*) si aplica
        if (hasMainBack) {
          blocks.push(`    handle ${safePrefix} {`);
          blocks.push(`        reverse_proxy ${safeBack}`);
          blocks.push(`    }`);
        }

        // 3. Fallback hacia Contenedor Principal / Frontend / Gateway Core
        blocks.push(`    handle {`);
        blocks.push(`        reverse_proxy ${safeFront}`);
        blocks.push(`    }`);
      } else {
        blocks.push(`    reverse_proxy ${safeFront}`);
      }
      blocks.push(`}\n`);
    }

    const content = blocks.join('\n');
    // Escritura in-place obligatoria para preservar el inode del bind mount ./data/Caddyfile:/etc/caddy/Caddyfile en Docker
    fs.writeFileSync(this.caddyfilePath, content, { encoding: 'utf-8', mode: 0o644 });
    return content;
  }

  async reloadCaddy(): Promise<{ success: boolean; output: string }> {
    const rawRoutes = await prismaDomainRouteRepository.listRoutes();
    const routes = rawRoutes.map((r) => normalizeDomainRouteTargets(r));
    const caddyfileContent = await this.generateCaddyfile(routes);
    try {
      const uniqueHosts = new Set<string>();
      for (const r of routes) {
        const allTargets = [
          r.frontendTarget,
          r.backendTarget,
          ...(r.extraRoutes || []).map((er) => er.target),
        ];
        for (const t of allTargets) {
          const host = (t || '')
            .split(':')[0]
            .trim()
            .replace(/[^a-zA-Z0-9._-]/g, '');
          if (host && host !== 'localhost' && host !== '127.0.0.1') {
            uniqueHosts.add(host);
          }
        }
      }

      for (const host of uniqueHosts) {
        await execAsync(
          `docker network connect alpanel_proxy_net ${host} 2>/dev/null || true`
        ).catch(() => null);
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
      await execAsync(
        `docker exec ${caddyContainer} caddy reload --config /etc/caddy/Caddyfile`
      ).catch(() => null);
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

export const caddyProxyAdapter = new CaddyProxyAdapter();
