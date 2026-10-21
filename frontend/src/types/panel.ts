export interface HostMetrics {
  hostname: string;
  platform: string;
  distro: string;
  publicIp: string;
  uptimeSeconds: number;
  cpu: {
    cores: number;
    usagePercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    usagePercent: number;
  };
}

export interface ContainerStatInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  role: 'frontend' | 'backend' | 'database' | 'proxy' | string;
  ports: string[];
  cpuPercent: number;
  memoryBytes: number;
}

export interface DatabaseConnectionInfo {
  hasDatabase: boolean;
  engine: string;
  host: string;
  port: string;
  internalHost: string;
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
  status: 'running' | 'partial' | 'stopped' | string;
  stack: string[];
  domains: string[];
  git: {
    isRepo: boolean;
    branch: string;
    commitHash: string;
    behindCount: number;
  };
  resources: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  containers: ContainerStatInfo[];
  database: DatabaseConnectionInfo;
}

export interface DomainRouteItem {
  id: string;
  domain: string;
  projectName: string;
  frontendTarget: string;
  apiPathPrefix: string;
  backendTarget: string;
  sslEnabled: boolean;
  createdAt?: string;
}

export interface RolePermissionEntry {
  moduleCode: string;
  moduleName?: string;
  moduleIcon?: string;
  canView: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canDeploy?: boolean;
}

export interface RoleItem {
  id: number;
  code: string;
  name: string;
  description: string;
  isSystem?: boolean;
  permissions: RolePermissionEntry[];
}

export interface UserItem {
  id: number;
  username: string;
  fullName: string;
  roleId: number;
  role: string;
  roleName: string;
  lastLogin: string | null;
  permissions?: Record<string, { canView: boolean }>;
}

export interface DiscoveredServiceItem {
  code: string;
  name: string;
  icon: string;
  serviceFile: string;
}

export interface DiscoveredModuleItem {
  code: string;
  name: string;
  description: string;
  icon: string;
  services: DiscoveredServiceItem[];
}

export interface DiscoveredCatalog {
  modules: DiscoveredModuleItem[];
  standaloneServices: DiscoveredServiceItem[];
  ignoreConfig: {
    ignoredModules: string[];
    ignoredServices: string[];
  };
}

export interface AppUserRecord {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  knownPassword?: string;
}

export interface ProjectUsersDiscoveryResult {
  supported: boolean;
  engine: 'postgres' | 'mysql' | 'mariadb' | 'none';
  containerName: string;
  databaseName: string;
  tableName: 'users' | 'auth_user' | 'sf_guard_user' | string;
  hashAlgorithm: 'bcrypt' | 'pbkdf2_sha256' | 'sha1' | 'none';
  hasEmail: boolean;
  hasRole: boolean;
  message?: string;
  users: AppUserRecord[];
}

export interface AuditLogItem {
  id?: number;
  action: string;
  target: string;
  status: 'ok' | 'error' | string;
  ip: string;
  timestamp: string;
}

export interface RateLimitShieldConfig {
  enabled: boolean;
  baseCapacity: number;
  refillRatePerSec: number;
  cpuWarningThreshold: number;
  cpuCriticalThreshold: number;
  blockDurationSec: number;
  strikeThreshold: number;
}

export interface BlockedIpInfo {
  ip: string;
  blockedAt: string;
  expiresAt: string;
  remainingSec: number;
  reason: string;
  blockedHits: number;
}

export interface RateLimitShieldStatus {
  config: RateLimitShieldConfig;
  currentCpuPercent: number;
  currentMemoryPercent: number;
  dynamicScaleFactor: number;
  effectiveCapacity: number;
  effectiveRefillPerSec: number;
  protectionMode: 'NORMAL' | 'THROTTLING_CPU_HIGH' | 'CRITICAL_DDOS_SHIELD';
  activeIpBuckets: number;
  blockedIps: BlockedIpInfo[];
  metrics: {
    totalEvaluated: number;
    totalAllowed: number;
    totalThrottled: number;
    totalBlockedHits: number;
    lastDecisionLatencyMs: number;
    avgDecisionLatencyMs: number;
  };
}

export interface BatchIngestEngineStatus {
  bufferSize: number;
  maxBufferCapacity: number;
  batchFlushThreshold: number;
  flushIntervalMs: number;
  backpressureState: 'HEALTHY' | 'ELEVATED' | 'BACKPRESSURE_429';
  totalEventsIngested: number;
  totalSqlBatchesFlushed: number;
  totalSqlOperationsSaved: number;
  lastFlushCount: number;
  lastFlushDurationMs: number;
  lastFlushAt: string | null;
  avgIngestMemoryLatencyMs: number;
}

export interface DdosSimulationResult {
  simulatedIp: string;
  totalRequests: number;
  simulatedCpuPercent: number;
  dynamicScaleFactor: number;
  effectiveCapacity: number;
  allowedCount: number;
  throttledCount: number;
  blockedMemoryCount: number;
  ipWasBlocked: boolean;
  totalDurationMs: number;
  avgLatencyPerDecisionMs: number;
}

export interface BatchIngestSimulationResult {
  accepted: boolean;
  statusCode: 200 | 429;
  ingestedCount: number;
  bufferSizeAfter: number;
  flushedToDbCount: number;
  sqlBatchesExecuted: number;
  sqlWritesSaved: number;
  memoryEnqueueDurationMs: number;
  dbFlushDurationMs: number;
  throughputEventsPerSec: number;
  backpressureState: 'HEALTHY' | 'ELEVATED' | 'BACKPRESSURE_429';
  message: string;
}

export type PanelTab = 'projects' | 'domains' | 'guide' | 'users' | 'permissions' | 'audit';

