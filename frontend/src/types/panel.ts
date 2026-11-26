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
  serviceName?: string;
  image: string;
  state: string;
  status: string;
  role: 'frontend' | 'backend' | 'database' | 'proxy' | 'gateway' | string;
  ports: string[];
  internalPort?: string;
  isGateway?: boolean;
  suggestedPathPrefix?: string;
  cpuPercent: number;
  memoryBytes: number;
}

export interface DatabaseConnectionInfo {
  hasDatabase: boolean;
  engine: string;
  containerName?: string;
  availableDatabases?: string[];
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

export interface MicroserviceServiceItem {
  serviceName: string;
  containerName: string;
  displayName: string;
  domainCode: string;
  category: 'core' | 'microservice' | 'database' | 'frontend' | 'gateway';
  isSelectable: boolean;
  enabled: boolean;
  state: 'running' | 'stopped' | 'not_created';
  port: string;
  description: string;
  subModules: string[];
}

export interface ProjectMicroservicesSummary {
  isMicroservicesArchitecture: boolean;
  architectureType: 'microservices' | 'monolith';
  architectureLabel: string;
  totalMicroservices: number;
  enabledMicroservicesCount: number;
  runningMicroservicesCount: number;
  coreServices: MicroserviceServiceItem[];
  microservices: MicroserviceServiceItem[];
  enabledServiceNames: string[];
}

export interface ProjectLinkedUpstream {
  id: string;
  serviceName: string;
  containerName: string;
  serverId: string;
  serverName: string;
  host: string;
  port: string;
  pathPrefix: string;
  envVarName?: string;
  linkedAt: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  serverId?: string;
  serverName?: string;
  isolatedNetwork?: string;
  linkedUpstreams?: ProjectLinkedUpstream[];
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
  microservices?: ProjectMicroservicesSummary;
}

export interface DomainMicroserviceRoute {
  pathPrefix: string;
  target: string;
  stripPrefix?: boolean;
  serviceName?: string;
  serverId?: string;
}

export interface DomainRouteItem {
  id: string;
  domain: string;
  projectName: string;
  serverId?: string;
  frontendTarget: string;
  apiPathPrefix: string;
  backendTarget: string;
  extraRoutes?: DomainMicroserviceRoute[];
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

export interface ProjectCronjob {
  id: string;
  projectName: string;
  name: string;
  schedule: string;
  targetType: 'container' | 'host';
  containerName: string;
  command: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'idle' | 'running' | 'ok' | 'error';
  lastOutput: string;
  lastDurationMs: number;
  createdAt: string;
}

export interface TerminalExecResult {
  success: boolean;
  output: string;
  cwd: string;
  targetLabel: string;
  durationMs: number;
  exitCode: number;
}

export interface ErdColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  extra: string;
}

export interface ErdTableInfo {
  name: string;
  engine: string;
  rowCount: number;
  columns: ErdColumnInfo[];
}

export interface ErdRelationInfo {
  id: string;
  constraintName: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  deleteRule: string;
  updateRule: string;
  isImplicit?: boolean;
}

export interface ProjectErdSchema {
  projectName: string;
  containerName?: string;
  databaseName: string;
  availableDatabases?: string[];
  engine: string;
  source: 'live_db' | 'prisma_schema' | 'sql_schema';
  tables: ErdTableInfo[];
  relations: ErdRelationInfo[];
  mermaidCode: string;
}

export interface ProcessTopEntry {
  pid: number;
  ppid: number;
  state: string;
  cpuPercent: number;
  memPercent: number;
  rssMb: number;
  elapsed: string;
  command: string;
  args: string;
}

export interface TaskContainerStateItem {
  name: string;
  state: string;
  status: string;
}

export interface TaskLiveTelemetryPayload {
  taskId: string;
  phase: string;
  targetProject: string;
  elapsedMs: number;
  host: {
    cpuCores: number;
    loadAvg1m: number;
    loadAvg5m: number;
    ramTotalMb: number;
    ramUsedMb: number;
    ramAvailableMb: number;
    ramPercent: number;
    safetyFloorMb: number;
  };
  processes: ProcessTopEntry[];
  containers: TaskContainerStateItem[];
  timestamp: string;
}

export interface TaskStreamChunkPayload {
  taskId: string;
  chunk: string;
  isError: boolean;
  phase?: string;
  summaryLine?: string;
  timestamp: string;
}

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
  authType: 'key' | 'password' | 'local';
  hasSecret: boolean;
  projectsRoot: string;
  hasCaddy: boolean;
  status: 'online' | 'offline' | 'unknown';
  lastCheckedAt: string | null;
  lastError?: string;
  metrics?: ServerNodeMetrics;
  createdAt: string;
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

export interface ProjectFileTreeEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  updatedAt: string;
  extension: string;
}

export interface ProjectFileReadResult {
  relativePath: string;
  content: string;
  sizeBytes: number;
  isBinary: boolean;
  hasBackup: boolean;
  updatedAt: string;
}

export interface GitChangedFileItem {
  code: string;
  statusLabel: string;
  path: string;
}

export interface GitCommitHistoryItem {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  dateIso: string;
  relativeDate: string;
  subject: string;
  filesChanged: string[];
}

export interface ProjectGitInspectorOverview {
  isRepo: boolean;
  currentBranch: string;
  remoteUrl: string;
  aheadCount: number;
  behindCount: number;
  isDirty: boolean;
  changedFiles: GitChangedFileItem[];
  commits: GitCommitHistoryItem[];
  branches: string[];
}

export type WorkspaceSubTab =
  | 'containers'
  | 'files'
  | 'git'
  | 'domains'
  | 'database'
  | 'env';

export type PanelTab =
  | 'overview'
  | 'servers'
  | 'projects'
  | 'project-workspace'
  | 'domains'
  | 'guide'
  | 'users'
  | 'permissions'
  | 'audit';



