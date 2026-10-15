export interface AuditLogDto {
  id: number;
  timestamp: string;
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
}
