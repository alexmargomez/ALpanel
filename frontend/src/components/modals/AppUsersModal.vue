<script setup lang="ts">
import { ref, watch } from 'vue';
import { apiFetch, panelStore, showToast } from '../../composables/usePanelStore';
import type { AppUserRecord, ProjectUsersDiscoveryResult } from '../../types/panel';

const loading = ref(false);
const errorMsg = ref('');
const discovery = ref<ProjectUsersDiscoveryResult | null>(null);

const editId = ref('');
const username = ref('');
const email = ref('');
const role = ref('admin');
const password = ref('');

function resetForm(): void {
  editId.value = '';
  username.value = '';
  email.value = '';
  role.value = 'admin';
  password.value = '';
}

function prefillUser(u: AppUserRecord): void {
  editId.value = String(u.id);
  username.value = u.username || '';
  email.value = u.email || '';
  role.value = u.role || 'admin';
  password.value = '';
}

async function fetchAppUsers(): Promise<void> {
  const proj = panelStore.modals.appUsers.projectName;
  if (!proj) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    const data = await apiFetch<ProjectUsersDiscoveryResult>(
      `/api/projects/${encodeURIComponent(proj)}/app-users`
    );
    discovery.value = data;
  } catch (err: any) {
    errorMsg.value = err.message || 'Error consultando base de datos del proyecto';
  } finally {
    loading.value = false;
  }
}

watch(
  () => panelStore.modals.appUsers.open,
  (isOpen) => {
    if (isOpen) {
      resetForm();
      fetchAppUsers();
    }
  }
);

function close(): void {
  panelStore.modals.appUsers.open = false;
}

async function handleSubmit(): Promise<void> {
  const proj = panelStore.modals.appUsers.projectName;
  if (!proj) return;

  try {
    const res = await apiFetch<{ message: string }>(
      `/api/projects/${encodeURIComponent(proj)}/app-users`,
      {
        method: 'POST',
        body: JSON.stringify({
          id: editId.value.trim() || undefined,
          username: username.value.trim(),
          email: email.value.trim(),
          role: role.value,
          password: password.value,
          isActive: true,
        }),
      }
    );
    showToast(res.message || 'Usuario guardado');
    resetForm();
    await fetchAppUsers();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}

async function deleteAppUser(userId: string, uname: string): Promise<void> {
  const proj = panelStore.modals.appUsers.projectName;
  if (!proj) return;
  if (
    !confirm(
      `¿Seguro que deseas eliminar al usuario "${uname}" (#${userId}) de la base de datos de ${proj}?`
    )
  ) {
    return;
  }
  try {
    const res = await apiFetch<{ message: string }>(
      `/api/projects/${encodeURIComponent(proj)}/app-users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    showToast(res.message || 'Usuario eliminado');
    await fetchAppUsers();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.appUsers.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-thin space-y-4"
    >
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center text-base"
          >
            <i class="fa-solid fa-users-rectangle"></i>
          </div>
          <div>
            <h3 class="text-base font-bold text-white">
              Usuarios Internos — {{ panelStore.modals.appUsers.projectName }}
            </h3>
            <p v-if="loading" class="text-xs text-slate-400">
              Consultando base de datos del proyecto...
            </p>
            <p v-else-if="discovery" class="text-xs text-slate-400">
              {{ discovery.engine }} • Tabla:
              <code class="text-sky-300 font-mono">{{ discovery.tableName }}</code> • Hash:
              <code class="text-emerald-300 font-mono">{{ discovery.hashAlgorithm }}</code>
            </p>
          </div>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div
        v-if="errorMsg"
        class="text-rose-400 bg-rose-950/30 border border-rose-800/40 rounded-xl p-3 text-xs"
      >
        ❌ {{ errorMsg }}
      </div>

      <div v-else-if="loading" class="text-slate-400 py-4 text-center text-xs">
        ⏳ Consultando usuarios en el contenedor de base de datos...
      </div>

      <template v-else-if="discovery">
        <div
          v-if="!discovery.supported"
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-400 text-xs"
        >
          <i class="fa-solid fa-circle-info text-amber-400 mr-1.5"></i>
          {{ discovery.message || 'Este proyecto no tiene tabla de usuarios estándar.' }}
        </div>

        <template v-else>
          <!-- Formulario para Crear / Editar Usuario dentro de la BD del Proyecto -->
          <form
            @submit.prevent="handleSubmit"
            class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
          >
            <div class="flex items-center justify-between">
              <span class="font-bold text-sky-300 flex items-center gap-1.5">
                <i
                  class="fa-solid"
                  :class="editId ? 'fa-user-pen text-amber-400' : 'fa-user-plus'"
                ></i>
                {{
                  editId
                    ? `Editando Usuario #${editId} (${username})`
                    : `Crear Nuevo Usuario en ${panelStore.modals.appUsers.projectName}`
                }}
              </span>
              <button
                v-if="editId"
                type="button"
                @click="resetForm"
                class="text-[11px] text-slate-400 hover:text-white"
              >
                <i class="fa-solid fa-rotate-left mr-1"></i>Cancelar edición
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
              <div>
                <label class="block text-slate-400 mb-1">Usuario / Login</label>
                <input
                  v-model="username"
                  type="text"
                  placeholder="ej. admin@zapatoca.com"
                  required
                  class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
                />
              </div>

              <div v-if="discovery.hasEmail">
                <label class="block text-slate-400 mb-1">Email (Opcional)</label>
                <input
                  v-model="email"
                  type="text"
                  placeholder="correo@dominio.com"
                  class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label class="block text-slate-400 mb-1">Rol en la App</label>
                <select
                  v-model="role"
                  class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="admin">admin / superuser</option>
                  <option value="staff">staff / editor</option>
                  <option value="user">user / estándar</option>
                </select>
              </div>

              <div>
                <label class="block text-slate-400 mb-1">
                  {{ editId ? 'Nueva Contraseña (Opcional)' : 'Contraseña (obligatoria)' }}
                </label>
                <input
                  v-model="password"
                  type="password"
                  placeholder="••••••••"
                  :required="!editId"
                  class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div class="flex justify-end pt-1">
              <button
                type="submit"
                class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold flex items-center gap-1.5 shadow-lg shadow-sky-600/20"
              >
                <i class="fa-solid fa-floppy-disk"></i>
                <span>{{ editId ? 'Guardar Cambios' : 'Crear Usuario en la BD' }}</span>
              </button>
            </div>
          </form>

          <!-- Listado de Usuarios registrados en la BD del Proyecto -->
          <div class="space-y-2">
            <div class="text-xs font-bold text-slate-300">
              Usuarios registrados en este proyecto:
            </div>
            <div
              v-if="discovery.users.length === 0"
              class="text-slate-500 italic py-2 text-xs"
            >
              No hay usuarios registrados en la tabla de este proyecto.
            </div>
            <div v-else class="space-y-2 text-xs">
              <div
                v-for="u in discovery.users"
                :key="u.id"
                class="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3"
              >
                <div class="flex items-center gap-2.5">
                  <span
                    class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono text-[10px]"
                  >
                    #{{ u.id }}
                  </span>
                  <span class="font-bold text-white font-mono text-xs">{{ u.username }}</span>
                  <span v-if="u.email" class="text-slate-400 text-[11px]">({{ u.email }})</span>
                  <span
                    class="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-semibold"
                  >
                    {{ u.role || 'admin' }}
                  </span>
                </div>

                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    @click="prefillUser(u)"
                    class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-semibold"
                  >
                    <i class="fa-solid fa-key mr-1"></i>Editar / Clave
                  </button>
                  <button
                    type="button"
                    @click="deleteAppUser(u.id, u.username)"
                    class="px-2.5 py-1 rounded-lg bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 border border-rose-800/50 text-[11px] font-semibold"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>

      <div class="flex justify-end pt-2 border-t border-slate-800">
        <button
          type="button"
          @click="close"
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
        >
          Cerrar
        </button>
      </div>
    </div>
  </div>
</template>
