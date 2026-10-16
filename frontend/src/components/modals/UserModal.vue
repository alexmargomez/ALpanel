<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiFetch,
  buildPermissionMapFromRole,
  loadUsersAndRoles,
  panelStore,
  serializePermissionMap,
  showToast,
} from '../../composables/usePanelStore';
import PermissionMatrixSelector from '../common/PermissionMatrixSelector.vue';

const fullName = ref('');
const username = ref('');
const selectedRoleId = ref<number>(0);
const password = ref('');
const permissionDraft = ref<Record<string, boolean>>({});
const isSuperEditing = ref(false);

const editingUser = computed(() => {
  if (!panelStore.modals.user.userId) return null;
  return panelStore.users.find((u) => u.id === panelStore.modals.user.userId) || null;
});

const selectableRoles = computed(() => {
  if (isSuperEditing.value) {
    return panelStore.roles.filter((r) => r.code === 'superadmin');
  }
  return panelStore.roles.filter((r) => r.code !== 'superadmin');
});

const selectedRoleObj = computed(() =>
  panelStore.roles.find((r) => r.id === Number(selectedRoleId.value))
);

function syncPermissionDraftFromSelectedRole(): void {
  const r = selectedRoleObj.value;
  permissionDraft.value = buildPermissionMapFromRole(
    r?.permissions || [],
    false,
    Boolean(r?.code === 'superadmin' || isSuperEditing.value)
  );
}

watch(
  () => panelStore.modals.user.open,
  (isOpen) => {
    if (!isOpen) return;
    const u = editingUser.value;
    if (u) {
      isSuperEditing.value = u.role === 'superadmin' || u.username === 'superadmin';
      fullName.value = u.fullName || '';
      username.value = u.username || '';
      if (isSuperEditing.value) {
        const superRole = panelStore.roles.find((r) => r.code === 'superadmin');
        selectedRoleId.value = superRole?.id || u.roleId || 0;
      } else {
        selectedRoleId.value =
          u.roleId || panelStore.roles.find((r) => r.code !== 'superadmin')?.id || 0;
      }
      password.value = '';
    } else {
      isSuperEditing.value = false;
      fullName.value = '';
      username.value = '';
      selectedRoleId.value =
        panelStore.roles.find((r) => r.code !== 'superadmin')?.id || 0;
      password.value = '';
    }
    syncPermissionDraftFromSelectedRole();
  }
);

function close(): void {
  panelStore.modals.user.open = false;
}

async function handleSubmit(): Promise<void> {
  const id = panelStore.modals.user.userId;
  const payload = {
    fullName: fullName.value.trim(),
    username: username.value.trim(),
    roleId: Number(selectedRoleId.value),
    password: password.value,
    rolePermissions: isSuperEditing.value
      ? undefined
      : serializePermissionMap(permissionDraft.value),
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
    close();
    await loadUsersAndRoles();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.user.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin"
    >
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <h3 class="text-sm font-bold text-white">
          <i
            class="fa-solid text-indigo-400 mr-2"
            :class="editingUser ? 'fa-user-pen' : 'fa-user-plus'"
          ></i>
          {{
            editingUser
              ? `Editar Usuario (@${editingUser.username})`
              : 'Crear Nuevo Usuario'
          }}
        </h3>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-3.5 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Nombre Completo</label>
            <input
              v-model="fullName"
              type="text"
              placeholder="ej. Alex Gómez"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Usuario (username)</label>
            <input
              v-model="username"
              :disabled="isSuperEditing"
              type="text"
              placeholder="ej. alexmar"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-60"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Rol Asignado</label>
            <select
              v-model="selectedRoleId"
              :disabled="isSuperEditing"
              @change="syncPermissionDraftFromSelectedRole"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500 disabled:opacity-60"
            >
              <option v-for="r in selectableRoles" :key="r.id" :value="r.id">
                {{
                  isSuperEditing
                    ? 'Super Administrador (superadmin) — Rol Único'
                    : `${r.name} (${r.code})`
                }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">
              {{
                editingUser
                  ? 'Nueva Contraseña (Opcional — vacía para conservar actual)'
                  : 'Contraseña (mín. 6 caracteres, hash scrypt)'
              }}
            </label>
            <input
              v-model="password"
              type="password"
              placeholder="••••••••"
              :required="!editingUser"
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <!-- Matriz de Permisos por Módulo del Rol seleccionado -->
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div class="flex items-center justify-between">
            <div>
              <span class="font-bold text-slate-200 flex items-center gap-1.5">
                <i class="fa-solid fa-key text-amber-400"></i> Permisos por Módulo del Rol
                Seleccionado
              </span>
              <p class="text-[11px] text-slate-400">
                Puedes ajustar aquí mismo qué módulos y acciones permite este rol.
              </p>
            </div>
            <span
              class="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold"
            >
              {{
                selectedRoleObj
                  ? `Rol: ${selectedRoleObj.name} (${selectedRoleObj.code})`
                  : 'RBAC'
              }}
            </span>
          </div>

          <PermissionMatrixSelector
            v-model="permissionDraft"
            :locked="isSuperEditing"
          />
        </div>

        <div class="pt-2 flex justify-end gap-2">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
          >
            <i class="fa-solid fa-floppy-disk mr-1"></i> Guardar Usuario y Permisos
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
