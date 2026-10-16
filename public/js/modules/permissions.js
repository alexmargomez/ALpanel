function getCatalogData() {
  if (discoveredCatalog && Array.isArray(discoveredCatalog.modules)) {
    return discoveredCatalog;
  }
  return {
    modules: [
      {
        code: 'projects',
        name: 'Proyectos & Contenedores',
        description: 'Acceso al panel de proyectos alojados, telemetría de contenedores y acciones Docker',
        icon: 'fa-layer-group',
        services: [
          { code: 'projects.logs', name: 'Ver Consola de Logs', icon: 'fa-terminal', serviceFile: 'src/services/projects/container-logs.service.ts' },
          { code: 'projects.restart_cache', name: 'Reiniciar Docker / Limpiar Caché', icon: 'fa-rotate', serviceFile: 'src/services/projects/container-restart.service.ts' },
          { code: 'projects.stop_rebuild', name: 'Detener / Iniciar / Rebuild Servidor', icon: 'fa-power-off', serviceFile: 'src/services/projects/container-power.service.ts' },
          { code: 'projects.db_view', name: 'Ver Credenciales Base de Datos', icon: 'fa-database', serviceFile: 'src/services/projects/project-db.service.ts' },
          { code: 'projects.db_backup', name: 'Descargar Backup .SQL', icon: 'fa-download', serviceFile: 'src/services/projects/project-db.service.ts' },
          { code: 'projects.env_view', name: 'Ver Archivo .env', icon: 'fa-eye', serviceFile: 'src/services/projects/project-env.service.ts' },
          { code: 'projects.env_edit', name: 'Editar y Guardar .env', icon: 'fa-key', serviceFile: 'src/services/projects/project-env.service.ts' },
          { code: 'projects.dev_mode', name: 'Modo Desarrollador (develop)', icon: 'fa-flask', serviceFile: 'src/services/projects/git-devmode.service.ts' },
          { code: 'projects.git_pull', name: 'Git Pull & Restart (Producción main)', icon: 'fa-cloud-arrow-down', serviceFile: 'src/services/projects/git-deploy.service.ts' },
        ],
      },
      {
        code: 'domains',
        name: 'Dominios & Proxy SSL',
        description: 'Acceso a la pestaña de dominios y certificados automáticos Let’s Encrypt (Caddy)',
        icon: 'fa-globe',
        services: [
          { code: 'domains.manage', name: 'Administrar Dominios SSL', icon: 'fa-globe', serviceFile: 'src/services/domains/caddy-ssl.service.ts' },
        ],
      },
      {
        code: 'git',
        name: 'Guía Multi-Stack & Git',
        description: 'Acceso a la guía de arquitectura y clonación de nuevos proyectos desde Git',
        icon: 'fa-code-branch',
        services: [
          { code: 'git.clone', name: 'Clonar Nuevo Proyecto Git', icon: 'fa-code-branch', serviceFile: 'src/services/git/git-clone.service.ts' },
        ],
      },
      {
        code: 'users',
        name: 'Usuarios & Roles',
        description: 'Acceso a las pestañas de Usuarios, Roles y Matriz de Permisos',
        icon: 'fa-users-gear',
        services: [
          { code: 'users.manage', name: 'Gestionar Usuarios y Roles', icon: 'fa-user-shield', serviceFile: 'src/services/users/users-roles.service.ts' },
        ],
      },
      {
        code: 'security',
        name: 'Auditoría de Eventos',
        description: 'Permiso de módulo completo: Consulta de bitácora de seguridad (sin sub-servicios)',
        icon: 'fa-shield-halved',
        services: [],
      },
    ],
    standaloneServices: [
      {
        code: 'services.docker_prune',
        name: 'Limpiar Caché Global Docker del VPS',
        icon: 'fa-broom',
        serviceFile: 'src/services/docker-prune.service.ts',
      },
    ],
    ignoreConfig: {
      ignoredModules: ['auth', 'dashboard', 'roles', 'permissions'],
      ignoredServices: ['service-registry.ts', 'crypto.service.ts', 'host.service.ts'],
    },
  };
}

/**
 * Renderiza el selector de Módulos + Sub-Servicios + Servicios Independientes
 * con el diseño de GitHub Classic Personal Access Tokens combinado con tarjetas píldora (`✔` / `✖`).
 */
function renderPermissionMatrixTable(containerId, prefix, permsList, isLocked = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const catalog = getCatalogData();
  const permMap = {};
  (permsList || []).forEach((p) => {
    permMap[p.moduleCode] = Boolean(p.canView);
  });

  const isEnabled = (code, isDefaultForNewRole = false) => {
    if (isLocked && prefix.includes('super')) return true;
    if (Object.keys(permMap).length === 0) return isDefaultForNewRole;
    if (code in permMap) return Boolean(permMap[code]);
    return false;
  };

  const modulesHtml = (catalog.modules || [])
    .map((mod) => {
      const modAllowed = isLocked && (!permsList || permsList.length === 0)
        ? true
        : (code => (code in permMap ? permMap[code] : mod.code !== 'users'))(mod.code);
      const hasSubServices = Array.isArray(mod.services) && mod.services.length > 0;

      const servicesPillsHtml = hasSubServices
        ? `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 pl-2 sm:pl-6 border-t border-slate-800/70" data-subservices-of="${prefix}:${mod.code}">
            ${mod.services
              .map((svc) => {
                const svcAllowed = modAllowed && isEnabled(svc.code, false);
                return renderServicePillHtml(prefix, svc.code, svc.name, svc.icon, svc.serviceFile, svcAllowed, isLocked, mod.code);
              })
              .join('')}
          </div>
        `
        : `
          <div class="pt-2 pl-2 sm:pl-6 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            <span><i class="fa-solid fa-layer-group text-indigo-400 mr-1.5"></i>Sin sub-servicios en <code class="text-slate-300">src/services/${mod.code}/</code> — El interruptor del módulo habilita el <strong>módulo completo</strong>.</span>
          </div>
        `;

      return `
        <div class="bg-slate-950/90 border ${
          modAllowed ? 'border-indigo-500/40' : 'border-slate-800'
        } rounded-xl p-3.5 space-y-2.5 transition" data-module-card="${prefix}:${mod.code}">
          <div class="flex flex-wrap items-center justify-between gap-2 ${
            isLocked ? '' : 'cursor-pointer select-none'
          }" ${isLocked ? '' : `onclick="toggleModuleScope('${prefix}', '${mod.code}')"`}>
            <div class="flex items-center gap-2.5">
              <input type="checkbox"
                data-perm-scope="${prefix}"
                data-mod-code="${mod.code}"
                data-is-parent="true"
                ${modAllowed ? 'checked' : ''}
                ${isLocked ? 'disabled' : ''}
                onclick="event.stopPropagation(); toggleModuleScope('${prefix}', '${mod.code}', this.checked)"
                class="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer" />
              <div class="w-7 h-7 rounded-lg ${
                modAllowed ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'
              } border flex items-center justify-center text-xs">
                <i class="fa-solid ${mod.icon || 'fa-cube'}"></i>
              </div>
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-white text-xs sm:text-sm">${mod.name}</span>
                  <code class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-indigo-300 font-mono">${mod.code}</code>
                  ${
                    hasSubServices
                      ? `<span class="text-[10px] text-slate-400">(${mod.services.length} sub-servicio${mod.services.length === 1 ? '' : 's'})</span>`
                      : `<span class="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]">Módulo Completo</span>`
                  }
                </div>
                <p class="text-[11px] text-slate-400">${mod.description || ''}</p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span data-mod-badge="${prefix}:${mod.code}" class="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${
                modAllowed
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-500'
              }">
                <i class="fa-solid ${modAllowed ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/70'}"></i>
                <span>${modAllowed ? 'Módulo Activo' : 'Módulo Bloqueado'}</span>
              </span>
            </div>
          </div>

          ${servicesPillsHtml}
        </div>
      `;
    })
    .join('');

  const standaloneList = catalog.standaloneServices || [];
  const standaloneHtml =
    standaloneList.length > 0
      ? `
        <div class="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xs">
                <i class="fa-solid fa-puzzle-piece"></i>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-white text-xs sm:text-sm">Servicios Independientes (Fuera de Módulos)</span>
                  <code class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-amber-300 font-mono">src/services/*.service.ts</code>
                </div>
                <p class="text-[11px] text-slate-400">Servicios transversales del servidor que no pertenecen a un módulo específico ni están en <code class="text-slate-300">permissions.ignore.json</code>.</p>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/70">
            ${standaloneList
              .map((svc) => {
                const svcAllowed = isEnabled(svc.code, false);
                return renderServicePillHtml(prefix, svc.code, svc.name, svc.icon, svc.serviceFile, svcAllowed, isLocked, '');
              })
              .join('')}
          </div>
        </div>
      `
      : '';

  container.innerHTML = `
    <div class="space-y-3">
      ${modulesHtml}
      ${standaloneHtml}
    </div>
  `;
}

function renderServicePillHtml(prefix, code, name, icon, serviceFile, allowed, isLocked, parentModCode) {
  return `
    <div
      data-pill-card="${prefix}:${code}"
      data-parent-mod="${parentModCode}"
      ${isLocked ? '' : `onclick="toggleServicePill('${prefix}', '${code}', '${parentModCode}')"`}
      title="${serviceFile || code}"
      class="flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition ${
        isLocked ? 'cursor-default' : 'cursor-pointer select-none hover:brightness-110'
      } ${
        allowed
          ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-300 shadow-sm'
          : 'bg-slate-900/60 border-slate-800/90 text-slate-500'
      }">
      <input type="checkbox"
        class="hidden"
        data-perm-scope="${prefix}"
        data-mod-code="${code}"
        data-parent-code="${parentModCode}"
        ${allowed ? 'checked' : ''}
        ${isLocked ? 'disabled' : ''} />
      <span class="flex items-center gap-2 truncate pr-2">
        <i data-pill-icon="${prefix}:${code}" class="fa-solid ${icon || 'fa-bolt'} w-4 text-center ${
          allowed ? 'text-emerald-400' : 'text-slate-600'
        }"></i>
        <span class="truncate font-medium">${name}</span>
      </span>
      <i data-pill-status="${prefix}:${code}" class="fa-solid ${
        allowed ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/60'
      } shrink-0 text-sm"></i>
    </div>
  `;
}

function setPillVisualState(prefix, code, allowed) {
  const cb = document.querySelector(
    `input[data-perm-scope="${prefix}"][data-mod-code="${code}"]`
  );
  if (cb) cb.checked = Boolean(allowed);

  const card = document.querySelector(`[data-pill-card="${prefix}:${code}"]`);
  const iconEl = document.querySelector(`[data-pill-icon="${prefix}:${code}"]`);
  const statusEl = document.querySelector(`[data-pill-status="${prefix}:${code}"]`);

  if (card) {
    card.className = `flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition cursor-pointer select-none hover:brightness-110 ${
      allowed
        ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-300 shadow-sm'
        : 'bg-slate-900/60 border-slate-800/90 text-slate-500'
    }`;
  }
  if (iconEl) {
    iconEl.classList.toggle('text-emerald-400', Boolean(allowed));
    iconEl.classList.toggle('text-slate-600', !allowed);
  }
  if (statusEl) {
    statusEl.className = `fa-solid ${
      allowed ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/60'
    } shrink-0 text-sm`;
  }
}

function setModuleVisualState(prefix, modCode, allowed) {
  const cb = document.querySelector(
    `input[data-perm-scope="${prefix}"][data-mod-code="${modCode}"]`
  );
  if (cb) cb.checked = Boolean(allowed);

  const modCard = document.querySelector(`[data-module-card="${prefix}:${modCode}"]`);
  if (modCard) {
    modCard.classList.toggle('border-indigo-500/40', Boolean(allowed));
    modCard.classList.toggle('border-slate-800', !allowed);
  }

  const badge = document.querySelector(`[data-mod-badge="${prefix}:${modCode}"]`);
  if (badge) {
    badge.className = `px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 ${
      allowed
        ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
        : 'bg-slate-900 border-slate-800 text-slate-500'
    }`;
    badge.innerHTML = `
      <i class="fa-solid ${allowed ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/70'}"></i>
      <span>${allowed ? 'Módulo Activo' : 'Módulo Bloqueado'}</span>
    `;
  }
}

function toggleModuleScope(prefix, modCode, forcedState) {
  const cb = document.querySelector(
    `input[data-perm-scope="${prefix}"][data-mod-code="${modCode}"]`
  );
  if (!cb || cb.disabled) return;
  const nextState = typeof forcedState === 'boolean' ? forcedState : !cb.checked;
  setModuleVisualState(prefix, modCode, nextState);

  // Al desactivar el módulo padre, desactivar sus sub-servicios; al activarlo, si todos estaban apagados, encenderlos
  const childCbs = document.querySelectorAll(
    `input[data-perm-scope="${prefix}"][data-parent-code="${modCode}"]`
  );
  if (!nextState) {
    childCbs.forEach((child) => {
      const childCode = child.getAttribute('data-mod-code');
      if (childCode) setPillVisualState(prefix, childCode, false);
    });
  } else {
    const anyChecked = Array.from(childCbs).some((c) => c.checked);
    if (!anyChecked) {
      childCbs.forEach((child) => {
        const childCode = child.getAttribute('data-mod-code');
        if (childCode) setPillVisualState(prefix, childCode, true);
      });
    }
  }
}

function toggleServicePill(prefix, serviceCode, parentModCode) {
  const cb = document.querySelector(
    `input[data-perm-scope="${prefix}"][data-mod-code="${serviceCode}"]`
  );
  if (!cb || cb.disabled) return;
  const nextState = !cb.checked;
  setPillVisualState(prefix, serviceCode, nextState);

  // Si se activa un sub-servicio y el módulo padre estaba desactivado, activar el módulo padre automáticamente
  if (nextState && parentModCode) {
    setModuleVisualState(prefix, parentModCode, true);
  }
}

function readPermissionMatrixFromDOM(prefix) {
  const inputs = document.querySelectorAll(`input[data-perm-scope="${prefix}"]`);
  const result = [];
  inputs.forEach((input) => {
    const moduleCode = input.getAttribute('data-mod-code');
    if (!moduleCode) return;
    const enabled = Boolean(input.checked);
    result.push({
      moduleCode,
      canView: enabled,
      canCreate: enabled,
      canEdit: enabled,
      canDelete: enabled,
      canDeploy: enabled,
    });
  });
  return result;
}

async function loadPermissionsModule() {
  try {
    const data = await apiFetch('/api/permissions/overview');
    allUsers = data.users || [];
    allRoles = data.roles || [];
    allModules = data.modules || [];
    if (data.catalog) {
      discoveredCatalog = data.catalog;
    }
    const newRoleBtn = document.getElementById('btn-perm-new-role');
    if (newRoleBtn) {
      newRoleBtn.classList.toggle('hidden', !hasPerm('users', 'create'));
    }
    renderRolePermissionsCards();
    renderIgnoredSummary();
  } catch (err) {
    showToast(`Error cargando permisos y servicios: ${err.message}`);
  }
}

const expandedPermRoleIds = new Set();

function setPermRoleCardExpanded(roleId, expanded) {
  if (expanded) {
    expandedPermRoleIds.add(roleId);
  } else {
    expandedPermRoleIds.delete(roleId);
  }
  const body = document.getElementById(`perm-role-body-${roleId}`);
  const chevron = document.getElementById(`perm-role-chevron-${roleId}`);
  const toggleBtnText = document.getElementById(`perm-role-toggle-text-${roleId}`);
  if (body) {
    body.classList.toggle('hidden', !expanded);
  }
  if (chevron) {
    chevron.className = `fa-solid ${
      expanded ? 'fa-chevron-down text-indigo-400' : 'fa-chevron-right text-slate-400'
    } text-xs transition-transform`;
  }
  if (toggleBtnText) {
    toggleBtnText.innerText = expanded ? 'Minimizar' : 'Abrir Permisos';
  }
  updateToggleAllPermRolesButton();
}

function togglePermRoleCard(roleId) {
  const isCurrentlyExpanded = expandedPermRoleIds.has(roleId);
  setPermRoleCardExpanded(roleId, !isCurrentlyExpanded);
}

function toggleAllPermRoleCards() {
  const allExpanded = allRoles.length > 0 && allRoles.every((r) => expandedPermRoleIds.has(r.id));
  allRoles.forEach((r) => {
    setPermRoleCardExpanded(r.id, !allExpanded);
  });
}

function updateToggleAllPermRolesButton() {
  const btn = document.getElementById('btn-toggle-all-perm-roles');
  if (!btn) return;
  const allExpanded = allRoles.length > 0 && allRoles.every((r) => expandedPermRoleIds.has(r.id));
  btn.innerHTML = allExpanded
    ? '<i class="fa-solid fa-angles-up"></i> Minimizar Todos'
    : '<i class="fa-solid fa-angles-down"></i> Expandir Todos';
}

function renderRolePermissionsCards() {
  const container = document.getElementById('role-permissions-cards');
  if (!container) return;

  const canEdit = hasPerm('users', 'edit');
  const canDelete = hasPerm('users', 'delete');

  container.innerHTML =
    allRoles
      .map((r) => {
        const isSuper = r.code === 'superadmin';
        const isExpanded = expandedPermRoleIds.has(r.id);
        const prefix = `role-card-${r.id}`;
        const assignedUsers = allUsers.filter((u) => u.roleId === r.id || u.role === r.code);
        const activePermsCount = (r.permissions || []).filter((p) => p.canView).length;

        const usersBadges =
          assignedUsers.length > 0
            ? assignedUsers
                .map(
                  (u) =>
                    `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono">
                      <i class="fa-solid fa-user text-[9px] text-indigo-400"></i>@${u.username}
                    </span>`
                )
                .join(' ')
            : '<span class="text-[11px] text-slate-500 italic">Sin usuarios asignados</span>';

        return `
          <div id="perm-role-card-${r.id}" class="bg-slate-900 border ${
            isSuper ? 'border-fuchsia-500/30' : 'border-slate-800 hover:border-slate-700'
          } rounded-2xl p-4 sm:p-5 shadow-xl transition">
            <!-- Bloque Mini del Rol (Nombre, Texto, Usuarios y Botones) -->
            <div class="flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none" onclick="togglePermRoleCard(${r.id})">
              <div class="space-y-1.5 min-w-[240px] flex-1">
                <div class="flex flex-wrap items-center gap-2.5">
                  <button type="button" class="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0" title="Abrir / Minimizar Rol">
                    <i id="perm-role-chevron-${r.id}" class="fa-solid ${
                      isExpanded ? 'fa-chevron-down text-indigo-400' : 'fa-chevron-right text-slate-400'
                    } text-xs transition-transform"></i>
                  </button>
                  <span class="w-8 h-8 rounded-xl ${
                    isSuper
                      ? 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300'
                      : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                  } border flex items-center justify-center font-bold text-xs shrink-0">
                    <i class="fa-solid ${isSuper ? 'fa-crown' : 'fa-id-badge'}"></i>
                  </span>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h4 class="font-bold text-white text-sm sm:text-base">${r.name}</h4>
                      <code class="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 ${
                        isSuper ? 'text-fuchsia-300' : 'text-amber-300'
                      } text-[11px] font-mono">${r.code}</code>
                      <span class="px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-[10px] text-emerald-300 font-semibold">
                        <i class="fa-solid fa-circle-check text-emerald-400 mr-1"></i>${activePermsCount} permiso(s) activo(s)
                      </span>
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5">${r.description || 'Sin descripción'}</p>
                  </div>
                </div>

                <!-- Usuarios asignados al Rol -->
                <div class="flex flex-wrap items-center gap-1.5 pl-9">
                  <span class="text-[11px] text-slate-400 mr-1">
                    <i class="fa-solid fa-users text-indigo-400 mr-1"></i>Usuarios (${assignedUsers.length}):
                  </span>
                  ${usersBadges}
                </div>
              </div>

              <!-- Botones de Acción del Rol -->
              <div class="flex flex-wrap items-center gap-2" onclick="event.stopPropagation()">
                <button onclick="togglePermRoleCard(${r.id})" class="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5">
                  <i class="fa-solid fa-sliders text-indigo-400"></i>
                  <span id="perm-role-toggle-text-${r.id}">${isExpanded ? 'Minimizar' : 'Abrir Permisos'}</span>
                </button>
                ${
                  isSuper
                    ? `<span class="px-3 py-1.5 rounded-xl bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-xs font-semibold">
                        <i class="fa-solid fa-shield-halved mr-1"></i>Rol Único (Acceso Total)
                      </span>`
                    : canEdit
                    ? `
                      <button onclick="openRoleModal(${r.id})" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold">
                        <i class="fa-solid fa-pen mr-1"></i>Editar Rol
                      </button>
                      <button onclick="saveRoleCardPermissions(${r.id}, '${prefix}')" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20">
                        <i class="fa-solid fa-floppy-disk"></i> Guardar Permisos
                      </button>
                      ${
                        canDelete
                          ? `<button onclick="deleteRoleItem(${r.id}, '${r.name.replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 rounded-xl bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-xs font-semibold" title="Eliminar Rol">
                              <i class="fa-solid fa-trash"></i>
                            </button>`
                          : ''
                      }
                    `
                    : ''
                }
              </div>
            </div>

            <!-- Cuerpo Desplegable con Módulos, Sub-Servicios y Servicios Independientes (Minimizado por defecto) -->
            <div id="perm-role-body-${r.id}" class="${isExpanded ? '' : 'hidden'} pt-4 mt-4 border-t border-slate-800">
              <div id="role-scope-container-${r.id}"></div>
            </div>
          </div>
        `;
      })
      .join('') || '<div class="text-slate-500 text-xs">No hay roles registrados.</div>';

  // Renderizar las píldoras interactivas de cada rol
  allRoles.forEach((r) => {
    const isSuper = r.code === 'superadmin';
    const locked = isSuper || !canEdit;
    renderPermissionMatrixTable(
      `role-scope-container-${r.id}`,
      `role-card-${r.id}`,
      r.permissions || [],
      locked
    );
  });

  updateToggleAllPermRolesButton();
}

async function saveRoleCardPermissions(roleId, prefix) {
  const permissions = readPermissionMatrixFromDOM(prefix);
  try {
    expandedPermRoleIds.add(roleId);
    await apiFetch(`/api/permissions/roles/${encodeURIComponent(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
    showToast('Módulos y servicios del rol actualizados en MariaDB');
    await loadPermissionsModule();
    const meRes = await apiFetch('/api/auth/me');
    currentUser = meRes.user;
    applyPermissionsToUI();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function renderIgnoredSummary() {
  const el = document.getElementById('ignored-permissions-summary');
  if (!el) return;
  const catalog = getCatalogData();
  const ignore = catalog.ignoreConfig || { ignoredModules: [], ignoredServices: [] };

  const modBadges = (ignore.ignoredModules || []).map(
    (m) => `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300">
        <i class="fa-solid fa-folder text-indigo-400"></i>
        <span>Módulo base: <code class="text-indigo-300 font-mono">src/modules/${m}</code></span>
        <i class="fa-solid fa-circle-check text-emerald-400 ml-1" title="Activo para todos"></i>
      </span>
    `
  );

  const svcBadges = (ignore.ignoredServices || []).map(
    (s) => `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300">
        <i class="fa-solid fa-file-code text-amber-400"></i>
        <span>Servicio global: <code class="text-amber-300 font-mono">src/services/${s}</code></span>
        <i class="fa-solid fa-circle-check text-emerald-400 ml-1" title="Activo para todos"></i>
      </span>
    `
  );

  el.innerHTML = [...modBadges, ...svcBadges].join('');
}

function jumpToRolePermissionsCard(roleId) {
  expandedPermRoleIds.add(roleId);
  switchTab('permissions');
  setTimeout(() => {
    setPermRoleCardExpanded(roleId, true);
    const card = document.getElementById(`perm-role-card-${roleId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('ring-2', 'ring-indigo-500');
      setTimeout(() => card.classList.remove('ring-2', 'ring-indigo-500'), 1800);
    }
  }, 220);
}
