import { io, type Socket } from 'socket.io-client';
import { hasPerm, panelStore } from './usePanelStore';
import type { HostMetrics, ProjectInfo } from '../types/panel';

let socketInstance: Socket | null = null;

export function connectRealtime(): void {
  disconnectRealtime();
  if (!panelStore.authToken) return;

  socketInstance = io({
    auth: {
      token: panelStore.authToken,
    },
  });

  socketInstance.on(
    'dashboard:update',
    (payload: { host?: HostMetrics; projects?: ProjectInfo[] }) => {
      if (payload.host) {
        panelStore.host = payload.host;
      }
      if (payload.projects && hasPerm('projects', 'view')) {
        panelStore.projects = payload.projects;
      }
    }
  );
}

export function disconnectRealtime(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
