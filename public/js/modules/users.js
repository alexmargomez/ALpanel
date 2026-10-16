async function loadUsersAndRoles() {
  try {
    const data = await apiFetch('/api/users');
    allUsers = data.users || [];
    allRoles = data.roles || [];
    allModules = data.modules || [];
    renderUsersAndRoles();
  } catch (e) {
    showToast(`Error cargando usuarios y roles: ${e.message}`);
  }
}

function renderPermissionMatrixTable(containerId, prefix, permsList, isLocked = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const modulesToRender =
    permsList && permsList.length > 0
      ? permsList
      : (allModules || []).map((m) => ({
          moduleCode: m.code,
          moduleName: m.name,
          moduleIcon: m.icon,
          canView: m.code !== 'users',
          canCreate: false,
          canEdit: false,
          canDelete: false,
          canDeploy: false,
        }));

  container.innerHTML = `
    <table class="w-full text-left border-collapse text-[11px]">
      <thead>
        <tr class="border-b border-slate-800 text-slate-400">
          <th class="py-2 pr-3 font-semibold">Módulo del Panel</th>
          <th class="py-2 px-2 text-center font-semibold">Ver</th>
          <th class="py-2 px-2 text-center font-semibold">Crear</th>
          <th class="py-2 px-2 text-center font-semibold">Editar</th>
          <th class="py-2 px-2 text-center font-semibold">Eliminar</th>
          <th class="py-2 px-2 text-center font-semibold">Desplegar</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-900">
        ${modulesToRender
          .map((p) => {
            const disabledAttr = isLocked ? 'disabled' : '';
            return `
              <tr class="hover:bg-slate-900/60" data-perm-row="${prefix}" data-mod-code="${p.moduleCode}">
                <td class="py-2 pr-3 font-medium text-white">
                  <i class="fa-solid ${p.moduleIcon || 'fa-cube'} text-indigo-400 mr-1.5 w-4 text-center"></i>
                  ${p.moduleName}
                  <code class="text-[10px] text-slate-500 ml-1">(${p.moduleCode})</code>
                </td>
                <td class="py-2 px-2 text-center">
                  <input type="checkbox" data-field="canView" ${p.canView ? 'checked' : ''} ${disabledAttr}
                    class="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer" />
                </td>
                <td class="py-2 px-2 text-center">
                  <input type="checkbox" data-field="canCreate" ${p.canCreate ? 'checked' : ''} ${disabledAttr}
                    class="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0 cursor-pointer" />
                </td>
                <td class="py-2 px-2 text-center">
                  <input type="checkbox" data-field="canEdit" ${p.canEdit ? 'checked' : ''} ${disabledAttr}
                    class="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer" />
                </td>
                <td class="py-2 px-2 text-center">
                  <input type="checkbox" data-field="canDelete" ${p.canDelete ? 'checked' : ''} ${disabledAttr}
                    class="rounded bg-slate-900 border-slate-700 text-rose-500 focus:ring-0 cursor-pointer" />
                </td>
                <td class="py-2 px-2 text-center">
                  <input type="checkbox" data-field="canDeploy" ${p.canDeploy ? 'checked' : ''} ${disabledAttr}
                    class="rounded bg-slate-900 border-slate-700 text-fuchsia-500 focus:ring-0 cursor-pointer" />
                </td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function readPermissionMatrixFromDOM(prefix) {
  const rows = document.querySelectorAll(`tr[data-perm-row="${prefix}"]`);
  const result = [];
  rows.forEach((tr) => {
    const moduleCode = tr.getAttribute('data-mod-code');
    if (!moduleCode) return;
    const getVal = (field) => {
      const cb = tr.querySelector(`input[data-field="${field}"]`);
      return Boolean(cb && cb.checked);
    };
    result.push({
      moduleCode,
      canView: getVal('canView'),
      canCreate: getVal('canCreate'),
      canEdit: getVal('canEdit'),
      canDelete: getVal('canDelete'),
      canDeploy: getVal('canDeploy'),
    });
  });
  return result;
}

function renderUsersAndRoles() {
  const usersList = document.getElementById('users-list');
  const rolesList = document.getElementById('roles-list');
  if (!usersList || !rolesList) return;

  const canCreate = hasPerm('users', 'create');
  const canEdit = hasPerm('users', 'edit');
  const canDelete = hasPerm('users', 'delete');

  const btnNewUser = document.getElementById('btn-new-user');
  if (btnNewUser) btnNewUser.classList.toggle('hidden', !canCreate);

  const btnNewRole = document.getElementById('btn-new-role');
  if (btnNewRole) btnNewRole.classList.toggle('hidden', !canCreate);

  usersList.innerHTML =
    allUsers
      .map((u) => {
        const isSuper = u.role === 'superadmin' || u.username === 'superadmin';
        const roleColor = isSuper
          ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40'
          : u.role === 'admin'
          ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
          : u.role === 'developer'
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

        const roleObj = allRoles.find((r) => r.id === u.roleId || r.code === u.role);
        const activeModules = (roleObj?.permissions || [])
          .filter((p) => p.canView)
          .map(
            (p) =>
              `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[10px]">
                <i class="fa-solid ${p.moduleIcon || 'fa-cube'} text-indigo-400 mr-1"></i>${p.moduleName.split(' ')[0]}
              </span>`
          )
          .join(' ');

        return `
          <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-950 border ${
            isSuper ? 'border-fuchsia-500/30' : 'border-slate-800'
          } rounded-xl p-3.5">
            <div class="flex items-start gap-3 min-w-[220px]">
              <div class="w-9 h-9 rounded-xl ${
                isSuper
                  ? 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300'
                  : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
              } border flex items-center justify-center font-bold text-sm shrink-0 mt-0.5">
                ${
                  isSuper
                    ? '<i class="fa-solid fa-crown"></i>'
                    : (u.fullName || u.username || 'U').slice(0, 1).toUpperCase()
                }
              </div>
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-white text-sm">${u.fullName || u.username}</span>
                  <span class="font-mono text-[11px] text-slate-400">@${u.username}</span>
                  <span class="px-2 py-0.5 rounded-md border text-[10px] font-bold ${roleColor}">
                    <i class="fa-solid ${isSuper ? 'fa-crown' : 'fa-id-badge'} mr-1"></i>${u.roleName} (${u.role})
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                  ${activeModules}
                </div>
                <div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                  <span class="text-emerald-400"><i class="fa-solid fa-lock mr-1"></i>Hash scrypt</span>
                  <span>•</span>
                  <span>Último acceso: <strong class="text-slate-300">${
                    u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Nunca'
                  }</strong></span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5">
              ${
                canEdit
                  ? `<button onclick="openUserModal(${u.id})" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] font-semibold">
                      <i class="fa-solid fa-pen-to-square mr-1"></i>Editar / Permisos
                    </button>`
                  : ''
              }
              ${
                isSuper
                  ? `<span class="px-2.5 py-1.5 rounded-lg bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-[11px] font-semibold" title="El Super Administrador principal es único y no puede eliminarse">
                      <i class="fa-solid fa-shield-halved mr-1"></i>Principal
                    </span>`
                  : canDelete
                  ? `<button onclick="deleteUserItem(${u.id}, '${u.username.replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-[11px] font-semibold">
                      <i class="fa-solid fa-trash mr-1"></i>Eliminar
                    </button>`
                  : ''
              }
            </div>
          </div>`;
      })
      .join('') || '<div class="text-slate-500">No hay usuarios registrados.</div>';

  rolesList.innerHTML =
    allRoles
      .map((r) => {
        const isSuperRole = r.code === 'superadmin';
        const usersInRole = allUsers.filter((u) => u.roleId === r.id || u.role === r.code).length;
        const permSummary = (r.permissions || [])
          .filter((p) => p.canView)
          .map((p) => {
            const flags = [
              p.canView ? 'V' : '',
              p.canCreate ? 'C' : '',
              p.canEdit ? 'E' : '',
              p.canDelete ? 'B' : '',
              p.canDeploy ? 'D' : '',
            ]
              .filter(Boolean)
              .join('·');
            return `<span class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300">
              <strong class="text-indigo-300">${p.moduleCode}</strong>: ${flags}
            </span>`;
          })
          .join(' ');

        return `
          <div class="bg-slate-950 border ${
            isSuperRole ? 'border-fuchsia-500/30' : 'border-slate-800'
          } rounded-xl p-3.5 space-y-2.5">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-white text-sm">${r.name}</span>
                  <code class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 ${
                    isSuperRole ? 'text-fuchsia-300' : 'text-amber-300'
                  } text-[10px] font-mono">${r.code}</code>
                </div>
                <p class="text-[11px] text-slate-400 mt-1">${r.description || 'Sin descripción'}</p>
              </div>
              <span class="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-[10px] shrink-0">
                ${usersInRole} usuario(s)
              </span>
            </div>

            <div class="flex flex-wrap gap-1">
              ${permSummary || '<span class="text-[10px] text-rose-400">Sin acceso a módulos</span>'}
            </div>

            <div class="flex justify-end gap-1.5 pt-1 border-t border-slate-900">
              ${
                isSuperRole
                  ? `<span class="px-2.5 py-1 rounded-lg bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-[10px] font-semibold">
                      <i class="fa-solid fa-lock mr-1"></i>Rol Único (Acceso Total)
                    </span>`
                  : `
                    ${
                      canEdit
                        ? `<button onclick="openRoleModal(${r.id})" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold">
                            <i class="fa-solid fa-Sliders mr-1"></i>Editar Rol & Permisos
                          </button>`
                        : ''
                    }
                    ${
                      canDelete
                        ? `<button onclick="deleteRoleItem(${r.id}, '${r.name.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 text-[11px] font-semibold">
                            <i class="fa-solid fa-trash"></i>
                          </button>`
                        : ''
                    }
                  `
              }
            </div>
          </div>`;
      })
      .join('') || '<div class="text-slate-500">No hay roles registrados.</div>';
}

function onUserRoleSelectChange() {
  const roleSelect = document.getElementById('user-role-id');
  const badge = document.getElementById('user-role-perm-badge');
  if (!roleSelect) return;

  const selectedRoleId = Number(roleSelect.value);
  const roleObj = allRoles.find((r) => r.id === selectedRoleId);
  const isSuper = roleObj?.code === 'superadmin' || roleSelect.disabled;

  if (badge) {
    badge.innerText = roleObj ? `Rol: ${roleObj.name} (${roleObj.code})` : 'RBAC';
  }

  renderPermissionMatrixTable(
    'user-role-permissions-matrix',
    'user-modal-perm',
    roleObj?.permissions || [],
    isSuper
  );
}

function openUserModal(userId = null) {
  const roleSelect = document.getElementById('user-role-id');
  const idInput = document.getElementById('user-id');
  const fullNameInput = document.getElementById('user-fullname');
  const usernameInput = document.getElementById('user-username');
  const passInput = document.getElementById('user-password');
  const passLabel = document.getElementById('user-pass-label');
  const title = document.getElementById('user-modal-title');

  if (userId) {
    const u = allUsers.find((item) => item.id === userId);
    if (!u) return;
    const isSuper = u.role === 'superadmin' || u.username === 'superadmin';
    title.innerHTML = `<i class="fa-solid fa-user-pen text-indigo-400 mr-2"></i>Editar Usuario (@${u.username})`;
    idInput.value = String(u.id);
    fullNameInput.value = u.fullName || '';
    usernameInput.value = u.username || '';
    usernameInput.disabled = isSuper;

    if (isSuper) {
      const superRole = allRoles.find((r) => r.code === 'superadmin');
      roleSelect.innerHTML = `<option value="${superRole?.id || u.roleId || ''}">Super Administrador (superadmin) — Rol Único</option>`;
      roleSelect.disabled = true;
    } else {
      roleSelect.disabled = false;
      roleSelect.innerHTML = allRoles
        .filter((r) => r.code !== 'superadmin')
        .map((r) => `<option value="${r.id}">${r.name} (${r.code})</option>`)
        .join('');
      if (u.roleId) roleSelect.value = String(u.roleId);
    }

    passInput.value = '';
    passInput.required = false;
    passLabel.innerText = 'Nueva Contraseña (Opcional — vacía para conservar actual)';
  } else {
    title.innerHTML = `<i class="fa-solid fa-user-plus text-indigo-400 mr-2"></i>Crear Nuevo Usuario`;
    idInput.value = '';
    fullNameInput.value = '';
    usernameInput.value = '';
    usernameInput.disabled = false;
    roleSelect.disabled = false;
    roleSelect.innerHTML = allRoles
      .filter((r) => r.code !== 'superadmin')
      .map((r) => `<option value="${r.id}">${r.name} (${r.code})</option>`)
      .join('');
    passInput.value = '';
    passInput.required = true;
    passLabel.innerText = 'Contraseña (mín. 6 caracteres, hash scrypt)';
  }

  onUserRoleSelectChange();
  document.getElementById('user-modal').classList.remove('hidden');
}

async function submitUserForm(e) {
  e.preventDefault();
  const id = document.getElementById('user-id').value.trim();
  const roleSelect = document.getElementById('user-role-id');
  const isSuper = roleSelect.disabled;
  const payload = {
    fullName: document.getElementById('user-fullname').value.trim(),
    username: document.getElementById('user-username').value.trim(),
    roleId: Number(roleSelect.value),
    password: document.getElementById('user-password').value,
    rolePermissions: isSuper ? undefined : readPermissionMatrixFromDOM('user-modal-perm'),
  };
  try {
    if (id) {
      await apiFetch(`/api/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Usuario y permisos del rol actualizados');
    } else {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Usuario creado correctamente');
    }
    closeModal('user-modal');
    await loadUsersAndRoles();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteUserItem(id, username) {
  if (!confirm(`¿Seguro que deseas eliminar al usuario @${username}?`)) return;
  try {
    await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Usuario @${username} eliminado`);
    await loadUsersAndRoles();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function openRoleModal(roleId = null) {
  const idInput = document.getElementById('role-id');
  const nameInput = document.getElementById('role-name');
  const codeInput = document.getElementById('role-code');
  const descInput = document.getElementById('role-desc');
  const title = document.getElementById('role-modal-title');

  if (roleId) {
    const r = allRoles.find((item) => item.id === roleId);
    if (!r) return;
    title.innerHTML = `<i class="fa-solid fa-pen-to-square text-amber-400 mr-2"></i>Editar Rol y Matriz RBAC (${r.code})`;
    idInput.value = String(r.id);
    nameInput.value = r.name || '';
    codeInput.value = r.code || '';
    descInput.value = r.description || '';
    renderPermissionMatrixTable('role-permissions-matrix', 'role-modal-perm', r.permissions || [], false);
  } else {
    title.innerHTML = `<i class="fa-solid fa-plus text-amber-400 mr-2"></i>Crear Nuevo Rol y Permisos RBAC`;
    idInput.value = '';
    nameInput.value = '';
    codeInput.value = '';
    descInput.value = '';
    renderPermissionMatrixTable('role-permissions-matrix', 'role-modal-perm', [], false);
  }

  document.getElementById('role-modal').classList.remove('hidden');
}

async function submitRoleForm(e) {
  e.preventDefault();
  const id = document.getElementById('role-id').value.trim();
  const payload = {
    name: document.getElementById('role-name').value.trim(),
    code: document.getElementById('role-code').value.trim(),
    description: document.getElementById('role-desc').value.trim(),
    permissions: readPermissionMatrixFromDOM('role-modal-perm'),
  };
  try {
    if (id) {
      await apiFetch(`/api/roles/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Rol y matriz de permisos actualizados');
    } else {
      await apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Nuevo rol creado con sus permisos');
    }
    closeModal('role-modal');
    await loadUsersAndRoles();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

async function deleteRoleItem(id, name) {
  if (!confirm(`¿Seguro que deseas eliminar el rol "${name}"?`)) return;
  try {
    await apiFetch(`/api/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Rol "${name}" eliminado`);
    await loadUsersAndRoles();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}
