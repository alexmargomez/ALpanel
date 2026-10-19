import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

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

export class HostService {
  private cachedPublicIp: string | null = null;
  private cachedStaticInfo: {
    hostname: string;
    platform: string;
    distro: string;
    cores: number;
    brand: string;
  } | null = null;
  private cachedDisk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
    mount: string;
    fetchedAt: number;
  } | null = null;

  async getPublicIp(): Promise<string> {
    if (process.env.SERVER_PUBLIC_IP) {
      return process.env.SERVER_PUBLIC_IP;
    }
    if (this.cachedPublicIp) {
      return this.cachedPublicIp;
    }
    try {
      const { stdout } = await execAsync(
        "hostname -I | awk '{print $1}' || curl -s --max-time 2 https://ifconfig.me"
      );
      const ip = stdout.trim();
      if (ip) {
        this.cachedPublicIp = ip;
        return ip;
      }
    } catch {}
    return '127.0.0.1';
  }

  private async getStaticHostInfo() {
    if (this.cachedStaticInfo) {
      return this.cachedStaticInfo;
    }
    const [cpuInfo, osInfo] = await Promise.all([si.cpu(), si.osInfo()]);
    this.cachedStaticInfo = {
      hostname: osInfo.hostname || os.hostname(),
      platform: osInfo.platform,
      distro: `${osInfo.distro} ${osInfo.release}`.trim(),
      cores: cpuInfo.cores || os.cpus().length,
      brand: cpuInfo.brand || 'CPU',
    };
    return this.cachedStaticInfo;
  }

  private async getDiskInfo() {
    const now = Date.now();
    if (this.cachedDisk && now - this.cachedDisk.fetchedAt < 15000) {
      return this.cachedDisk;
    }
    const fsSize = await si.fsSize();
    const rootDisk =
      fsSize.find((d) => d.mount === '/' || d.mount === '/host') ||
      fsSize.sort((a, b) => b.size - a.size)[0] || {
        size: 0,
        used: 0,
        available: 0,
        use: 0,
        mount: '/',
      };
    this.cachedDisk = {
      totalBytes: rootDisk.size,
      usedBytes: rootDisk.used,
      freeBytes: rootDisk.available,
      usagePercent: Math.round((rootDisk.use || 0) * 10) / 10,
      mount: rootDisk.mount,
      fetchedAt: now,
    };
    return this.cachedDisk;
  }

  async getHostMetrics(): Promise<HostMetrics> {
    const [cpuLoad, mem, staticInfo, disk, publicIp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      this.getStaticHostInfo(),
      this.getDiskInfo(),
      this.getPublicIp(),
    ]);

    const actualUsedMem = mem.active || mem.used;
    const memPercent = mem.total > 0 ? Math.round((actualUsedMem / mem.total) * 1000) / 10 : 0;

    return {
      hostname: staticInfo.hostname,
      platform: staticInfo.platform,
      distro: staticInfo.distro,
      uptimeSeconds: os.uptime(),
      publicIp,
      cpu: {
        cores: staticInfo.cores,
        brand: staticInfo.brand,
        usagePercent: Math.round((cpuLoad.currentLoad || 0) * 10) / 10,
      },
      memory: {
        totalBytes: mem.total,
        usedBytes: actualUsedMem,
        freeBytes: mem.available || mem.free,
        usagePercent: memPercent,
      },
      disk: {
        totalBytes: disk.totalBytes,
        usedBytes: disk.usedBytes,
        freeBytes: disk.freeBytes,
        usagePercent: disk.usagePercent,
        mount: disk.mount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async pruneDockerCache(): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync('docker system prune -f && docker builder prune -f', {
        timeout: 120000,
      });
      this.cachedDisk = null;
      return {
        success: true,
        output:
          [stdout, stderr].filter(Boolean).join('\n').trim() ||
          'Caché de Docker limpiada correctamente.',
      };
    } catch (error: any) {
      return {
        success: false,
        output: error?.stderr || error?.message || 'Error limpiando caché de Docker',
      };
    }
  }
}

export const hostService = new HostService();
