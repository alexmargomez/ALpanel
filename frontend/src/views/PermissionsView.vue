<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import {
  apiFetch,
  buildPermissionMapFromRole,
  getCatalog,
  hasPerm,
  loadPermissionsModule,
  panelStore,
  serializePermissionMap,
  showToast,
} from '../composables/usePanelStore';
import PermissionMatrixSelector from '../components/common/PermissionMatrixSelector.vue';
import type { RoleItem, UserItem } from '../types/panel';

const canCreate = computed(() => hasPerm('users', 'create'));
const canEdit = computed(() => hasPerm('users', 'edit'));
const canDelete = computed(() => hasPerm('users', 'delete'));

const catalog = computed(() => getCatalog());
const rolePermissionDrafts = reactive<Record<number, Record<string, boolean>>>({});

watch(
  () => panelStore.roles,
  (roles) => {
    for (const r of roles) {
      rolePermissionDrafts[r.id] = buildPermissionMapFromRole(
        r.permissions,
        false,
        r.code === 'superadmin'
      );
    }
  },
  { immediate: true, deep: true }
);

function isRoleExpanded(roleId: number): boolean {
  return panelStore.expandedPermRoleIds.includes(roleId);
}

function togglePermRoleCard(roleId: number): void {
  const idx = panelStore.expandedPermRoleIds.indexOf(roleId);
  if (idx >= 0) {
    panelStore.expandedPermRoleIds.splice(idx, 1);
  } else {
    panelStore.expandedPermRoleIds.push(roleId);
  }
}

const allRolesExpanded = computed(() => {
  return (
    panelStore.roles.length > 0 &&
    panelStore.roles.every((r) => panelStore.expandedPermRoleIds.includes(r.id))
  );
});

function toggleAllPermRoleCards(): void {
  if (allRolesExpanded.value) {
    panelStore.expandedPermRoleIds = [];
  } else {
    panelStore.expandedPermRoleIds = panelStore.roles.map((r) => r.id);
  }
}

function getAssignedUsersForRole(r: RoleItem): UserItem[] {
  return panelStore.users.filter((u) => u.roleId === r.id || u.role === r.code);
}

function getActivePermsCount(r: RoleItem): number {
  const draft = rolePermissionDrafts[r.id];
  if (draft) {
    return Object.values(draft).filter(Boolean).length;
  }
  return (r.permissions || []).filter((p) => p.canView).length;
}

function openRoleModal(roleId: number | null = null): void {
  panelStore.modals.role.roleId = roleId;
  panelStore.modals.role.open = true;
}

async function saveRoleCardPermissions(roleId: number): Promise<void> {
  const map = rolePermissionDrafts[roleId] || {};
  const permissions = serializePermissionMap(map);
  try {
    if (!panelStore.expandedPermRoleIds.includes(roleId)) {
      panelStore.expandedPermRoleIds.push(roleId);
    }
    await apiFetch(`/api/permissions/roles/${encodeURIComponent(roleId)}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
    showToast('Módulos y servicios del rol actualizados en MariaDB');
    await loadPermissionsModule();
    const meRes = await apiFetch<{ user: UserItem }>('/api/auth/me');
    panelStore.currentUser = meRes.user;
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}

async function deleteRoleItem(id: number, name: string): Promise<void> {
  if (!confirm(`¿Seguro que deseas eliminar el rol "${name}"?`)) return;
  try {
    await apiFetch(`/api/roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Rol "${name}" eliminado`);
    await loadPermissionsModule();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}
</script>

<template>
  <section class="space-y-6">
    <!-- Header Banner -->
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4"
    >
      <div>
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <i class="fa-solid fa-user-shield text-indigo-400"></i> Módulos y Servicios por Rol
          (Auto-Discovery)
        </h3>
        <p class="text-xs text-slate-400 mt-1">
          Los permisos en ALpanel se asignan <strong>por Rol</strong> al estilo de
          <em>GitHub Classic Tokens</em>: habilita un <strong>Módulo padre</strong> y marca o
          desmarca cada uno de sus <strong>Sub-Servicios</strong> (<code class="text-indigo-300"
            >src/services/&lt;modulo&gt;/</code
          >). Si un módulo no tiene sub-servicios, el interruptor controla el módulo completo.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          @click="toggleAllPermRoleCards"
          class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
        >
          <i
            class="fa-solid"
            :class="allRolesExpanded ? 'fa-angles-up' : 'fa-angles-down'"
          ></i>
          {{ allRolesExpanded ? 'Minimizar Todos' : 'Expandir Todos' }}
        </button>
        <button
          v-if="canCreate"
          @click="openRoleModal(null)"
          class="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-amber-600/20"
        >
          <i class="fa-solid fa-plus"></i> Nuevo Rol
        </button>
        <button
          @click="loadPermissionsModule"
          class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
        >
          <i class="fa-solid fa-rotate"></i> Re-escanear Módulos y Servicios
        </button>
      </div>
    </div>

    <!-- Tarjetas Interactivas de Permisos por Rol (Mini Cards minimizadas por defecto) -->
    <div v-if="panelStore.roles.length === 0" class="text-slate-500 text-xs">
      No hay roles registrados.
    </div>

    <div v-else class="space-y-5">
      <div
        v-for="r in panelStore.roles"
        :key="r.id"
        :id="`perm-role-card-${r.id}`"
        class="bg-slate-900 border rounded-2xl p-4 sm:p-5 shadow-xl transition"
        :class="[
          r.code === 'superadmin'
            ? 'border-fuchsia-500/30'
            : 'border-slate-800 hover:border-slate-700',
          panelStore.highlightedPermRoleId === r.id ? 'ring-2 ring-indigo-500' : '',
        ]"
      >
        <!-- Bloque Mini del Rol (Nombre, Texto, Usuarios y Botones) -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
          @click="togglePermRoleCard(r.id)"
        >
          <div class="space-y-1.5 min-w-[240px] flex-1">
            <div class="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                class="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0"
                title="Abrir / Minimizar Rol"
              >
                <i
                  class="fa-solid text-xs transition-transform"
                  :class="
                    isRoleExpanded(r.id)
                      ? 'fa-chevron-down text-indigo-400'
                      : 'fa-chevron-right text-slate-400'
                  "
                ></i>
              </button>
              <span
                class="w-8 h-8 rounded-xl border flex items-center justify-center font-bold text-xs shrink-0"
                :class="
                  r.code === 'superadmin'
                    ? 'bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-300'
                    : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
                "
              >
                <i
                  class="fa-solid"
                  :class="r.code === 'superadmin' ? 'fa-crown' : 'fa-id-badge'"
                ></i>
              </span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="font-bold text-white text-sm sm:text-base">{{ r.name }}</h4>
                  <code
                    class="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono"
                    :class="r.code === 'superadmin' ? 'text-fuchsia-300' : 'text-amber-300'"
                  >
                    {{ r.code }}
                  </code>
                  <span
                    class="px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-[10px] text-emerald-300 font-semibold"
                  >
                    <i class="fa-solid fa-circle-check text-emerald-400 mr-1"></i>
                    {{ getActivePermsCount(r) }} permiso(s) activo(s)
                  </span>
                </div>
                <p class="text-xs text-slate-400 mt-0.5">{{ r.description || 'Sin descripción' }}</p>
              </div>
            </div>

            <!-- Usuarios asignados al Rol -->
            <div class="flex flex-wrap items-center gap-1.5 pl-9">
              <span class="text-[11px] text-slate-400 mr-1">
                <i class="fa-solid fa-users text-indigo-400 mr-1"></i>Usuarios ({{
                  getAssignedUsersForRole(r).length
                }}):
              </span>
              <template v-if="getAssignedUsersForRole(r).length > 0">
                <span
                  v-for="u in getAssignedUsersForRole(r)"
                  :key="u.id"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[11px] text-slate-300 font-mono"
                >
                  <i class="fa-solid fa-user text-[9px] text-indigo-400"></i>@{{ u.username }}
                </span>
              </template>
              <span v-else class="text-[11px] text-slate-500 italic">Sin usuarios asignados</span>
            </div>
          </div>

          <!-- Botones de Acción del Rol -->
          <div class="flex flex-wrap items-center gap-2" @click.stop>
            <button
              @click="togglePermRoleCard(r.id)"
              class="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold flex items-center gap-1.5"
            >
              <i class="fa-solid fa-sliders text-indigo-400"></i>
              <span>{{ isRoleExpanded(r.id) ? 'Minimizar' : 'Abrir Permisos' }}</span>
            </button>
            <span
              v-if="r.code === 'superadmin'"
              class="px-3 py-1.5 rounded-xl bg-fuchsia-950/40 text-fuchsia-300 border border-fuchsia-800/40 text-xs font-semibold"
            >
              <i class="fa-solid fa-shield-halved mr-1"></i>Rol Único (Acceso Total)
            </span>
            <template v-else-if="canEdit">
              <button
                @click="openRoleModal(r.id)"
                class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold"
              >
                <i class="fa-solid fa-pen mr-1"></i>Editar Rol
              </button>
              <button
                @click="saveRoleCardPermissions(r.id)"
                class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
              >
                <i class="fa-solid fa-floppy-disk"></i> Guardar Permisos
              </button>
              <button
                v-if="canDelete"
                @click="deleteRoleItem(r.id, r.name)"
                class="px-2.5 py-1.5 rounded-xl bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-xs font-semibold"
                title="Eliminar Rol"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </template>
          </div>
        </div>

        <!-- Cuerpo Desplegable con Módulos, Sub-Servicios y Servicios Independientes -->
        <div v-if="isRoleExpanded(r.id)" class="pt-4 mt-4 border-t border-slate-800">
          <PermissionMatrixSelector
            v-if="rolePermissionDrafts[r.id]"
            v-model="rolePermissionDrafts[r.id]"
            :locked="r.code === 'superadmin' || !canEdit"
          />
        </div>
      </div>
    </div>

    <!-- Panel Informativo de Archivos Ignorados (Siempre Activos para Todos) -->
    <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <i class="fa-solid fa-circle-check text-emerald-400"></i> Módulos y Servicios Ignorados
            en RBAC (Habilitados para Todos)
          </h4>
          <p class="text-[11px] text-slate-400 mt-0.5">
            Configurados en <code class="text-amber-300">src/config/permissions.ignore.json</code>.
            Cualquier servicio listado aquí queda activo para todos los usuarios autenticados y no
            requiere interruptor.
          </p>
        </div>
        <span
          class="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400"
        >
          src/config/permissions.ignore.json
        </span>
      </div>

      <div class="flex flex-wrap gap-2 pt-1">
        <span
          v-for="m in catalog.ignoreConfig.ignoredModules"
          :key="`mod-${m}`"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300"
        >
          <i class="fa-solid fa-folder text-indigo-400"></i>
          <span>
            Módulo base: <code class="text-indigo-300 font-mono">src/modules/{{ m }}</code>
          </span>
          <i class="fa-solid fa-circle-check text-emerald-400 ml-1" title="Activo para todos"></i>
        </span>

        <span
          v-for="s in catalog.ignoreConfig.ignoredServices"
          :key="`svc-${s}`"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300"
        >
          <i class="fa-solid fa-file-code text-amber-400"></i>
          <span>
            Servicio global: <code class="text-amber-300 font-mono">src/services/{{ s }}</code>
          </span>
          <i class="fa-solid fa-circle-check text-emerald-400 ml-1" title="Activo para todos"></i>
        </span>
      </div>
    </div>
  </section>
</template>
