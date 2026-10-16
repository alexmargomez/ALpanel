let authToken = localStorage.getItem('alpanel_token') || localStorage.getItem('sm_panel_token') || '';
let currentUser = null;
let allProjects = [];
let allUsers = [];
let allRoles = [];
let allModules = [];
let currentEnvProject = '';
let currentLogsProject = '';
let socket = null;
let viewsLoaded = false;

function showToast(msg) {
  const t = document.getElementById('toast');
  const m = document.getElementById('toast-msg');
  if (!t || !m) return;
  m.innerText = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function copyText(text, msg = 'Copiado al portapapeles') {
  navigator.clipboard.writeText(text);
  showToast(msg);
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m`;
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function hasPerm(moduleCode, action = 'view') {
  if (!currentUser) return false;
  if (currentUser.role === 'superadmin' || currentUser.username === 'superadmin') {
    return true;
  }
  const mod = currentUser.permissions && currentUser.permissions[moduleCode];
  if (!mod) return false;
  switch (action) {
    case 'view':
      return Boolean(mod.canView);
    case 'create':
      return Boolean(mod.canCreate);
    case 'edit':
      return Boolean(mod.canEdit);
    case 'delete':
      return Boolean(mod.canDelete);
    case 'deploy':
      return Boolean(mod.canDeploy);
    default:
      return false;
  }
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Sesión expirada');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Error en la solicitud');
  }
  return data;
}

async function loadViewPartials() {
  if (viewsLoaded) return;

  // 1. Cargar primero las vistas raíz de Login, Página Principal (Dashboard) y Modales
  const rootTargets = [
    { id: 'login-view', url: '/views/login.html' },
    { id: 'app-view', url: '/views/dashboard.html' },
    { id: 'modals-container', url: '/views/modals.html' },
  ];

  await Promise.all(
    rootTargets.map(async (t) => {
      const el = document.getElementById(t.id);
      if (!el) return;
      const res = await fetch(t.url);
      if (res.ok) {
        el.innerHTML = await res.text();
      }
    })
  );

  // 2. Cargar las vistas de cada módulo dentro del contenedor principal del Dashboard
  const moduleTargets = [
    { id: 'tab-projects', url: '/views/projects.html' },
    { id: 'tab-domains', url: '/views/domains.html' },
    { id: 'tab-guide', url: '/views/git.html' },
    { id: 'tab-users', url: '/views/users.html' },
    { id: 'tab-permissions', url: '/views/permissions.html' },
    { id: 'tab-audit', url: '/views/security.html' },
  ];

  await Promise.all(
    moduleTargets.map(async (t) => {
      const el = document.getElementById(t.id);
      if (!el) return;
      const res = await fetch(t.url);
      if (res.ok) {
        el.innerHTML = await res.text();
      }
    })
  );

  if (typeof initDomainForm === 'function') {
    initDomainForm();
  }
  viewsLoaded = true;
}

async function initApp() {
  await loadViewPartials();
  if (!authToken) {
    logout();
    return;
  }
  try {
    const meRes = await apiFetch('/api/auth/me');
    currentUser = meRes.user;
    applyPermissionsToUI();

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');

    if (hasPerm('projects', 'view')) {
      await refreshAll();
    } else {
      const fallbackOrder = [
        { tab: 'domains', mod: 'domains' },
        { tab: 'guide', mod: 'git' },
        { tab: 'users', mod: 'users' },
        { tab: 'audit', mod: 'security' },
      ];
      const firstAllowed = fallbackOrder.find((f) => hasPerm(f.mod, 'view'));
      if (firstAllowed) switchTab(firstAllowed.tab);
    }
    connectRealtime();
  } catch {
    logout();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
