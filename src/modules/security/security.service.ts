import { prisma } from '../../config/prisma';
import { AuditLogDto } from './security.model';

export class SecurityService {
  private memoryFallback: AuditLogDto[] = [];

  async recordAudit(
    action: string,
    target: string,
    ip: string,
    status: 'ok' | 'error' = 'ok'
  ): Promise<void> {
    const cleanIp = ip || 'unknown';
    this.memoryFallback.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action,
      target,
      ip: cleanIp,
      status,
    });
    if (this.memoryFallback.length > 200) {
      this.memoryFallback.pop();
    }

    try {
      await prisma.auditLog.create({
        data: {
          action: action.slice(0, 100),
          target: target.slice(0, 255),
          ip: cleanIp.slice(0, 100),
          status,
        },
      });
    } catch {
      // Fallback silencioso a memoria si la BD está reiniciando
    }
  }

  async getAuditLogs(limit = 150): Promise<AuditLogDto[]> {
    try {
      const rows = await prisma.auditLog.findMany({
        orderBy: { id: 'desc' },
        take: limit,
      });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          timestamp: r.createdAt.toISOString(),
          action: r.action,
          target: r.target,
          ip: r.ip,
          status: (r.status === 'error' ? 'error' : 'ok') as 'ok' | 'error',
        }));
      }
    } catch {
      // Fallback
    }
    return this.memoryFallback.slice(0, limit);
  }
}

export const securityService = new SecurityService();
