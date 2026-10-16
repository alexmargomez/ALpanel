const SERVICE_CAPABILITIES = [
  {
    label: 'Ver Proyectos y Contenedores',
    icon: 'fa-cubes',
    mod: 'projects',
    field: 'canView',
  },
  {
    label: 'Ver Consola de Logs',
    icon: 'fa-terminal',
    mod: 'projects',
    field: 'canEdit',
  },
  {
    label: 'Reiniciar Docker / Limpiar Caché',
    icon: 'fa-rotate',
    mod: 'projects',
    field: 'canDeploy',
  },
  {
    label: 'Detener / Iniciar / Rebuild Servidor',
    icon: 'fa-power-off',
    mod: 'projects',
    field: 'canDelete',
  },
  {
    label: 'Ver Credenciales Base de Datos',
    icon: 'fa-database',
    mod: 'project_db',
    field: 'canView',
  },
  {
    label: 'Descargar Backup .SQL',
    icon: 'fa-download',
    mod: 'project_db',
    field: 'canDeploy',
  },
  {
    label: 'Ver Archivo .env',
    icon: 'fa-eye',
    mod: 'project_env',
    field: 'canView',
  },
  {
    label: 'Editar y Guardar .env',
    icon: 'fa-key',
    mod: 'project_env',
    field: 'canEdit',
  },
  {
    label: 'Modo Desarrollador (develop)',
    icon: 'fa-flask',
    mod: 'git',
    field: 'canEdit',
  },
  {
    label: 'Git Pull & Restart (Producción main)',
    icon: 'fa-cloud-arrow-down',
    mod: 'git',
    field: 'canDeploy',
  },
  {
    label: 'Clonar Nuevo Proyecto Git',
    icon: 'fa-code-branch',
    mod: 'git',
    field: 'canCreate',
  },
  {
    label: 'Administrar Dominios SSL',
    icon: 'fa-globe',
    mod: 'domains',
    field: 'canCreate',
  },
  {
    label: 'Gestionar Usuarios y Roles',
    icon: 'fa-users-gear',
    mod: 'users',
    field: 'canEdit',
  },
  {
    label: 'Limpiar Caché Global del VPS',
    icon: 'fa-broom',
    mod: 'security',
    field: 'canDeploy',
  },
];

async function loadPermissionsModule() {
  try {
    const data = await apiFetch('/api/permissions/overview');
    allUsers = data.users || [];
    allRoles = data.roles || [];
    allModules = data.modules || [];
    renderUserPermissionsCards();
    populateRoleSelectForLiveEditor();
    renderLiveRolePermissionsEditor();
  } catch (err) {
    showToast(`Error cargando mapa de permisos: ${err.message}`);
  }
}

function renderUserPermissionsCards() {
  const container = document.getElementById('user-permissions-cards');
  if (!container) return;

  container.innerHTML =
    allUsers
      .map((u) => {
        const isSuper = u.role === 'superadmin' || u.username === 'superadmin';
        const roleObj = allRoles.find((r) => r.id === u.roleId || r.code === u.role);
        const permsList = roleObj?.permissions || [];

        const badgesHtml = SERVICE_CAPABILITIES.map((cap) => {
          let allowed = false;
          if (isSuper) {
            allowed = true;
          } else {
            const modRow = permsList.find((p) => p.moduleCode === cap.mod);
            allowed = Boolean(modRow && modRow[cap.field]);
          }

          return `
            <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] ${
              allowed
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-900/60 border-slate-800/80 text-slate-500'
            }">
              <span class="flex items-center gap-1.5 truncate pr-2">
                <i class="fa-solid ${cap.icon} w-3.5 text-center ${allowed ? 'text-emerald-400' : 'text-slate-600'}"></i>
                <span class="truncate">${cap.label}</span>
              </span>
              <i class="fa-solid ${allowed ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/60'} shrink-0"></i>
            </div>
          `;
        }).join('');

        return `
          <div class="bg-slate-900 border ${
            isSuper ? 'border-fuchsia-500/30' : 'border-slate-800'
          } rounded-2xl p-5 space-y-4 shadow-lg">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl ${
                  isSuper
                    ? 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300'
                    : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                } border flex items-center justify-center font-bold">
                  ${isSuper ? '<i class="fa-solid fa-crown"></i>' : (u.fullName || u.username).slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-white text-sm">${u.fullName || u.username}</span>
                    <span class="font-mono text-xs text-slate-400">@${u.username}</span>
                  </div>
                  <div class="text-[11px] text-slate-400">
                    Rol asignado: <strong class="${isSuper ? 'text-fuchsia-300' : 'text-amber-300'}">${u.roleName} (${u.role})</strong>
                  </div>
                </div>
              </div>
              ${
                !isSuper && hasPerm('users', 'edit')
                  ? `<button onclick="selectRoleInLiveEditor(${u.roleId})" class="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-semibold">
                      <i class="fa-solid fa-Sliders mr-1"></i>Configurar Servicios
                    </button>`
                  : `<span class="px-2.5 py-1 rounded-lg bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-[10px] font-semibold">
                      <i class="fa-solid fa-crown mr-1"></i>Acceso Total
                    </span>`
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${badgesHtml}
            </div>
          </div>
        `;
      })
      .join('') || '<div class="text-slate-500 text-xs">No hay usuarios registrados.</div>';
}

function populateRoleSelectForLiveEditor() {
  const select = document.getElementById('perm-editor-role-select');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = allRoles
    .map(
      (r) =>
        `<option value="${r.id}">${r.name} (${r.code})${r.code === 'superadmin' ? ' — Blindado' : ''}</option>`
    )
    .join('');

  if (currentVal && allRoles.some((r) => String(r.id) === String(currentVal))) {
    select.value = currentVal;
  } else {
    const firstEditable = allRoles.find((r) => r.code !== 'superadmin') || allRoles[0];
    if (firstEditable) select.value = String(firstEditable.id);
  }
}

function selectRoleInLiveEditor(roleId) {
  const select = document.getElementById('perm-editor-role-select');
  if (!select || !roleId) return;
  select.value = String(roleId);
  renderLiveRolePermissionsEditor();
  select.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderLiveRolePermissionsEditor() {
  const select = document.getElementById('perm-editor-role-select');
  const saveBtn = document.getElementById('perm-editor-save-btn');
  if (!select) return;
  const roleId = Number(select.value);
  const roleObj = allRoles.find((r) => r.id === roleId);
  if (!roleObj) return;

  const isSuper = roleObj.code === 'superadmin' || !hasPerm('users', 'edit');
  if (saveBtn) {
    saveBtn.disabled = isSuper;
    saveBtn.classList.toggle('opacity-50', isSuper);
  }

  renderPermissionMatrixTable(
    'live-role-permissions-table',
    'live-editor-perm',
    roleObj.permissions || [],
    isSuper
  );
}

async function saveLiveRolePermissions() {
  const select = document.getElementById('perm-editor-role-select');
  if (!select) return;
  const roleId = Number(select.value);
  const permissions = readPermissionMatrixFromDOM('live-editor-perm');
  try {
    await apiFetch(`/api/permissions/roles/${encodeURIComponent(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
    showToast('Permisos y servicios del rol actualizados en MariaDB');
    await loadPermissionsModule();
    // Si el usuario editó su propio rol, refrescar su sesión RBAC
    const meRes = await apiFetch('/api/auth/me');
    currentUser = meRes.user;
    applyPermissionsToUI();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}
