export interface HostMetrics {
  hostname: string;
  platform: string;
  distro: string;
  uptimeSeconds: number;
  publicIp: string;
  cpu: {
    cores: number;
    brand: string;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
    mount: string;
  };
  timestamp: string;
}
