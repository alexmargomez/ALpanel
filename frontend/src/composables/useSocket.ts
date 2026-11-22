import { io, type Socket } from 'socket.io-client';
import {
  appendTaskStreamChunk,
  hasPerm,
  panelStore,
  updateTaskLiveTelemetry,
} from './usePanelStore';
import type {
  HostMetrics,
  ProjectInfo,
  TaskLiveTelemetryPayload,
  TaskStreamChunkPayload,
} from '../types/panel';

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
      if (
        payload.projects &&
        (!panelStore.currentUser || hasPerm('projects', 'view'))
      ) {
        panelStore.projects = payload.projects;
        panelStore.loadingProjects = false;
      }
    }
  );

  socketInstance.on('task:stream', (payload: TaskStreamChunkPayload) => {
    appendTaskStreamChunk(payload);
  });

  socketInstance.on('task:telemetry', (payload: TaskLiveTelemetryPayload) => {
    updateTaskLiveTelemetry(payload);
  });
}

export function disconnectRealtime(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
