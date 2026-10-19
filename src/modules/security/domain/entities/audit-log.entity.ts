export interface AuditLogEntity {
  id: number;
  timestamp: string;
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
}

export type AuditLogDto = AuditLogEntity;
