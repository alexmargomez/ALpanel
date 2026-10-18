import Docker from 'dockerode';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ContainerRuntimePort,
  InspectedContainerConfig,
  LiveContainerMetrics,
} from '../../application/ports/container-runtime.port';
import { ContainerStatInfo } from '../../domain/entities/project.entity';

const execAsync = promisify(exec);

export class DockerodeRuntimeAdapter implements ContainerRuntimePort {
  private docker: Docker;
  private liveStatsCache = new Map<string, LiveContainerMetrics>();
  private isRefreshingStats = false;
  private dbInspectCache = new Map<
    string,
    InspectedContainerConfig & { expiresAt: number }
  >();

  constructor() {
    this.docker = new Docker({
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    });

    setTimeout(() => {
      this.triggerBackgroundStatsRefresh();
    }, 200).unref();
    setInterval(() => {
      this.triggerBackgroundStatsRefresh();
    }, 2000).unref();
  }

  invalidateCache(): void {
    this.dbInspectCache.clear();
  }

  async listAllContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({ all: true });
  }

  detectRole(serviceName: string, image: string): ContainerStatInfo['role'] {
    const s = `${serviceName} ${image}`.toLowerCase();
    if (
      s.includes('mysql') ||
      s.includes('mariadb') ||
      s.includes('postgres') ||
      s.includes('mongo') ||
      s.includes('redis') ||
      serviceName === 'db'
    ) {
      return 'database';
    }
    if (s.includes('caddy') || s.includes('nginx-proxy') || s.includes('traefik')) {
      return 'proxy';
    }
    if (
      s.includes('front') ||
      s.includes('react') ||
      s.includes('vue') ||
      s.includes('next') ||
      s.includes('vite') ||
      s.includes('angular')
    ) {
      return 'frontend';
    }
    return 'backend';
  }

  private async fetchContainerLiveStatsFromDocker(
    containerId: string
  ): Promise<LiveContainerMetrics> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats: any = await container.stats({ stream: false });

      const cpuDelta =
        (stats?.cpu_stats?.cpu_usage?.total_usage || 0) -
        (stats?.precpu_stats?.cpu_usage?.total_usage || 0);
      const systemDelta =
        (stats?.cpu_stats?.system_cpu_usage || 0) -
        (stats?.precpu_stats?.system_cpu_usage || 0);
      const onlineCpus =
        stats?.cpu_stats?.online_cpus ||
        stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ||
        1;

      let cpuPercent = 0;
      if (systemDelta > 0 && cpuDelta > 0) {
        cpuPercent =
          Math.round(((cpuDelta / systemDelta) * onlineCpus * 100) * 10) / 10;
      }

      const memUsage = stats?.memory_stats?.usage || 0;
      const memCache =
        stats?.memory_stats?.stats?.inactive_file ||
        stats?.memory_stats?.stats?.cache ||
        0;
      const actualMem = Math.max(0, memUsage - memCache);
      const memLimit = stats?.memory_stats?.limit || 0;
      const memPercent =
        memLimit > 0 ? Math.round(((actualMem / memLimit) * 100) * 10) / 10 : 0;

      return {
        cpuPercent,
        memoryBytes: actualMem,
        memoryLimitBytes: memLimit,
        memoryPercent: memPercent,
      };
    } catch {
      return {
        cpuPercent: 0,
        memoryBytes: 0,
        memoryLimitBytes: 0,
        memoryPercent: 0,
      };
    }
  }

  private triggerBackgroundStatsRefresh(): void {
    if (this.isRefreshingStats) return;
    this.isRefreshingStats = true;
    this.docker
      .listContainers({ all: false })
      .then(async (runningContainers) => {
        const runningIds = new Set<string>();
        await Promise.all(
          runningContainers.map(async (c) => {
            runningIds.add(c.Id);
            const stats = await this.fetchContainerLiveStatsFromDocker(c.Id);
            this.liveStatsCache.set(c.Id, stats);
          })
        );
        for (const id of this.liveStatsCache.keys()) {
          if (!runningIds.has(id)) {
            this.liveStatsCache.delete(id);
          }
        }
      })
      .catch(() => null)
      .finally(() => {
        this.isRefreshingStats = false;
      });
  }

  getContainerLiveStats(
    containerId: string,
    isRunning: boolean
  ): LiveContainerMetrics {
    if (!isRunning) {
      return {
        cpuPercent: 0,
        memoryBytes: 0,
        memoryLimitBytes: 0,
        memoryPercent: 0,
      };
    }
    const cached = this.liveStatsCache.get(containerId);
    if (cached) {
      return cached;
    }
    this.triggerBackgroundStatsRefresh();
    return {
      cpuPercent: 0,
      memoryBytes: 0,
      memoryLimitBytes: 0,
      memoryPercent: 0,
    };
  }

  async inspectContainerConfig(
    containerId: string
  ): Promise<InspectedContainerConfig> {
    const now = Date.now();
    const cached = this.dbInspectCache.get(containerId);
    if (cached && cached.expiresAt > now) {
      return {
        env: cached.env,
        externalPort: cached.externalPort,
        internalPort: cached.internalPort,
      };
    }

    const env: Record<string, string> = {};
    let externalPort = '';
    let internalPort = '3306';

    try {
      const inspectData = await this.docker.getContainer(containerId).inspect();
      for (const e of inspectData.Config?.Env || []) {
        const idx = e.indexOf('=');
        if (idx > 0) {
          env[e.slice(0, idx)] = e.slice(idx + 1);
        }
      }
      const ports = inspectData.NetworkSettings?.Ports || {};
      for (const [internalKey, bindings] of Object.entries(ports)) {
        const intP = internalKey.split('/')[0];
        if (
          Array.isArray(bindings) &&
          bindings.length > 0 &&
          bindings[0].HostPort
        ) {
          externalPort = bindings[0].HostPort;
          if (intP) internalPort = intP;
        }
      }
      this.dbInspectCache.set(containerId, {
        env,
        externalPort,
        internalPort,
        expiresAt: now + 30_000,
      });
    } catch {
      // Fallback
    }

    return { env, externalPort, internalPort };
  }

  async ensureAlpanelContainerNames(): Promise<void> {
    const renames: Array<[string, string]> = [
      ['sm_panel_db', 'alpanel_db'],
      ['sm_panel_caddy', 'alpanel_caddy'],
      ['sm_server_panel', 'alpanel_server'],
    ];
    for (const [oldName, newName] of renames) {
      try {
        await execAsync(`docker rename ${oldName} ${newName} 2>/dev/null || true`);
      } catch {
        // Ignorar si ya tiene el nombre nuevo
      }
    }
  }
}

export const dockerodeRuntimeAdapter = new DockerodeRuntimeAdapter();
