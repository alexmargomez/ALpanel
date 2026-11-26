<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import {
  apiFetch,
  loadServers,
  panelStore,
  showToast,
} from '../../composables/usePanelStore';

const saving = ref(false);
const errorMsg = ref('');

const form = reactive({
  id: '',
  name: '',
  host: '',
  privateIp: '',
  sshPort: 22,
  sshUser: 'root',
  authType: 'key' as 'key' | 'password',
  secret: '',
  projectsRoot: '/opt/projects',
  caddyEnabled: true,
  description: '',
});

watch(
  () => panelStore.modals.addServer.open,
  (isOpen) => {
    if (!isOpen) return;
    errorMsg.value = '';
    const srv = panelStore.modals.addServer.server;
    if (srv) {
      form.id = srv.id;
      form.name = srv.name;
      form.host = srv.host;
      form.privateIp = srv.privateIp || '';
      form.sshPort = srv.sshPort || 22;
      form.sshUser = srv.sshUser || 'root';
      form.authType = srv.authType === 'password' ? 'password' : 'key';
      form.secret = '';
      form.projectsRoot = srv.projectsRoot || '/opt/projects';
      form.caddyEnabled = srv.hasCaddy;
      form.description = srv.description || '';
    } else {
      form.id = '';
      form.name = '';
      form.host = '';
      form.privateIp = '';
      form.sshPort = 22;
      form.sshUser = 'root';
      form.authType = 'key';
      form.secret = '';
      form.projectsRoot = '/opt/projects';
      form.caddyEnabled = true;
      form.description = '';
    }
  }
);

function close(): void {
  panelStore.modals.addServer.open = false;
  panelStore.modals.addServer.server = null;
}

async function submit(): Promise<void> {
  errorMsg.value = '';
  if (!form.name.trim() || !form.host.trim()) {
    errorMsg.value = 'El nombre del servidor y la IP/Host son obligatorios.';
    return;
  }
  if (!form.id && !form.secret.trim()) {
    errorMsg.value =
      form.authType === 'key'
        ? 'Pega la llave privada SSH para conectar el nodo.'
        : 'Ingresa la contraseña SSH del servidor remoto.';
    return;
  }

  saving.value = true;
  try {
    const payload = {
      id: form.id || undefined,
      name: form.name.trim(),
      host: form.host.trim(),
      privateIp: form.privateIp.trim(),
      sshPort: Number(form.sshPort) || 22,
      sshUser: form.sshUser.trim() || 'root',
      authType: form.authType,
      secret: form.secret.trim() || undefined,
      projectsRoot: form.projectsRoot.trim() || '/opt/projects',
      hasCaddy: form.caddyEnabled,
      description: form.description.trim(),
    };

    const res = await apiFetch<{ server: { id: string } }>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (form.id) {
      showToast(`Servidor "${form.name}" actualizado.`);
    } else {
      showToast(`Servidor "${form.name}" registrado. Verificando conexión SSH...`);
      if (res?.server?.id) {
        await apiFetch(
          `/api/servers/${encodeURIComponent(res.server.id)}/test`,
          { method: 'POST' }
        ).catch(() => {});
      }
    }

    await loadServers();
    close();
  } catch (err: any) {
    errorMsg.value = err.message || 'No se pudo guardar el servidor.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.addServer.open"
    class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <div
        class="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 flex items-center justify-center"
          >
            <i class="fa-solid fa-server text-sm"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white">
              {{ form.id ? 'Editar Servidor Remoto' : 'Conectar Nuevo Servidor VPS' }}
            </h3>
            <p class="text-[11px] text-slate-400">
              Conexión segura vía SSH con credenciales cifradas AES-256-GCM
            </p>
          </div>
        </div>
        <button
          @click="close"
          class="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <form
        @submit.prevent="submit"
        class="p-5 overflow-y-auto space-y-4 text-xs"
      >
        <div
          v-if="errorMsg"
          class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2"
        >
          <i class="fa-solid fa-circle-exclamation"></i>
          <span>{{ errorMsg }}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label class="block text-[11px] font-semibold text-slate-300 mb-1">
              Nombre del Nodo *
            </label>
            <input
              v-model="form.name"
              type="text"
              placeholder="Ej: VPS-Workers-01, Nodo-DB-Europa"
              required
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-[11px] font-semibold text-slate-300 mb-1">
              IP Pública o Hostname *
            </label>
            <input
              v-model="form.host"
              type="text"
              placeholder="Ej: 185.211.10.45 o vps2.midominio.com"
              required
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-[11px] font-semibold text-slate-300 mb-1">
              IP Privada / WireGuard (Opcional)
            </label>
            <input
              v-model="form.privateIp"
              type="text"
              placeholder="Ej: 10.10.0.2"
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                Usuario SSH
              </label>
              <input
                v-model="form.sshUser"
                type="text"
                placeholder="root"
                class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                Puerto SSH
              </label>
              <input
                v-model.number="form.sshPort"
                type="number"
                min="1"
                max="65535"
                class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
              />
            </div>
          </div>
        </div>

        <!-- Tipo de Autenticación -->
        <div class="space-y-2">
          <label class="block text-[11px] font-semibold text-slate-300">
            Método de Autenticación SSH
          </label>
          <div class="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              @click="form.authType = 'key'"
              class="px-3 py-2.5 rounded-xl border text-left transition flex items-center gap-2.5"
              :class="
                form.authType === 'key'
                  ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              "
            >
              <i class="fa-solid fa-key text-sm"></i>
              <div>
                <div class="font-bold text-xs">Llave Privada SSH</div>
                <div class="text-[10px] opacity-80">Ed25519 / RSA (Recomendado)</div>
              </div>
            </button>

            <button
              type="button"
              @click="form.authType = 'password'"
              class="px-3 py-2.5 rounded-xl border text-left transition flex items-center gap-2.5"
              :class="
                form.authType === 'password'
                  ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              "
            >
              <i class="fa-solid fa-lock text-sm"></i>
              <div>
                <div class="font-bold text-xs">Contraseña SSH</div>
                <div class="text-[10px] opacity-80">Cifrada en bóveda AES-256</div>
              </div>
            </button>
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-slate-300 mb-1">
            {{
              form.authType === 'key'
                ? 'Llave Privada SSH (PEM / OpenSSH)'
                : 'Contraseña SSH'
            }}
            <span v-if="form.id" class="text-slate-500 font-normal">
              (dejar vacío para conservar la actual)
            </span>
          </label>
          <textarea
            v-if="form.authType === 'key'"
            v-model="form.secret"
            rows="4"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
            class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-[11px] text-emerald-300 font-mono focus:outline-none"
          ></textarea>
          <input
            v-else
            v-model="form.secret"
            type="password"
            placeholder="••••••••••••••"
            class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label class="block text-[11px] font-semibold text-slate-300 mb-1">
              Directorio Raíz de Proyectos
            </label>
            <input
              v-model="form.projectsRoot"
              type="text"
              placeholder="/opt/projects"
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[11px] font-semibold text-slate-300 mb-1">
              Descripción / Rol del Nodo
            </label>
            <input
              v-model="form.description"
              type="text"
              placeholder="Ej: Microservicios de facturación y workers"
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
            />
          </div>
        </div>

        <label
          class="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800 cursor-pointer"
        >
          <input
            v-model="form.caddyEnabled"
            type="checkbox"
            class="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500"
          />
          <div>
            <div class="text-xs font-semibold text-white">
              Habilitar Caddy Proxy Independiente en este servidor
            </div>
            <div class="text-[10px] text-slate-400">
              Permite emitir certificados SSL y administrar dominios propios directamente en este VPS.
            </div>
          </div>
        </label>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="saving"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <i
              class="fa-solid"
              :class="saving ? 'fa-spinner fa-spin' : 'fa-plug-circle-check'"
            ></i>
            <span>{{ form.id ? 'Guardar Cambios' : 'Conectar Servidor' }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
