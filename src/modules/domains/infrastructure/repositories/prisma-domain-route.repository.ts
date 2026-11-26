import fs from 'fs';
import path from 'path';
import { prisma } from '../../../../shared/infrastructure/database/prisma.service';
import { DomainRouteRepositoryPort } from '../../application/ports/repositories/domain-route-repository.port';
import {
  DomainMicroserviceRoute,
  DomainRouteEntity,
} from '../../domain/entities/domain-route.entity';

const EXTRA_ROUTES_SETTING_KEY = 'domain_extra_routes_v1';
const ROUTE_SERVERS_SETTING_KEY = 'domain_route_servers_v1';

function sanitizeExtraRoutes(
  raw?: DomainMicroserviceRoute[]
): DomainMicroserviceRoute[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: DomainMicroserviceRoute[] = [];
  for (const item of raw) {
    let prefix = String(item?.pathPrefix || '').trim();
    const target = String(item?.target || '').trim();
    if (!prefix || !target) continue;
    if (!prefix.startsWith('/')) {
      prefix = `/${prefix}`;
    }
    cleaned.push({
      pathPrefix: prefix,
      target,
      stripPrefix: Boolean(item?.stripPrefix),
      serviceName: item?.serviceName ? String(item.serviceName).trim() : undefined,
      serverId: item?.serverId ? String(item.serverId).trim() : undefined,
    });
  }
  return cleaned;
}

export class PrismaDomainRouteRepository implements DomainRouteRepositoryPort {
  private readonly dataFile: string;

  constructor() {
    const dataDir =
      process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.dataFile = path.join(dataDir, 'domains.json');
  }

  private async readRouteServersMap(): Promise<Record<string, string>> {
    try {
      const row = await prisma.panelSetting.findUnique({
        where: { settingKey: ROUTE_SERVERS_SETTING_KEY },
      });
      if (row?.settingValue) {
        const parsed = JSON.parse(row.settingValue);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore
    }
    return {};
  }

  private async writeRouteServersMap(map: Record<string, string>): Promise<void> {
    try {
      const serialized = JSON.stringify(map);
      await prisma.panelSetting.upsert({
        where: { settingKey: ROUTE_SERVERS_SETTING_KEY },
        update: { settingValue: serialized },
        create: { settingKey: ROUTE_SERVERS_SETTING_KEY, settingValue: serialized },
      });
    } catch {
      // ignore
    }
  }

  private async readExtraRoutesMap(): Promise<
    Record<string, DomainMicroserviceRoute[]>
  > {
    try {
      const row = await prisma.panelSetting.findUnique({
        where: { settingKey: EXTRA_ROUTES_SETTING_KEY },
      });
      if (row?.settingValue) {
        const parsed = JSON.parse(row.settingValue);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      const mirror = this.readMirrorFile();
      const fallback: Record<string, DomainMicroserviceRoute[]> = {};
      for (const m of mirror) {
        if (m.id && Array.isArray(m.extraRoutes) && m.extraRoutes.length > 0) {
          fallback[m.id] = sanitizeExtraRoutes(m.extraRoutes);
        }
      }
      return fallback;
    }
    return {};
  }

  private async writeExtraRoutesMap(
    map: Record<string, DomainMicroserviceRoute[]>
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(map);
      await prisma.panelSetting.upsert({
        where: { settingKey: EXTRA_ROUTES_SETTING_KEY },
        update: { settingValue: serialized },
        create: {
          settingKey: EXTRA_ROUTES_SETTING_KEY,
          settingValue: serialized,
        },
      });
    } catch {
      // Fallback handled by domains.json mirror
    }
  }

  async listRoutes(): Promise<DomainRouteEntity[]> {
    try {
      const [rows, extraMap, serverMap] = await Promise.all([
        prisma.domainRoute.findMany({
          orderBy: { createdAt: 'asc' },
        }),
        this.readExtraRoutesMap(),
        this.readRouteServersMap(),
      ]);
      const mapped: DomainRouteEntity[] = [];
      for (const r of rows) {
        let frontendTarget = String(r.frontendTarget || '');
        let backendTarget = String(r.backendTarget || '');
        if (frontendTarget.includes('sm_server_panel')) {
          frontendTarget = frontendTarget.replace(
            /sm_server_panel/g,
            'alpanel_server'
          );
          await prisma.domainRoute
            .update({ where: { id: r.id }, data: { frontendTarget } })
            .catch(() => null);
        }
        if (backendTarget.includes('sm_server_panel')) {
          backendTarget = backendTarget.replace(
            /sm_server_panel/g,
            'alpanel_server'
          );
          await prisma.domainRoute
            .update({ where: { id: r.id }, data: { backendTarget } })
            .catch(() => null);
        }
        mapped.push({
          id: r.id,
          domain: r.domain,
          projectName: r.projectName,
          serverId: serverMap[r.id] || 'local',
          frontendTarget,
          apiPathPrefix: r.apiPathPrefix || '',
          backendTarget,
          extraRoutes: sanitizeExtraRoutes(extraMap[r.id]),
          sslEnabled: r.sslEnabled,
          createdAt: r.createdAt.toISOString(),
        });
      }
      this.syncMirrorFile(mapped);
      return mapped;
    } catch {
      return this.readMirrorFile();
    }
  }

  private readMirrorFile(): DomainRouteEntity[] {
    try {
      if (fs.existsSync(this.dataFile)) {
        return JSON.parse(fs.readFileSync(this.dataFile, 'utf-8'));
      }
    } catch {}
    return [];
  }

  private syncMirrorFile(routes: DomainRouteEntity[]) {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(routes, null, 2), 'utf-8');
    } catch {}
  }

  async saveRoute(
    route: Omit<DomainRouteEntity, 'id' | 'createdAt'> & { id?: string }
  ): Promise<DomainRouteEntity> {
    const cleanDomain = (route.domain || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
      throw new Error('Formato de dominio inválido.');
    }

    const existing = await prisma.domainRoute.findFirst({
      where: route.id
        ? { OR: [{ id: route.id }, { domain: cleanDomain }] }
        : { domain: cleanDomain },
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

    const extraRoutes = sanitizeExtraRoutes(route.extraRoutes);
    const [extraMap, serverMap] = await Promise.all([
      this.readExtraRoutesMap(),
      this.readRouteServersMap(),
    ]);
    if (extraRoutes.length > 0) {
      extraMap[saved.id] = extraRoutes;
    } else {
      delete extraMap[saved.id];
    }
    const resolvedServerId = (route.serverId || 'local').trim() || 'local';
    if (resolvedServerId !== 'local') {
      serverMap[saved.id] = resolvedServerId;
    } else {
      delete serverMap[saved.id];
    }
    await Promise.all([
      this.writeExtraRoutesMap(extraMap),
      this.writeRouteServersMap(serverMap),
    ]);

    return {
      id: saved.id,
      domain: saved.domain,
      projectName: saved.projectName,
      serverId: resolvedServerId,
      frontendTarget: saved.frontendTarget,
      apiPathPrefix: saved.apiPathPrefix,
      backendTarget: saved.backendTarget,
      extraRoutes,
      sslEnabled: saved.sslEnabled,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async deleteRoute(id: string): Promise<boolean> {
    await prisma.domainRoute.deleteMany({ where: { id } });
    const [extraMap, serverMap] = await Promise.all([
      this.readExtraRoutesMap(),
      this.readRouteServersMap(),
    ]);
    if (extraMap[id]) {
      delete extraMap[id];
      await this.writeExtraRoutesMap(extraMap);
    }
    if (serverMap[id]) {
      delete serverMap[id];
      await this.writeRouteServersMap(serverMap);
    }
    return true;
  }
}

export const prismaDomainRouteRepository = new PrismaDomainRouteRepository();
