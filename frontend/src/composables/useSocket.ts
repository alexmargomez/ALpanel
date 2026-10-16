import { io, type Socket } from 'socket.io-client';
import { hasPerm, panelStore } from './usePanelStore';
import type { HostMetrics, ProjectInfo } from '../types/panel';

let socketInstance: Socket | null = null;

export function connectRealtime(): void {
  disconnectRealtime();
  if (!panelStore.authToken) return;

  socketInstance = io({
    transports: ['websocket', 'polling'],
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
      if (payload.projects && (!panelStore.currentUser || hasPerm('projects', 'view'))) {
        panelStore.projects = payload.projects;
        panelStore.loadingProjects = false;
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
