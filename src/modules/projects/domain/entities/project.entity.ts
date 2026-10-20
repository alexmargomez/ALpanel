export interface ContainerStatInfo {
  id: string;
  name: string;
  serviceName: string;
  image: string;
  state: string;
  status: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  ports: string[];
  role: 'frontend' | 'backend' | 'database' | 'proxy' | 'other';
}

export interface DatabaseConnectionInfo {
  hasDatabase: boolean;
  engine: string;
  containerName: string;
  status: string;
  host: string;
  internalHost: string;
  port: string;
  internalPort: string;
  database: string;
  username: string;
  password: string;
  rootUsername: string;
  rootPassword: string;
  connectionUrl: string;
  cliCommand: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  stack: string[];
  status: 'running' | 'partial' | 'stopped';
  domains: string[];
  git: {
    isRepo: boolean;
    branch: string;
    commitHash: string;
    commitMessage: string;
    remoteUrl: string;
    behindCount: number;
  };
  resources: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  containers: ContainerStatInfo[];
  hasEnvFile: boolean;
  hasComposeFile: boolean;
  database: DatabaseConnectionInfo;
}

export type ProjectEntity = ProjectInfo;
