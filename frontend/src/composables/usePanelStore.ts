import { reactive } from 'vue';
import type {
  AuditLogItem,
  DiscoveredCatalog,
  DomainRouteItem,
  HostMetrics,
  PanelTab,
  ProjectInfo,
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
  toast: {
    visible: false,
    message: 'Listo',
    isError: false,
  },
  modals: {
    db: { open: false, projectName: '' } as DbModalState,
    console: {
      open: false,
      title: 'Consola del Servidor',
      output: '',
      projectName: '',
      selectedContainer: '',
      showContainerSelect: false,
    } as ConsoleModalState,
    env: { open: false, projectName: '', content: '' } as EnvModalState,
    clone: { open: false } as CloneModalState,
    user: { open: false, userId: null } as UserModalState,
    role: { open: false, roleId: null } as RoleModalState,
    appUsers: { open: false, projectName: '' } as AppUsersModalState,
  },
});

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
  const data = await apiFetch<{ logs: AuditLogItem[] }>('/api/audit');
  panelStore.auditLogs = data.logs || [];
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

export async function runProjectAction(
  projectName: string,
  action: string,
  body: Record<string, any> = {}
): Promise<void> {
  const titleMap: Record<string, string> = {
    pull: `Git Pull (Rama main con Rollback por Conflictos) — ${projectName}`,
    restart: `Reiniciando Docker — ${projectName}`,
    'clear-cache': `Limpiando Caché — ${projectName}`,
    rebuild: `Reconstruyendo Imágenes (Rebuild) — ${projectName}`,
    start: `Iniciando Proyecto — ${projectName}`,
    stop: `Deteniendo Proyecto — ${projectName}`,
  };

  panelStore.modals.console.title = titleMap[action] || `Ejecutando ${action}`;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = '⏳ Ejecutando comando en el servidor, por favor espera...\n';
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{ output: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/${action}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
    panelStore.modals.console.output = res.output || 'Comando finalizado.';
    if (
      ['serverpanel', 'alpanel'].includes(projectName.toLowerCase()) &&
      ['pull', 'restart', 'rebuild'].includes(action)
    ) {
      setTimeout(() => {
        refreshAll().catch(() => {});
      }, 3500);
    } else {
      await refreshAll();
    }
  } catch (e: any) {
    panelStore.modals.console.output = `❌ Error: ${e.message}`;
  }
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
  panelStore.modals.console.projectName = projectName;
  panelStore.modals.console.selectedContainer =
    preferredContainer && proj.containers.some((c) => c.name === preferredContainer)
      ? preferredContainer
      : proj.containers[0].name;
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
  panelStore.modals.console.title = 'Limpiando Caché e Imágenes Huérfanas de Docker';
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output =
    '⏳ Ejecutando docker system prune -f && docker builder prune -f...\n';
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{ output: string }>('/api/system/prune', { method: 'POST' });
    panelStore.modals.console.output = res.output || 'Limpieza completada.';
    await refreshAll();
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error: ${err.message}`;
  }
}
