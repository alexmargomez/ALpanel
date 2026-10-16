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

  async getPublicIp(): Promise<string> {
    if (process.env.SERVER_PUBLIC_IP) {
      return process.env.SERVER_PUBLIC_IP;
    }
    if (this.cachedPublicIp) {
      return this.cachedPublicIp;
    }
    try {
      const { stdout } = await execAsync(
        "curl -s --max-time 3 https://ifconfig.me || hostname -I | awk '{print $1}'"
      );
      const ip = stdout.trim();
      if (ip) {
        this.cachedPublicIp = ip;
        return ip;
      }
    } catch {}
    return '127.0.0.1';
  }

  async getHostMetrics(): Promise<HostMetrics> {
    const [cpuLoad, cpuInfo, mem, fsSize, osInfo, publicIp] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      this.getPublicIp(),
    ]);

    const rootDisk =
      fsSize.find((d) => d.mount === '/' || d.mount === '/host') ||
      fsSize.sort((a, b) => b.size - a.size)[0] || {
        size: 0,
        used: 0,
        available: 0,
        use: 0,
        mount: '/',
      };

    const actualUsedMem = mem.active || mem.used;
    const memPercent = mem.total > 0 ? Math.round((actualUsedMem / mem.total) * 1000) / 10 : 0;

    return {
      hostname: osInfo.hostname || os.hostname(),
      platform: osInfo.platform,
      distro: `${osInfo.distro} ${osInfo.release}`.trim(),
      uptimeSeconds: os.uptime(),
      publicIp,
      cpu: {
        cores: cpuInfo.cores || os.cpus().length,
        brand: cpuInfo.brand || 'CPU',
        usagePercent: Math.round((cpuLoad.currentLoad || 0) * 10) / 10,
      },
      memory: {
        totalBytes: mem.total,
        usedBytes: actualUsedMem,
        freeBytes: mem.available || mem.free,
        usagePercent: memPercent,
      },
      disk: {
        totalBytes: rootDisk.size,
        usedBytes: rootDisk.used,
        freeBytes: rootDisk.available,
        usagePercent: Math.round((rootDisk.use || 0) * 10) / 10,
        mount: rootDisk.mount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async pruneDockerCache(): Promise<{ success: boolean; output: string }> {
    try {
      const { stdout, stderr } = await execAsync('docker system prune -f && docker builder prune -f', {
        timeout: 120000,
      });
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
