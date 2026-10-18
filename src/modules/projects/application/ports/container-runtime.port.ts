import Docker from 'dockerode';
import { ContainerStatInfo } from '../../domain/entities/project.entity';

export interface LiveContainerMetrics {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
}

export interface InspectedContainerConfig {
  env: Record<string, string>;
  externalPort: string;
  internalPort: string;
}

export interface ContainerRuntimePort {
  listAllContainers(): Promise<Docker.ContainerInfo[]>;
  getContainerLiveStats(containerId: string, isRunning: boolean): LiveContainerMetrics;
  inspectContainerConfig(containerId: string): Promise<InspectedContainerConfig>;
  detectRole(serviceName: string, image: string): ContainerStatInfo['role'];
  ensureAlpanelContainerNames(): Promise<void>;
  invalidateCache(): void;
}
