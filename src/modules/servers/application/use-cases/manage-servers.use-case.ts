import fs from 'fs';
import path from 'path';
import { prisma } from '../../../../shared/infrastructure/database/prisma.service';
import { hostService } from '../../../../shared/infrastructure/services/host-metrics.service';
import {
  GitCredentialPublic,
  RemoteContainerItem,
  SaveServerNodePayload,
  ServerNodePublic,
  StoredGitCredential,
  StoredServerNode,
} from '../../domain/entities/server-node.entity';
import { remoteExecutorService } from '../../infrastructure/services/remote-executor.service';

const SERVERS_SETTING_KEY = 'connected_servers_v1';
const GIT_CREDS_SETTING_KEY = 'git_credentials_v1';

export class ManageServersUseCase {
  private readonly serversMirrorFile: string;
  private readonly gitCredsMirrorFile: string;

  constructor() {
    const dataDir = process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.serversMirrorFile = path.join(dataDir, 'servers.json');
    this.gitCredsMirrorFile = path.join(dataDir, 'git-credentials.json');
  }

  async buildLocalNode(): Promise<StoredServerNode> {
    const publicIp = await hostService.getPublicIp().catch(() => '127.0.0.1');
    const hostMetrics = await hostService.getHostMetrics().catch(() => null);
    return {
      id: 'local',
      name: 'Nodo Central (Local)',
      description: 'Servidor principal donde se ejecuta ALpanel y el Proxy SSL Central',
      isLocal: true,
      host: publicIp || '127.0.0.1',
      privateIp: '127.0.0.1',
      sshPort: 22,
      sshUser: 'root',
      authType: 'local',
      projectsRoot: process.env.PROJECTS_ROOT || '/opt/projects',
      hasCaddy: true,
      status: 'online',
      lastCheckedAt: new Date().toISOString(),
      metrics: hostMetrics
        ? {
            cpuCores: hostMetrics.cpu.cores,
            cpuUsagePercent: hostMetrics.cpu.usagePercent,
            ramTotalMb: Math.round(hostMetrics.memory.totalBytes / (1024 * 1024)),
            ramUsedMb: Math.round(hostMetrics.memory.usedBytes / (1024 * 1024)),
            ramAvailableMb: Math.max(
              0,
              Math.round(
                (hostMetrics.memory.totalBytes - hostMetrics.memory.usedBytes) /
                  (1024 * 1024)
              )
            ),
            ramPercent: hostMetrics.memory.usagePercent,
            diskTotalGb: Math.round(hostMetrics.disk.totalBytes / (1024 * 1024 * 1024)),
            diskUsedGb: Math.round(hostMetrics.disk.usedBytes / (1024 * 1024 * 1024)),
            diskPercent: hostMetrics.disk.usagePercent,
            dockerVersion: 'Docker Local',
            composeVersion: 'v2',
            caddyStatus: 'alpanel_caddy',
            osName: hostMetrics.distro || 'Linux',
            containersRunning: 0,
            containersTotal: 0,
          }
        : undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  private async readRemoteNodes(): Promise<StoredServerNode[]> {
    try {
      const row = await prisma.panelSetting.findUnique({
        where: { settingKey: SERVERS_SETTING_KEY },
      });
      if (row?.settingValue) {
        const parsed = JSON.parse(row.settingValue);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to mirror
    }
    try {
      if (fs.existsSync(this.serversMirrorFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.serversMirrorFile, 'utf-8'));
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  }

  private async writeRemoteNodes(nodes: StoredServerNode[]): Promise<void> {
    const serialized = JSON.stringify(nodes, null, 2);
    try {
      fs.writeFileSync(this.serversMirrorFile, serialized, {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // ignore
    }
    try {
      await prisma.panelSetting.upsert({
        where: { settingKey: SERVERS_SETTING_KEY },
        update: { settingValue: serialized },
        create: { settingKey: SERVERS_SETTING_KEY, settingValue: serialized },
      });
    } catch {
      // ignore if DB unavailable in unit test
    }
  }

  private toPublicNode(node: StoredServerNode): ServerNodePublic {
    const { encryptedSecret, ...rest } = node;
    return {
      ...rest,
      hasSecret: Boolean(node.isLocal || encryptedSecret?.cipher),
    };
  }

  async listServers(): Promise<ServerNodePublic[]> {
    const [localNode, remoteNodes] = await Promise.all([
      this.buildLocalNode(),
      this.readRemoteNodes(),
    ]);
    return [localNode, ...remoteNodes].map((n) => this.toPublicNode(n));
  }

  async getStoredServerById(serverId?: string): Promise<StoredServerNode> {
    const cleanId = (serverId || 'local').trim();
    if (!cleanId || cleanId === 'local') {
      return this.buildLocalNode();
    }
    const remotes = await this.readRemoteNodes();
    const found = remotes.find((r) => r.id === cleanId);
    if (!found) {
      throw new Error(`Servidor "${cleanId}" no encontrado.`);
    }
    return found;
  }

  async saveServer(payload: SaveServerNodePayload): Promise<ServerNodePublic> {
    const name = (payload.name || '').trim();
    const host = (payload.host || '').trim();
    if (!name || !host) {
      throw new Error('El nombre del servidor y la IP/Host son obligatorios.');
    }

    const remotes = await this.readRemoteNodes();
    const existingIdx = payload.id
      ? remotes.findIndex((r) => r.id === payload.id)
      : -1;
    const existing = existingIdx >= 0 ? remotes[existingIdx] : undefined;

    const id =
      existing?.id ||
      `srv-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;

    const encryptedSecret = payload.secret?.trim()
      ? remoteExecutorService.encryptSecret(payload.secret.trim())
      : existing?.encryptedSecret;

    const nextNode: StoredServerNode = {
      id,
      name,
      description: (payload.description || '').trim(),
      isLocal: false,
      host,
      privateIp: (payload.privateIp || '').trim(),
      sshPort: Number(payload.sshPort) || 22,
      sshUser: (payload.sshUser || 'root').trim(),
      authType: payload.authType === 'password' ? 'password' : 'key',
      encryptedSecret,
      projectsRoot: (payload.projectsRoot || '/opt/projects').trim(),
      hasCaddy: payload.hasCaddy !== false,
      status: existing?.status || 'unknown',
      lastCheckedAt: existing?.lastCheckedAt || null,
      metrics: existing?.metrics,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      remotes[existingIdx] = nextNode;
    } else {
      remotes.push(nextNode);
    }

    await this.writeRemoteNodes(remotes);
    return this.toPublicNode(nextNode);
  }

  async deleteServer(serverId: string): Promise<boolean> {
    if (serverId === 'local') {
      throw new Error('El Nodo Central (Local) no puede eliminarse.');
    }
    const remotes = await this.readRemoteNodes();
    const filtered = remotes.filter((r) => r.id !== serverId);
    await this.writeRemoteNodes(filtered);
    return filtered.length < remotes.length;
  }

  async testServerConnection(serverId: string): Promise<ServerNodePublic> {
    const server = await this.getStoredServerById(serverId);
    const probe = await remoteExecutorService.probeServer(server);
    const nowIso = new Date().toISOString();

    if (server.isLocal) {
      return this.toPublicNode({
        ...server,
        status: probe.online ? 'online' : 'offline',
        lastCheckedAt: nowIso,
        lastError: probe.error,
        metrics: probe.metrics || server.metrics,
      });
    }

    const remotes = await this.readRemoteNodes();
    const idx = remotes.findIndex((r) => r.id === server.id);
    if (idx >= 0) {
      remotes[idx] = {
        ...remotes[idx],
        status: probe.online ? 'online' : 'offline',
        lastCheckedAt: nowIso,
        lastError: probe.error,
        metrics: probe.metrics || remotes[idx].metrics,
      };
      await this.writeRemoteNodes(remotes);
      return this.toPublicNode(remotes[idx]);
    }
    return this.toPublicNode(server);
  }

  async listContainersOnServer(serverId: string): Promise<RemoteContainerItem[]> {
    const server = await this.getStoredServerById(serverId);
    return remoteExecutorService.listContainersOnServer(server);
  }

  async provisionServer(serverId: string): Promise<{ success: boolean; output: string }> {
    const server = await this.getStoredServerById(serverId);
    return remoteExecutorService.provisionServerNode(server);
  }

  // --- Bóveda de Credenciales Git (GitHub / GitLab Private Repos) ---
  private async readGitCredentials(): Promise<StoredGitCredential[]> {
    try {
      const row = await prisma.panelSetting.findUnique({
        where: { settingKey: GIT_CREDS_SETTING_KEY },
      });
      if (row?.settingValue) {
        const parsed = JSON.parse(row.settingValue);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // fallback
    }
    try {
      if (fs.existsSync(this.gitCredsMirrorFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.gitCredsMirrorFile, 'utf-8'));
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  }

  private async writeGitCredentials(list: StoredGitCredential[]): Promise<void> {
    const serialized = JSON.stringify(list, null, 2);
    try {
      fs.writeFileSync(this.gitCredsMirrorFile, serialized, {
        encoding: 'utf-8',
        mode: 0o600,
      });
    } catch {
      // ignore
    }
    try {
      await prisma.panelSetting.upsert({
        where: { settingKey: GIT_CREDS_SETTING_KEY },
        update: { settingValue: serialized },
        create: { settingKey: GIT_CREDS_SETTING_KEY, settingValue: serialized },
      });
    } catch {
      // ignore
    }
  }

  async listGitCredentials(): Promise<GitCredentialPublic[]> {
    const list = await this.readGitCredentials();
    return list.map(({ encryptedToken, ...rest }) => ({
      ...rest,
      hasToken: Boolean(encryptedToken?.cipher),
    }));
  }

  async saveGitCredential(payload: {
    id?: string;
    label: string;
    provider: 'github' | 'gitlab' | 'generic';
    username: string;
    token: string;
  }): Promise<GitCredentialPublic> {
    if (!payload.label?.trim() || !payload.token?.trim()) {
      throw new Error('Etiqueta y Token PAT son obligatorios.');
    }
    const list = await this.readGitCredentials();
    const id = payload.id || `gitcred-${Date.now().toString(36)}`;
    const entry: StoredGitCredential = {
      id,
      label: payload.label.trim(),
      provider: payload.provider || 'github',
      username: (payload.username || 'oauth2').trim(),
      encryptedToken: remoteExecutorService.encryptSecret(payload.token.trim()),
      createdAt: new Date().toISOString(),
    };
    const idx = list.findIndex((i) => i.id === id);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    await this.writeGitCredentials(list);
    return {
      id: entry.id,
      label: entry.label,
      provider: entry.provider,
      username: entry.username,
      hasToken: true,
      createdAt: entry.createdAt,
    };
  }

  async deleteGitCredential(id: string): Promise<boolean> {
    const list = await this.readGitCredentials();
    const filtered = list.filter((i) => i.id !== id);
    await this.writeGitCredentials(filtered);
    return filtered.length < list.length;
  }

  async injectGitAuthInUrl(repoUrl: string, credentialId?: string): Promise<string> {
    if (!credentialId || !repoUrl.startsWith('https://')) return repoUrl;
    const list = await this.readGitCredentials();
    const found = list.find((i) => i.id === credentialId);
    if (!found) return repoUrl;
    const token = remoteExecutorService.decryptSecret(found.encryptedToken);
    if (!token) return repoUrl;
    const user = encodeURIComponent(found.username || 'oauth2');
    const pass = encodeURIComponent(token);
    return repoUrl.replace(/^https:\/\//i, `https://${user}:${pass}@`);
  }
}

export const manageServersUseCase = new ManageServersUseCase();
