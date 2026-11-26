export type ServerAuthType = 'key' | 'password' | 'local';

export interface ServerNodeMetrics {
  cpuCores: number;
  cpuUsagePercent: number;
  ramTotalMb: number;
  ramUsedMb: number;
  ramAvailableMb: number;
  ramPercent: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskPercent: number;
  dockerVersion: string;
  composeVersion: string;
  caddyStatus: string;
  osName: string;
  containersRunning: number;
  containersTotal: number;
}

export interface ServerNodePublic {
  id: string;
  name: string;
  description: string;
  isLocal: boolean;
  host: string;
  privateIp: string;
  sshPort: number;
  sshUser: string;
  authType: ServerAuthType;
  hasSecret: boolean;
  projectsRoot: string;
  hasCaddy: boolean;
  status: 'online' | 'offline' | 'unknown';
  lastCheckedAt: string | null;
  lastError?: string;
  metrics?: ServerNodeMetrics;
  createdAt: string;
}

export interface StoredServerNode extends Omit<ServerNodePublic, 'hasSecret'> {
  encryptedSecret?: {
    cipher: string;
    iv: string;
    tag: string;
  };
}

export interface SaveServerNodePayload {
  id?: string;
  name: string;
  description?: string;
  host: string;
  privateIp?: string;
  sshPort?: number;
  sshUser?: string;
  authType?: 'key' | 'password';
  secret?: string;
  projectsRoot?: string;
  hasCaddy?: boolean;
}

export interface RemoteContainerItem {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  internalPort: string;
  composeProject: string;
  composeService: string;
  workingDir: string;
  serverId: string;
  serverName: string;
  serverHost: string;
}

export interface GitCredentialPublic {
  id: string;
  label: string;
  provider: 'github' | 'gitlab' | 'generic';
  username: string;
  hasToken: boolean;
  createdAt: string;
}

export interface StoredGitCredential extends Omit<GitCredentialPublic, 'hasToken'> {
  encryptedToken: {
    cipher: string;
    iv: string;
    tag: string;
  };
}
