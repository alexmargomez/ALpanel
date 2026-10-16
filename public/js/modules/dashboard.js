function applyPermissionsToUI() {
  if (!currentUser) return;

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
