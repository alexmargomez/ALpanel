import fs from 'fs';
import path from 'path';
import { prisma } from '../../../../shared/infrastructure/database/prisma.service';
import { DomainRouteRepositoryPort } from '../../application/ports/repositories/domain-route-repository.port';
import { DomainRouteEntity } from '../../domain/entities/domain-route.entity';

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

  async listRoutes(): Promise<DomainRouteEntity[]> {
    try {
      const rows = await prisma.domainRoute.findMany({
        orderBy: { createdAt: 'asc' },
      });
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
          frontendTarget,
          apiPathPrefix: r.apiPathPrefix || '',
          backendTarget,
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
    return true;
  }
}

export const prismaDomainRouteRepository = new PrismaDomainRouteRepository();
