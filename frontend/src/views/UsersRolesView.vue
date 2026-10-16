<script setup lang="ts">
import { computed } from 'vue';
import {
  apiFetch,
  hasPerm,
  jumpToRolePermissionsCard,
  loadUsersAndRoles,
  panelStore,
  showToast,
} from '../composables/usePanelStore';
import type { RoleItem, UserItem } from '../types/panel';

const canCreate = computed(() => hasPerm('users', 'create'));
const canEdit = computed(() => hasPerm('users', 'edit'));
const canDelete = computed(() => hasPerm('users', 'delete'));

function isSuperUser(u: UserItem): boolean {
  return u.role === 'superadmin' || u.username === 'superadmin';
}

function getRoleBadgeClass(u: UserItem): string {
  if (isSuperUser(u)) return 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40';
  if (u.role === 'admin') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
  if (u.role === 'developer') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
}

function getActiveParentModulesForUser(u: UserItem) {
  const roleObj = panelStore.roles.find((r) => r.id === u.roleId || r.code === u.role);
  return (roleObj?.permissions || []).filter(
    (p) => p.canView && !p.moduleCode.includes('.')
  );
}

function isRoleExpanded(roleId: number): boolean {
  return panelStore.expandedUserRoleIds.includes(roleId);
}

function toggleRoleMiniCard(roleId: number): void {
  const idx = panelStore.expandedUserRoleIds.indexOf(roleId);
  if (idx >= 0) {
    panelStore.expandedUserRoleIds.splice(idx, 1);
  } else {
    panelStore.expandedUserRoleIds.push(roleId);
  }
}

function getAssignedUsersForRole(r: RoleItem): UserItem[] {
  return panelStore.users.filter((u) => u.roleId === r.id || u.role === r.code);
}

function openUserModal(userId: number | null = null): void {
  panelStore.modals.user.userId = userId;
  panelStore.modals.user.open = true;
}

function openRoleModal(roleId: number | null = null): void {
  panelStore.modals.role.roleId = roleId;
  panelStore.modals.role.open = true;
}

async function deleteUserItem(id: number, username: string): Promise<void> {
  if (!confirm(`¿Seguro que deseas eliminar al usuario @${username}?`)) return;
  try {
    await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Usuario @${username} eliminado`);
    await loadUsersAndRoles();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}

async function deleteRoleItem(id: number, name: string): Promise<void> {
  if (!confirm(`¿Seguro que deseas eliminar el rol "${name}"?`)) return;
  try {
    await apiFetch(`/api/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Rol "${name}" eliminado`);
    await loadUsersAndRoles();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}
</script>

<template>
  <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Left / Main: Users Table (2 cols) -->
    <div class="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-users text-indigo-400"></i> Usuarios del Panel
          </h3>
          <p class="text-xs text-slate-400">
            Gestionados con <strong class="text-indigo-300">Prisma ORM</strong> en MariaDB 11 • Hash
            <code class="text-emerald-400">scrypt + salt</code>.
          </p>
        </div>
        <button
          v-if="canCreate"
          @click="openUserModal(null)"
          class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
        >
          <i class="fa-solid fa-user-plus"></i> Nuevo Usuario
        </button>
      </div>

      <div v-if="panelStore.users.length === 0" class="text-slate-500 text-xs">
        No hay usuarios registrados.
      </div>

      <div v-else class="space-y-2.5 text-xs">
        <div
          v-for="u in panelStore.users"
          :key="u.id"
          class="flex flex-wrap items-center justify-between gap-3 bg-slate-950 border rounded-xl p-3.5"
          :class="isSuperUser(u) ? 'border-fuchsia-500/30' : 'border-slate-800'"
        >
          <div class="flex items-start gap-3 min-w-[220px]">
            <div
              class="w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-sm shrink-0 mt-0.5"
              :class="
                isSuperUser(u)
                  ? 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300'
                  : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
              "
            >
              <i v-if="isSuperUser(u)" class="fa-solid fa-crown"></i>
              <template v-else>{{ (u.fullName || u.username || 'U').slice(0, 1).toUpperCase() }}</template>
            </div>

            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-white text-sm">{{ u.fullName || u.username }}</span>
                <span class="font-mono text-[11px] text-slate-400">@{{ u.username }}</span>
                <span
                  class="px-2 py-0.5 rounded-md border text-[10px] font-bold"
                  :class="getRoleBadgeClass(u)"
                >
                  <i
                    class="fa-solid mr-1"
                    :class="isSuperUser(u) ? 'fa-crown' : 'fa-id-badge'"
                  ></i>
                  {{ u.roleName }} ({{ u.role }})
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span
                  v-for="perm in getActiveParentModulesForUser(u)"
                  :key="perm.moduleCode"
                  class="px-2 py-0.5 rounded-md bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-[10px] inline-flex items-center gap-1"
                >
                  <i class="fa-solid text-emerald-400" :class="perm.moduleIcon || 'fa-cube'"></i>
                  {{ perm.moduleName || perm.moduleCode }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                <span class="text-emerald-400">
                  <i class="fa-solid fa-lock mr-1"></i>Hash scrypt
                </span>
                <span>•</span>
                <span>
                  Último acceso:
                  <strong class="text-slate-300">
                    {{ u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Nunca' }}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5">
            <button
              v-if="canEdit"
              @click="openUserModal(u.id)"
              class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] font-semibold"
            >
              <i class="fa-solid fa-pen-to-square mr-1"></i>Editar Usuario
            </button>
            <span
              v-if="isSuperUser(u)"
              class="px-2.5 py-1.5 rounded-lg bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-[11px] font-semibold"
              title="El Super Administrador principal es único y no puede eliminarse"
            >
              <i class="fa-solid fa-shield-halved mr-1"></i>Principal
            </span>
            <button
              v-else-if="canDelete"
              @click="deleteUserItem(u.id, u.username)"
              class="px-2.5 py-1.5 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-[11px] font-semibold"
            >
              <i class="fa-solid fa-trash mr-1"></i>Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Roles & RBAC Mini Cards (1 col, Minimized by default) -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-id-badge text-amber-400"></i> Roles y Permisos RBAC
          </h3>
          <p class="text-xs text-slate-400">Define qué módulos y acciones puede usar cada rol.</p>
        </div>
        <button
          v-if="canCreate"
          @click="openRoleModal(null)"
          class="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <i class="fa-solid fa-plus"></i> Nuevo Rol
        </button>
      </div>

      <div v-if="panelStore.roles.length === 0" class="text-slate-500 text-xs">
        No hay roles registrados.
      </div>

      <div v-else class="space-y-2.5 text-xs">
        <div
          v-for="r in panelStore.roles"
          :key="r.id"
          class="bg-slate-950 border rounded-xl p-3 transition"
          :class="
            r.code === 'superadmin'
              ? 'border-fuchsia-500/30'
              : 'border-slate-800 hover:border-slate-700'
          "
        >
          <!-- Vista Mini (Datos básicos: Nombre, Texto, Usuarios y Botones) -->
          <div class="space-y-2">
            <div
              @click="toggleRoleMiniCard(r.id)"
              class="flex items-start justify-between gap-2 cursor-pointer select-none"
            >
              <div class="flex items-start gap-2.5 min-w-0">
                <button
                  type="button"
                  class="w-6 h-6 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5"
                  title="Abrir / Cerrar detalle del rol"
                >
                  <i
                    class="fa-solid text-xs transition-transform"
                    :class="
                      isRoleExpanded(r.id)
                        ? 'fa-chevron-down text-indigo-400'
                        : 'fa-chevron-right text-slate-500'
                    "
                  ></i>
                </button>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-bold text-white text-sm">{{ r.name }}</span>
                    <code
                      class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono"
                      :class="r.code === 'superadmin' ? 'text-fuchsia-300' : 'text-amber-300'"
                    >
                      {{ r.code }}
                    </code>
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                    {{ r.description || 'Sin descripción' }}
                  </p>
                </div>
              </div>
              <span
                class="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300 text-[10px] shrink-0 font-semibold"
              >
                <i class="fa-solid fa-users text-[9px] text-indigo-400 mr-1"></i>
                {{ getAssignedUsersForRole(r).length }} usuario(s)
              </span>
            </div>

            <!-- Usuarios y Botones en el bloque mini -->
            <div
              class="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-900/90"
            >
              <div class="flex flex-wrap items-center gap-1">
                <template v-if="getAssignedUsersForRole(r).length > 0">
                  <span
                    v-for="u in getAssignedUsersForRole(r)"
                    :key="u.id"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 font-mono"
                  >
                    @{{ u.username }}
                  </span>
                </template>
                <span v-else class="text-[10px] text-slate-500 italic">Sin usuarios</span>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 ml-auto" @click.stop>
                <button
                  v-if="r.code === 'superadmin'"
                  @click="jumpToRolePermissionsCard(r.id)"
                  class="px-2.5 py-1 rounded-lg bg-fuchsia-950/40 hover:bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-800/40 text-[10px] font-semibold"
                >
                  <i class="fa-solid fa-lock mr-1"></i>Acceso Total
                </button>
                <template v-else>
                  <template v-if="canEdit">
                    <button
                      @click="jumpToRolePermissionsCard(r.id)"
                      class="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold"
                    >
                      <i class="fa-solid fa-sliders mr-1"></i>Configurar Servicios
                    </button>
                    <button
                      @click="openRoleModal(r.id)"
                      class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold"
                    >
                      <i class="fa-solid fa-pen mr-1"></i>Editar
                    </button>
                  </template>
                  <button
                    v-if="canDelete"
                    @click="deleteRoleItem(r.id, r.name)"
                    class="px-2.5 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 text-[11px] font-semibold"
                    title="Eliminar Rol"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </template>
              </div>
            </div>
          </div>

          <!-- Contenido Desplegable (Permisos y Servicios activos del rol) - Minimizado por defecto -->
          <div
            v-if="isRoleExpanded(r.id)"
            class="pt-2.5 mt-2.5 border-t border-slate-800/80 space-y-1.5"
          >
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Módulos y Servicios Activos ({{
                (r.permissions || []).filter((p) => p.canView).length
              }}):
            </div>
            <div class="flex flex-wrap gap-1.5">
              <template v-if="(r.permissions || []).some((p) => p.canView)">
                <span
                  v-for="p in (r.permissions || []).filter((item) => item.canView)"
                  :key="p.moduleCode"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/30 border border-emerald-500/30 text-[10px] text-emerald-300"
                >
                  <i
                    class="fa-solid text-emerald-400"
                    :class="p.moduleIcon || 'fa-circle-check'"
                  ></i>
                  <span>{{ p.moduleName || p.moduleCode }}</span>
                </span>
              </template>
              <span v-else class="text-[10px] text-rose-400">
                Sin módulos ni servicios habilitados
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
