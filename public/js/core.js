let authToken = localStorage.getItem('sm_panel_token') || '';
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
  const targets = [
    { id: 'tab-projects', url: '/views/projects.html' },
    { id: 'tab-domains', url: '/views/domains.html' },
    { id: 'tab-guide', url: '/views/git.html' },
    { id: 'tab-users', url: '/views/users.html' },
    { id: 'tab-audit', url: '/views/security.html' },
    { id: 'modals-container', url: '/views/modals.html' },
  ];

  await Promise.all(
    targets.map(async (t) => {
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

function applyPermissionsToUI() {
  if (!currentUser) return;

  // Mostrar insignia del usuario conectado en la barra superior
  const userBadge = document.getElementById('current-user-badge');
  if (userBadge) {
    const isSuper = currentUser.role === 'superadmin' || currentUser.username === 'superadmin';
    userBadge.innerHTML = `
      <i class="fa-solid ${isSuper ? 'fa-crown text-fuchsia-400' : 'fa-user-check text-indigo-400'}"></i>
      <span class="font-bold text-white">@${currentUser.username}</span>
      <span class="hidden md:inline text-slate-400">(${currentUser.roleName || currentUser.role})</span>
    `;
    userBadge.classList.remove('hidden');
  }

  // Mostrar/ocultar pestañas según permiso canView de cada módulo
  const tabMap = [
    { tab: 'projects', mod: 'projects' },
    { tab: 'domains', mod: 'domains' },
    { tab: 'guide', mod: 'git' },
    { tab: 'users', mod: 'users' },
    { tab: 'audit', mod: 'security' },
  ];

  tabMap.forEach(({ tab, mod }) => {
    const btn = document.getElementById(`tab-btn-${tab}`);
    if (btn) {
      btn.classList.toggle('hidden', !hasPerm(mod, 'view'));
    }
  });

  // Botones globales del header
  const cloneBtn = document.getElementById('btn-top-clone');
  if (cloneBtn) cloneBtn.classList.toggle('hidden', !hasPerm('git', 'create'));

  const pruneBtn = document.getElementById('btn-top-prune');
  if (pruneBtn) pruneBtn.classList.toggle('hidden', !hasPerm('security', 'deploy'));
}

function switchTab(tab) {
  const tabModMap = {
    projects: 'projects',
    domains: 'domains',
    guide: 'git',
    users: 'users',
    audit: 'security',
  };
  const reqMod = tabModMap[tab];
  if (reqMod && !hasPerm(reqMod, 'view')) {
    showToast(`Tu rol (${currentUser?.role}) no tiene permiso para ver este módulo.`);
    return;
  }

  ['projects', 'domains', 'guide', 'users', 'audit'].forEach((t) => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (!btn || btn.classList.contains('hidden')) return;
    if (t === tab) {
      btn.className =
        'py-2.5 sm:py-3 border-b-2 border-indigo-500 text-indigo-400 font-semibold flex items-center gap-1.5 shrink-0';
    } else {
      btn.className =
        'py-2.5 sm:py-3 border-b-2 border-transparent text-slate-400 hover:text-slate-200 font-medium flex items-center gap-1.5 shrink-0';
    }
  });

  if (tab === 'domains' && typeof loadDomains === 'function') loadDomains();
  if (tab === 'users' && typeof loadUsersAndRoles === 'function') loadUsersAndRoles();
  if (tab === 'audit' && typeof loadAuditLogs === 'function') loadAuditLogs();
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function updateHostUI(host) {
  if (!host) return;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setTxt('host-ip', host.publicIp || '127.0.0.1');
  setTxt('host-os', `${host.distro || host.platform} (${host.hostname})`);
  setTxt('host-uptime', `Uptime: ${formatUptime(host.uptimeSeconds || 0)}`);

  setTxt('cpu-cores', `(${host.cpu.cores} núcleos)`);
  setTxt('cpu-percent', `${host.cpu.usagePercent}%`);
  const cpuBar = document.getElementById('cpu-bar');
  if (cpuBar) cpuBar.style.width = `${Math.min(100, host.cpu.usagePercent)}%`;

  setTxt(
    'ram-text',
    `${formatBytes(host.memory.usedBytes)} / ${formatBytes(host.memory.totalBytes)} (${host.memory.usagePercent}%)`
  );
  const ramBar = document.getElementById('ram-bar');
  if (ramBar) ramBar.style.width = `${Math.min(100, host.memory.usagePercent)}%`;

  setTxt(
    'disk-text',
    `${formatBytes(host.disk.usedBytes)} / ${formatBytes(host.disk.totalBytes)} (${host.disk.usagePercent}%)`
  );
  const diskBar = document.getElementById('disk-bar');
  if (diskBar) diskBar.style.width = `${Math.min(100, host.disk.usagePercent)}%`;
}

function connectRealtime() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token: authToken } });
  socket.on('dashboard:update', (payload) => {
    if (payload.host) updateHostUI(payload.host);
    if (payload.projects && hasPerm('projects', 'view')) {
      allProjects = payload.projects;
      if (typeof renderProjects === 'function') renderProjects();
    }
  });
}

function logout() {
  authToken = '';
  currentUser = null;
  localStorage.removeItem('sm_panel_token');
  if (socket) socket.disconnect();
  document.getElementById('app-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
}

async function initApp() {
  if (!authToken) {
    logout();
    return;
  }
  try {
    await loadViewPartials();
    const meRes = await apiFetch('/api/auth/me');
    currentUser = meRes.user;
    applyPermissionsToUI();

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');

    if (hasPerm('projects', 'view')) {
      await refreshAll();
    } else {
      // Si el rol no tiene vista de proyectos, abrir el primer módulo permitido
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
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('login-error');
      errBox.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('login-user').value.trim(),
            password: document.getElementById('login-pass').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error de autenticación');
        authToken = data.token;
        localStorage.setItem('sm_panel_token', authToken);
        await initApp();
      } catch (err) {
        errBox.innerText = err.message;
        errBox.classList.remove('hidden');
      }
    });
  }

  initApp();
});
