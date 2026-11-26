import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ReverseProxyPort } from '../../application/ports/services/reverse-proxy.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';
import { prismaDomainRouteRepository } from '../repositories/prisma-domain-route.repository';
import { normalizeDomainRouteTargets } from '../../../projects/application/use-cases/manage-container-power.use-case';
import { manageServersUseCase } from '../../../servers/application/use-cases/manage-servers.use-case';
import { remoteExecutorService } from '../../../servers/infrastructure/services/remote-executor.service';

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

  private renderBlocks(list: DomainRouteEntity[]): string {
    const blocks: string[] = [
      '# Archivo autogenerado por ALpanel (Prisma ORM)',
      '# Enruta múltiples dominios (Frontend + Backend + Microservicios + Cross-Server) con HTTPS automático',
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
        for (const er of extraList) {
          const directive = er.stripPrefix ? 'handle_path' : 'handle';
          blocks.push(`    ${directive} ${er.pathPrefix} {`);
          blocks.push(`        reverse_proxy ${er.target}`);
          blocks.push(`    }`);
        }
        if (hasMainBack) {
          blocks.push(`    handle ${safePrefix} {`);
          blocks.push(`        reverse_proxy ${safeBack}`);
          blocks.push(`    }`);
        }
        blocks.push(`    handle {`);
        blocks.push(`        reverse_proxy ${safeFront}`);
        blocks.push(`    }`);
      } else {
        blocks.push(`    reverse_proxy ${safeFront}`);
      }
      blocks.push(`}\n`);
    }

    return blocks.join('\n');
  }

  async generateCaddyfile(routes?: DomainRouteEntity[]): Promise<string> {
    const rawList = routes || (await prismaDomainRouteRepository.listRoutes());
    const list = rawList
      .filter((r) => !r.serverId || r.serverId === 'local')
      .map((r) => normalizeDomainRouteTargets(r));

    const content = this.renderBlocks(list);
    // Escritura in-place obligatoria para preservar el inode del bind mount ./data/Caddyfile:/etc/caddy/Caddyfile en Docker
    fs.writeFileSync(this.caddyfilePath, content, { encoding: 'utf-8', mode: 0o644 });
    return content;
  }

  private isIpAddress(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  }

  async reloadCaddy(): Promise<{ success: boolean; output: string }> {
    const rawRoutes = await prismaDomainRouteRepository.listRoutes();
    const localRoutes = rawRoutes
      .filter((r) => !r.serverId || r.serverId === 'local')
      .map((r) => normalizeDomainRouteTargets(r));
    const remoteRoutesByServer = new Map<string, DomainRouteEntity[]>();
    for (const r of rawRoutes) {
      if (r.serverId && r.serverId !== 'local') {
        const arr = remoteRoutesByServer.get(r.serverId) || [];
        arr.push(r);
        remoteRoutesByServer.set(r.serverId, arr);
      }
    }

    const caddyfileContent = await this.generateCaddyfile(localRoutes);
    const logs: string[] = [];

    try {
      const uniqueLocalContainers = new Set<string>();
      for (const r of localRoutes) {
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
          if (
            host &&
            host !== 'localhost' &&
            host !== '127.0.0.1' &&
            !this.isIpAddress(host)
          ) {
            uniqueLocalContainers.add(host);
          }
        }
      }

      for (const host of uniqueLocalContainers) {
        await execAsync(
          `docker network connect alpanel_proxy_net ${host} 2>/dev/null || true`
        ).catch(() => null);
      }

      const { stdout } = await execAsync(
        'docker ps --filter "ancestor=caddy:2" --format "{{.Names}}" | head -n 1'
      );
      const caddyContainer = stdout.trim();
      if (caddyContainer) {
        await execAsync(
          `docker exec ${caddyContainer} caddy reload --config /etc/caddy/Caddyfile`
        ).catch(() => null);
        logs.push(`✅ Proxy Central (${caddyContainer}) recargado en vivo.`);
      } else {
        logs.push('✅ Caddyfile central actualizado.');
      }

      // Sincronizar dominios independientes configurados en servidores remotos
      for (const [serverId, serverRoutes] of remoteRoutesByServer.entries()) {
        try {
          const server = await manageServersUseCase.getStoredServerById(serverId);
          const remoteCaddyContent = this.renderBlocks(serverRoutes);
          const b64 = Buffer.from(remoteCaddyContent, 'utf-8').toString('base64');
          const syncScript = [
            'mkdir -p /etc/caddy',
            `echo "${b64}" | base64 -d > /etc/caddy/Caddyfile`,
            'CADDY_C=$(docker ps --filter "ancestor=caddy:2" --format "{{.Names}}" 2>/dev/null | head -n 1)',
            'if [ -n "$CADDY_C" ]; then docker exec "$CADDY_C" caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true; elif command -v caddy >/dev/null 2>&1; then caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy 2>/dev/null || true; fi',
          ].join('\n');
          await remoteExecutorService.execOnServer(server, syncScript, {
            timeoutMs: 20000,
          });
          logs.push(`✅ Caddy independiente sincronizado en servidor remoto ${server.name}.`);
        } catch (err: any) {
          logs.push(`⚠️ No se pudo recargar Caddy en servidor ${serverId}: ${err?.message}`);
        }
      }

      return {
        success: true,
        output: `${logs.join('\n')}\n\n${caddyfileContent}`,
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
