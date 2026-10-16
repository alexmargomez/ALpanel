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

const name = ref('');
const code = ref('');
const description = ref('');
const permissionDraft = ref<Record<string, boolean>>({});

const editingRole = computed(() => {
  if (!panelStore.modals.role.roleId) return null;
  return panelStore.roles.find((r) => r.id === panelStore.modals.role.roleId) || null;
});

watch(
  () => panelStore.modals.role.open,
  (isOpen) => {
    if (!isOpen) return;
    const r = editingRole.value;
    if (r) {
      name.value = r.name || '';
      code.value = r.code || '';
      description.value = r.description || '';
      permissionDraft.value = buildPermissionMapFromRole(r.permissions || [], false, false);
    } else {
      name.value = '';
      code.value = '';
      description.value = '';
      permissionDraft.value = buildPermissionMapFromRole([], true, false);
    }
  }
);

function close(): void {
  panelStore.modals.role.open = false;
}

async function handleSubmit(): Promise<void> {
  const id = panelStore.modals.role.roleId;
  const payload = {
    name: name.value.trim(),
    code: code.value.trim(),
    description: description.value.trim(),
    permissions: serializePermissionMap(permissionDraft.value),
  };

  try {
    if (id) {
      await apiFetch(`/api/roles/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Rol y servicios actualizados');
    } else {
      await apiFetch('/api/roles', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Nuevo rol creado con sus servicios');
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
    v-if="panelStore.modals.role.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin"
    >
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <h3 class="text-sm font-bold text-white">
          <i
            class="fa-solid text-amber-400 mr-2"
            :class="editingRole ? 'fa-pen-to-square' : 'fa-plus'"
          ></i>
          {{
            editingRole
              ? `Editar Rol y Servicios (${editingRole.code})`
              : 'Crear Nuevo Rol y Servicios'
          }}
        </h3>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-3.5 text-xs">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Nombre del Rol</label>
            <input
              v-model="name"
              type="text"
              placeholder="ej. Soporte Técnico"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Código identificador (sin espacios)</label>
            <input
              v-model="code"
              type="text"
              placeholder="ej. soporte"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-slate-400 mb-1">Descripción del Rol</label>
          <input
            v-model="description"
            type="text"
            placeholder="Describe las responsabilidades de este rol..."
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div>
            <span class="font-bold text-slate-200 flex items-center gap-1.5">
              <i class="fa-solid fa-shield-halved text-amber-400"></i> Matriz de Permisos por Módulo
              (RBAC)
            </span>
            <p class="text-[11px] text-slate-400">
              Marca a qué módulos y acciones tiene acceso este rol.
            </p>
          </div>

          <PermissionMatrixSelector v-model="permissionDraft" />
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
            class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold"
          >
            <i class="fa-solid fa-floppy-disk mr-1"></i> Guardar Rol y Matriz RBAC
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
