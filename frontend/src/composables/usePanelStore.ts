import { reactive } from 'vue';
import type {
  AuditLogItem,
  BatchIngestEngineStatus,
  DiscoveredCatalog,
  DomainRouteItem,
  HostMetrics,
  PanelTab,
  ProjectInfo,
  RateLimitShieldStatus,
  RoleItem,
  RolePermissionEntry,
  UserItem,
} from '../types/panel';
import { DEFAULT_CATALOG } from '../services/api';

interface ConsoleModalState {
  open: boolean;
  title: string;
  output: string;
  projectName: string;
  selectedContainer: string;
  showContainerSelect: boolean;
  taskId: string;
}

export interface BackgroundTaskItem {
  id: string;
  title: string;
  projectName: string;
  action: string;
  status: 'running' | 'success' | 'error';
  message: string;
  output: string;
  startedAt: number;
  finishedAt?: number;
}

interface EnvModalState {
  open: boolean;
  projectName: string;
  content: string;
}

interface DbModalState {
  open: boolean;
  projectName: string;
}

interface CloneModalState {
  open: boolean;
}

interface UserModalState {
  open: boolean;
  userId: number | null;
}

interface RoleModalState {
  open: boolean;
  roleId: number | null;
}

interface AppUsersModalState {
  open: boolean;
  projectName: string;
}

interface CronjobsModalState {
  open: boolean;
  projectName: string;
}

interface TerminalModalState {
  open: boolean;
  projectName: string;
  containerName: string;
  mode: 'shell' | 'sql';
  databaseName: string;
}

interface ErdModalState {
  open: boolean;
  projectName: string;
  containerName: string;
  databaseName: string;
}

interface MicroservicesModalState {
  open: boolean;
  projectName: string;
}

function loadCachedUser(): UserItem | null {
  try {
    const token = localStorage.getItem('alpanel_token') || localStorage.getItem('sm_panel_token');
    if (!token) return null;
    const raw = localStorage.getItem('alpanel_cached_user');
    return raw ? (JSON.parse(raw) as UserItem) : null;
  } catch {
    return null;
  }
}

export const panelStore = reactive({
  theme: (localStorage.getItem('alpanel_theme') === 'light' ? 'light' : 'dark') as 'dark' | 'light',
  authToken: localStorage.getItem('alpanel_token') || localStorage.getItem('sm_panel_token') || '',
  currentUser: loadCachedUser() as UserItem | null,
  activeTab: 'projects' as PanelTab,
  projectsRoot: '/opt/projects',
  loadingProjects: true,
  host: {
    hostname: 'vps',
    platform: 'linux',
    distro: 'Linux VPS',
    publicIp: '...',
    uptimeSeconds: 0,
    cpu: { cores: 1, usagePercent: 0 },
    memory: { totalBytes: 0, usedBytes: 0, usagePercent: 0 },
    disk: { totalBytes: 0, usedBytes: 0, usagePercent: 0 },
  } as HostMetrics,
  projects: [] as ProjectInfo[],
  projectSearchQuery: '',
  domainRoutes: [] as DomainRouteItem[],
  caddyfilePreview: '',
  domainFormPrefill: {
    domain: '',
    projectName: '',
    frontendTarget: '',
    backendTarget: '',
  },
  users: [] as UserItem[],
  roles: [] as RoleItem[],
  discoveredCatalog: null as DiscoveredCatalog | null,
  expandedUserRoleIds: [] as number[],
  expandedPermRoleIds: [] as number[],
  highlightedPermRoleId: null as number | null,
  auditLogs: [] as AuditLogItem[],
  securityShield: null as RateLimitShieldStatus | null,
  securityIngest: null as BatchIngestEngineStatus | null,
  toast: {
    visible: false,
    message: 'Listo',
    isError: false,
  },
  backgroundTasks: [] as BackgroundTaskItem[],
  modals: {
    db: { open: false, projectName: '' } as DbModalState,
    console: {
      open: false,
      title: 'Consola del Servidor',
      output: '',
      projectName: '',
      selectedContainer: '',
      showContainerSelect: false,
      taskId: '',
    } as ConsoleModalState,
    env: { open: false, projectName: '', content: '' } as EnvModalState,
    clone: { open: false } as CloneModalState,
    user: { open: false, userId: null } as UserModalState,
    role: { open: false, roleId: null } as RoleModalState,
    appUsers: { open: false, projectName: '' } as AppUsersModalState,
    cronjobs: { open: false, projectName: '' } as CronjobsModalState,
    terminal: { open: false, projectName: '', containerName: '', mode: 'shell', databaseName: '' } as TerminalModalState,
    erd: { open: false, projectName: '', containerName: '', databaseName: '' } as ErdModalState,
    microservices: { open: false, projectName: '' } as MicroservicesModalState,
  },
});

export function applyTheme(theme: 'dark' | 'light' = panelStore.theme): void {
  panelStore.theme = theme;
  try {
    localStorage.setItem('alpanel_theme', theme);
  } catch {
    // Ignore storage quota errors
  }
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.add('light-mode');
    root.classList.remove('dark');
  } else {
    root.classList.remove('light-mode');
    root.classList.add('dark');
  }
}

export function toggleTheme(): void {
  const next = panelStore.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, isError = false): void {
  panelStore.toast.message = msg;
  panelStore.toast.isError = isError;
  panelStore.toast.visible = true;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    panelStore.toast.visible = false;
  }, 3200);
}

export function copyText(text: string, msg = 'Copiado al portapapeles'): void {
  navigator.clipboard.writeText(text);
  showToast(msg);
}

export function resolveFrontendServiceCode(
  moduleCode: string,
  actionOrService = 'view'
): string | null {
  if (!actionOrService || actionOrService === 'view') return null;
  if (actionOrService.includes('.')) return actionOrService;
  if (moduleCode === 'domains') return 'domains.manage';
  if (moduleCode === 'users') return 'users.manage';
  if (moduleCode === 'git' && actionOrService === 'create') return 'git.clone';
  if (moduleCode === 'git' && actionOrService === 'deploy') return 'projects.git_pull';
  if (moduleCode === 'security' && actionOrService === 'deploy') return 'services.docker_prune';
  if (moduleCode === 'projects' && actionOrService === 'edit') return 'projects.logs';
  if (moduleCode === 'projects' && actionOrService === 'deploy') return 'projects.restart_cache';
  if (moduleCode === 'projects' && actionOrService === 'delete') return 'projects.stop_rebuild';
  if (moduleCode === 'project_db' && actionOrService === 'view') return 'projects.db_view';
  if (moduleCode === 'project_db' && actionOrService === 'deploy') return 'projects.db_backup';
  if (moduleCode === 'project_env' && actionOrService === 'view') return 'projects.env_view';
  if (moduleCode === 'project_env' && actionOrService === 'edit') return 'projects.env_edit';
  return `${moduleCode}.${actionOrService}`;
}

export function hasPerm(moduleCode: string, actionOrService = 'view'): boolean {
  const user = panelStore.currentUser;
  if (!user) return false;
  if (user.role === 'superadmin' || user.username === 'superadmin') {
    return true;
  }
  const perms = user.permissions || {};

  if (moduleCode.startsWith('services.')) {
    return Boolean(perms[moduleCode]?.canView);
  }

  const serviceCode = resolveFrontendServiceCode(moduleCode, actionOrService);
  if (serviceCode && serviceCode.startsWith('services.')) {
    return Boolean(perms[serviceCode]?.canView);
  }

  const parentModuleCode = serviceCode ? serviceCode.split('.')[0] : moduleCode.split('.')[0];
  const parentMod = perms[parentModuleCode];
  if (!parentMod || !parentMod.canView) {
    return false;
  }

  if (!serviceCode) {
    // Si moduleCode ya es un sub-servicio con punto (ej. projects.app_users) y actionOrService === 'view'
    if (moduleCode.includes('.')) {
      const hasAnySub = Object.keys(perms).some((k) => k.startsWith(`${parentModuleCode}.`));
      if (!hasAnySub) return true;
      return Boolean(perms[moduleCode]?.canView);
    }
    return true;
  }

  const hasAnySubServicesInMap = Object.keys(perms).some((k) =>
    k.startsWith(`${parentModuleCode}.`)
  );
  if (!hasAnySubServicesInMap) {
    return true;
  }

  return Boolean(perms[serviceCode]?.canView);
}

export function getCatalog(): DiscoveredCatalog {
  if (panelStore.discoveredCatalog && Array.isArray(panelStore.discoveredCatalog.modules)) {
    return panelStore.discoveredCatalog;
  }
  return DEFAULT_CATALOG;
}

export function buildPermissionMapFromRole(
  permsList: RolePermissionEntry[] | undefined,
  isNewRole = false,
  isSuperRole = false
): Record<string, boolean> {
  const catalog = getCatalog();
  const existingMap: Record<string, boolean> = {};
  (permsList || []).forEach((p) => {
    existingMap[p.moduleCode] = Boolean(p.canView);
  });

  const result: Record<string, boolean> = {};
  const hasAnyExisting = Object.keys(existingMap).length > 0;

  for (const mod of catalog.modules) {
    const modEnabled = isSuperRole
      ? true
      : hasAnyExisting
      ? mod.code in existingMap
        ? existingMap[mod.code]
        : false
      : isNewRole
      ? mod.code !== 'users'
      : mod.code !== 'users';
    result[mod.code] = modEnabled;

    for (const svc of mod.services) {
      result[svc.code] = isSuperRole
        ? true
        : hasAnyExisting
        ? Boolean(modEnabled && existingMap[svc.code])
        : false;
    }
  }

  for (const svc of catalog.standaloneServices) {
    result[svc.code] = isSuperRole
      ? true
      : hasAnyExisting
      ? Boolean(existingMap[svc.code])
      : false;
  }

  return result;
}

export function serializePermissionMap(map: Record<string, boolean>): RolePermissionEntry[] {
  return Object.entries(map).map(([moduleCode, enabled]) => ({
    moduleCode,
    canView: Boolean(enabled),
    canCreate: Boolean(enabled),
    canEdit: Boolean(enabled),
    canDelete: Boolean(enabled),
    canDeploy: Boolean(enabled),
  }));
}

let onUnauthorizedCallback: (() => void) | null = null;
export function registerUnauthorizedHandler(cb: () => void): void {
  onUnauthorizedCallback = cb;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(panelStore.authToken ? { Authorization: `Bearer ${panelStore.authToken}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    if (onUnauthorizedCallback) onUnauthorizedCallback();
    throw new Error('Sesión expirada');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }
  return data as T;
}

export async function refreshAll(): Promise<void> {
  if (!hasPerm('projects', 'view')) {
    panelStore.loadingProjects = false;
    return;
  }
  if (panelStore.projects.length === 0) {
    panelStore.loadingProjects = true;
  }
  try {
    const data = await apiFetch<{
      host: HostMetrics;
      projectsRoot: string;
      projects: ProjectInfo[];
    }>('/api/projects');
    if (data.host) panelStore.host = data.host;
    if (data.projectsRoot) panelStore.projectsRoot = data.projectsRoot;
    panelStore.projects = data.projects || [];
  } finally {
    panelStore.loadingProjects = false;
  }
}

export async function loadDomains(): Promise<void> {
  if (!panelStore.projects || panelStore.projects.length === 0) {
    try {
      const projData = await apiFetch<{ projects: ProjectInfo[] }>('/api/projects');
      panelStore.projects = projData.projects || [];
    } catch {
      // Ignorar si el rol no tiene acceso a proyectos
    }
  }
  const data = await apiFetch<{ routes: DomainRouteItem[]; caddyfile: string }>('/api/domains');
  panelStore.domainRoutes = data.routes || [];
  panelStore.caddyfilePreview = data.caddyfile || '';
}

export async function loadUsersAndRoles(): Promise<void> {
  const data = await apiFetch<{
    users: UserItem[];
    roles: RoleItem[];
    catalog?: DiscoveredCatalog;
  }>('/api/users');
  panelStore.users = data.users || [];
  panelStore.roles = data.roles || [];
  if (data.catalog) {
    panelStore.discoveredCatalog = data.catalog;
  }
}

export async function loadPermissionsModule(): Promise<void> {
  const data = await apiFetch<{
    users: UserItem[];
    roles: RoleItem[];
    catalog?: DiscoveredCatalog;
  }>('/api/permissions/overview');
  panelStore.users = data.users || [];
  panelStore.roles = data.roles || [];
  if (data.catalog) {
    panelStore.discoveredCatalog = data.catalog;
  }
}

export async function loadAuditLogs(): Promise<void> {
  const data = await apiFetch<{
    logs: AuditLogItem[];
    shield?: RateLimitShieldStatus;
    ingest?: BatchIngestEngineStatus;
  }>('/api/audit');
  panelStore.auditLogs = data.logs || [];
  if (data.shield) panelStore.securityShield = data.shield;
  if (data.ingest) panelStore.securityIngest = data.ingest;
}

export async function switchTab(tab: PanelTab): Promise<void> {
  const tabModMap: Record<PanelTab, string> = {
    projects: 'projects',
    domains: 'domains',
    guide: 'git',
    users: 'users',
    permissions: 'users',
    audit: 'security',
  };
  const reqMod = tabModMap[tab];
  if (reqMod && !hasPerm(reqMod, 'view')) {
    showToast(`Tu rol (${panelStore.currentUser?.role}) no tiene permiso para ver este módulo.`, true);
    return;
  }

  panelStore.activeTab = tab;
  if (tab === 'domains') await loadDomains();
  if (tab === 'users') await loadUsersAndRoles();
  if (tab === 'permissions') await loadPermissionsModule();
  if (tab === 'audit') await loadAuditLogs();
}

export async function jumpToRolePermissionsCard(roleId: number): Promise<void> {
  if (!panelStore.expandedPermRoleIds.includes(roleId)) {
    panelStore.expandedPermRoleIds.push(roleId);
  }
  await switchTab('permissions');
  panelStore.highlightedPermRoleId = roleId;
  setTimeout(() => {
    const el = document.getElementById(`perm-role-card-${roleId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setTimeout(() => {
      if (panelStore.highlightedPermRoleId === roleId) {
        panelStore.highlightedPermRoleId = null;
      }
    }, 1800);
  }, 150);
}

const taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function dismissBackgroundTask(taskId: string): void {
  const timer = taskTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    taskTimers.delete(taskId);
  }
  const idx = panelStore.backgroundTasks.findIndex((t) => t.id === taskId);
  if (idx !== -1) {
    panelStore.backgroundTasks.splice(idx, 1);
  }
}

export function openTaskConsole(task: BackgroundTaskItem): void {
  panelStore.modals.console.taskId = task.id;
  panelStore.modals.console.projectName = task.projectName || '';
  panelStore.modals.console.title = task.title;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = task.output || '⏳ Ejecutando en segundo plano...';
  panelStore.modals.console.open = true;
}

function summarizeTaskOutput(rawOutput: string, fallback: string): string {
  if (!rawOutput) return fallback;
  const lines = rawOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (
      line.startsWith('✅') ||
      line.startsWith('❌') ||
      line.startsWith('⚠️') ||
      line.startsWith('✨') ||
      line.startsWith('🧹') ||
      line.startsWith('🛑')
    ) {
      return line.length > 110 ? `${line.slice(0, 107)}...` : line;
    }
  }
  const last = lines[lines.length - 1] || fallback;
  return last.length > 110 ? `${last.slice(0, 107)}...` : last;
}

export function enqueueBackgroundTask(opts: {
  title: string;
  projectName?: string;
  action: string;
  initialOutput?: string;
  runningMessage?: string;
  successMessage?: string;
  taskFn: () => Promise<{ output?: string; message?: string; success?: boolean } | any>;
  onComplete?: () => Promise<void> | void;
}): BackgroundTaskItem {
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const task = reactive<BackgroundTaskItem>({
    id,
    title: opts.title,
    projectName: opts.projectName || 'Sistema',
    action: opts.action,
    status: 'running',
    message: opts.runningMessage || 'Ejecutando en segundo plano...',
    output:
      opts.initialOutput ||
      `⏳ Ejecutando "${opts.title}" en segundo plano...\nPuedes seguir usando el panel con normalidad.\n`,
    startedAt: Date.now(),
  });

  panelStore.backgroundTasks.unshift(task);
  if (panelStore.backgroundTasks.length > 6) {
    const removed = panelStore.backgroundTasks.pop();
    if (removed) {
      const t = taskTimers.get(removed.id);
      if (t) clearTimeout(t);
      taskTimers.delete(removed.id);
    }
  }

  Promise.resolve()
    .then(() => opts.taskFn())
    .then(async (res) => {
      const rawOutput =
        typeof res?.output === 'string'
          ? res.output
          : typeof res?.message === 'string'
            ? res.message
            : 'Proceso finalizado correctamente.';

      task.output = rawOutput;
      task.finishedAt = Date.now();

      const hasInlineError =
        res?.success === false || rawOutput.includes('❌ Error:') || rawOutput.startsWith('❌');

      if (hasInlineError) {
        task.status = 'error';
        task.message = summarizeTaskOutput(rawOutput, 'La operación reportó un error');
      } else {
        task.status = 'success';
        task.message =
          opts.successMessage || summarizeTaskOutput(rawOutput, 'Completado exitosamente');
      }

      if (panelStore.modals.console.open && panelStore.modals.console.taskId === task.id) {
        panelStore.modals.console.output = task.output;
      }

      if (opts.onComplete) {
        await opts.onComplete();
      } else {
        await refreshAll().catch(() => {});
      }

      const ttlMs = task.status === 'error' ? 22000 : 12000;
      const timer = setTimeout(() => {
        dismissBackgroundTask(task.id);
      }, ttlMs);
      taskTimers.set(task.id, timer);
    })
    .catch((err: any) => {
      const errMsg = err?.message || String(err);
      task.status = 'error';
      task.finishedAt = Date.now();
      task.output = `${task.output}\n❌ Error: ${errMsg}`;
      task.message = `❌ Error: ${errMsg}`;

      if (panelStore.modals.console.open && panelStore.modals.console.taskId === task.id) {
        panelStore.modals.console.output = task.output;
      }

      const timer = setTimeout(() => {
        dismissBackgroundTask(task.id);
      }, 22000);
      taskTimers.set(task.id, timer);
    });

  return task;
}

export async function runProjectAction(
  projectName: string,
  action: string,
  body: Record<string, any> = {}
): Promise<void> {
  const titleMap: Record<string, string> = {
    pull: `Git Pull & Deploy — ${projectName}`,
    restart: `Reiniciando Docker — ${projectName}`,
    'clear-cache': `Limpiando Caché — ${projectName}`,
    rebuild: `Rebuild Seguro — ${projectName}`,
    'rebuild-destroy': `Rebuild Destroy Total — ${projectName}`,
    delete: `Eliminando Proyecto — ${projectName}`,
    start: `Iniciando Contenedores — ${projectName}`,
    stop: `Deteniendo Contenedores — ${projectName}`,
  };

  const runningMessageMap: Record<string, string> = {
    pull: 'Descargando cambios de Git y actualizando contenedores...',
    restart: 'Reiniciando contenedores Docker en segundo plano...',
    'clear-cache': 'Limpiando caché interna del proyecto...',
    rebuild: 'Reconstruyendo imágenes y contenedores en segundo plano...',
    'rebuild-destroy': 'Destruyendo y reconstruyendo contenedores desde cero...',
    delete: 'Deteniendo contenedores y eliminando proyecto...',
    start: 'Levantando contenedores del proyecto...',
    stop: 'Deteniendo contenedores del proyecto...',
  };

  enqueueBackgroundTask({
    title: titleMap[action] || `Ejecutando ${action} — ${projectName}`,
    projectName,
    action,
    runningMessage: runningMessageMap[action] || `Ejecutando ${action} en segundo plano...`,
    initialOutput: `⏳ Ejecutando ${action} en ${projectName}...\n`,
    taskFn: () =>
      apiFetch<{ output: string }>(
        `/api/projects/${encodeURIComponent(projectName)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      ),
    onComplete: async () => {
      if (
        ['serverpanel', 'alpanel'].includes(projectName.toLowerCase()) &&
        ['restart', 'rebuild'].includes(action)
      ) {
        setTimeout(() => {
          refreshAll().catch(() => {});
        }, 3500);
      } else {
        await refreshAll().catch(() => {});
      }
    },
  });
}

export async function openLogsModal(
  projectName: string,
  preferredContainer = ''
): Promise<void> {
  const proj = panelStore.projects.find((p) => p.name === projectName);
  if (!proj || proj.containers.length === 0) {
    showToast('Este proyecto no tiene contenedores activos', true);
    return;
  }
  panelStore.modals.console.taskId = '';
  panelStore.modals.console.projectName = projectName;
  const defaultAppContainer =
    proj.containers.find((c) => c.role === 'backend') ||
    proj.containers.find((c) => c.role === 'frontend') ||
    proj.containers[0];
  panelStore.modals.console.selectedContainer =
    preferredContainer && proj.containers.some((c) => c.name === preferredContainer)
      ? preferredContainer
      : defaultAppContainer.name;
  panelStore.modals.console.showContainerSelect = true;
  panelStore.modals.console.title = `Logs en Vivo — ${projectName}`;
  panelStore.modals.console.open = true;
  await loadSelectedContainerLogs();
}

export async function loadSelectedContainerLogs(): Promise<void> {
  const projectName = panelStore.modals.console.projectName;
  const container = panelStore.modals.console.selectedContainer;
  if (!projectName || !container) return;
  panelStore.modals.console.output = `⏳ Cargando últimas 150 líneas de ${container}...`;
  try {
    const res = await apiFetch<{ logs: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/logs?container=${encodeURIComponent(container)}&tail=150`
    );
    panelStore.modals.console.output = res.logs || 'Sin salida de logs.';
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error obteniendo logs: ${err.message}`;
  }
}

export async function openEnvModal(projectName: string): Promise<void> {
  panelStore.modals.env.projectName = projectName;
  panelStore.modals.env.content = 'Cargando...';
  panelStore.modals.env.open = true;
  try {
    const res = await apiFetch<{ content: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/env`
    );
    panelStore.modals.env.content = res.content || '';
  } catch (err: any) {
    showToast(`Error leyendo .env: ${err.message}`, true);
  }
}

export async function pruneServerDocker(): Promise<void> {
  enqueueBackgroundTask({
    title: 'Limpieza de Caché e Imágenes Docker',
    projectName: 'Servidor Docker',
    action: 'prune',
    runningMessage: 'Ejecutando docker system prune & builder prune...',
    initialOutput: '⏳ Ejecutando docker system prune -f && docker builder prune -f...\n',
    taskFn: () => apiFetch<{ output: string }>('/api/system/prune', { method: 'POST' }),
  });
}

export function openCronjobsModal(projectName: string): void {
  panelStore.modals.cronjobs.projectName = projectName;
  panelStore.modals.cronjobs.open = true;
}

export function openTerminalModal(
  projectName: string,
  containerName = '',
  mode: 'shell' | 'sql' = 'shell',
  databaseName = ''
): void {
  panelStore.modals.terminal.projectName = projectName;
  panelStore.modals.terminal.containerName = containerName;
  panelStore.modals.terminal.mode = mode;
  panelStore.modals.terminal.databaseName = databaseName;
  panelStore.modals.terminal.open = true;
}

export function openErdModal(
  projectName: string,
  containerName = '',
  databaseName = ''
): void {
  panelStore.modals.erd.projectName = projectName;
  panelStore.modals.erd.containerName = containerName;
  panelStore.modals.erd.databaseName = databaseName;
  panelStore.modals.erd.open = true;
}

export function openMicroservicesModal(projectName: string): void {
  panelStore.modals.microservices.projectName = projectName;
  panelStore.modals.microservices.open = true;
}


