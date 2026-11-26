<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  apiFetch,
  enqueueBackgroundTask,
  loadServers,
  openAddServerModal,
  panelStore,
  showToast,
} from '../composables/usePanelStore';
import { formatBytes } from '../services/api';
import type { RemoteContainerItem, ServerNodePublic } from '../types/panel';

const probingId = ref('');
const loadingContainersId = ref('');
const expandedServerId = ref('');
const serverContainersMap = reactive<Record<string, RemoteContainerItem[]>>({});

const showCredForm = ref(false);
const savingCred = ref(false);
const credForm = reactive({
  name: '',
  provider: 'github' as 'github' | 'gitlab' | 'generic',
  username: '',
  token: '',
});

const onlineCount = computed(
  () => panelStore.servers.filter((s) => s.status === 'online').length
);

const dockerReadyCount = computed(
  () => panelStore.servers.filter((s) => Boolean(s.metrics?.dockerVersion)).length
);

async function probeServer(srv: ServerNodePublic): Promise<void> {
  probingId.value = srv.id;
  try {
    const res = await apiFetch<{ server: ServerNodePublic }>(
      `/api/servers/${encodeURIComponent(srv.id)}/test`,
      { method: 'POST' }
    );
    await loadServers();
    if (res.server?.status === 'online') {
      showToast(`Conexión exitosa con ${srv.name}.`);
    } else {
      showToast(
        `Error conectando a ${srv.name}: ${res.server?.lastError || 'Sin respuesta'}`,
        true
      );
    }
  } catch (err: any) {
    showToast(`Error probando ${srv.name}: ${err.message}`, true);
  } finally {
    probingId.value = '';
  }
}

async function toggleServerContainers(srv: ServerNodePublic): Promise<void> {
  if (expandedServerId.value === srv.id) {
    expandedServerId.value = '';
    return;
  }
  expandedServerId.value = srv.id;
  loadingContainersId.value = srv.id;
  try {
    const res = await apiFetch<{ containers: RemoteContainerItem[] }>(
      `/api/servers/${encodeURIComponent(srv.id)}/containers`
    );
    serverContainersMap[srv.id] = res.containers || [];
  } catch (err: any) {
    showToast(`No se pudieron listar contenedores de ${srv.name}: ${err.message}`, true);
    serverContainersMap[srv.id] = [];
  } finally {
    loadingContainersId.value = '';
  }
}

function provisionNode(srv: ServerNodePublic): void {
  if (
    !confirm(
      `¿Instalar/verificar Docker Engine, Docker Compose, Git y Caddy en "${srv.name}" (${srv.host})?`
    )
  ) {
    return;
  }
  enqueueBackgroundTask({
    title: `Preparando Nodo — ${srv.name}`,
    projectName: srv.name,
    action: 'provision',
    runningMessage: `Instalando Docker, Compose y Caddy vía SSH en ${srv.host}...`,
    taskFn: () =>
      apiFetch(`/api/servers/${encodeURIComponent(srv.id)}/provision`, {
        method: 'POST',
      }),
    onComplete: async () => {
      await loadServers();
    },
  });
}

async function deleteServer(srv: ServerNodePublic): Promise<void> {
  if (srv.isLocal) return;
  if (!confirm(`¿Desconectar y eliminar el servidor "${srv.name}" (${srv.host}) de ALpanel?`)) {
    return;
  }
  try {
    await apiFetch(`/api/servers/${encodeURIComponent(srv.id)}`, {
      method: 'DELETE',
    });
    showToast(`Servidor "${srv.name}" eliminado.`);
    await loadServers();
  } catch (err: any) {
    showToast(`Error eliminando servidor: ${err.message}`, true);
  }
}

async function saveGitCredential(): Promise<void> {
  if (!credForm.name.trim() || !credForm.token.trim()) {
    showToast('Nombre y token PAT son obligatorios.', true);
    return;
  }
  savingCred.value = true;
  try {
    await apiFetch('/api/servers/git-credentials', {
      method: 'POST',
      body: JSON.stringify({
        label: credForm.name.trim(),
        provider: credForm.provider,
        username: credForm.username.trim(),
        token: credForm.token.trim(),
      }),
    });
    credForm.name = '';
    credForm.username = '';
    credForm.token = '';
    showCredForm.value = false;
    await loadServers();
    showToast('Credencial Git guardada en la bóveda cifrada.');
  } catch (err: any) {
    showToast(`Error guardando credencial: ${err.message}`, true);
  } finally {
    savingCred.value = false;
  }
}

async function deleteGitCredential(id: string, name: string): Promise<void> {
  if (!confirm(`¿Eliminar la credencial Git "${name}"?`)) return;
  try {
    await apiFetch(`/api/servers/git-credentials/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    await loadServers();
    showToast(`Credencial "${name}" eliminada.`);
  } catch (err: any) {
    showToast(`Error eliminando credencial: ${err.message}`, true);
  }
}

onMounted(() => {
  loadServers();
});
</script>

<template>
  <section class="space-y-5">
    <!-- Encabezado y KPIs -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold text-white flex items-center gap-2">
          <i class="fa-solid fa-server text-indigo-400"></i>
          <span>Servidores &amp; Nodos Multi-VPS</span>
        </h2>
        <p class="text-xs text-slate-400">
          Conecta servidores VPS adicionales por SSH para desplegar proyectos, enlazar contenedores remotos o distribuir dominios.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="loadServers"
          class="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <i class="fa-solid fa-rotate text-[11px]"></i>
          <span>Actualizar</span>
        </button>
        <button
          @click="openAddServerModal(null)"
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
        >
          <i class="fa-solid fa-plus text-[11px]"></i>
          <span>Conectar Servidor</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div class="text-[11px] text-slate-400 font-medium">Nodos Registrados</div>
        <div class="text-2xl font-bold text-white mt-1">{{ panelStore.servers.length }}</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div class="text-[11px] text-slate-400 font-medium">Nodos en Línea</div>
        <div class="text-2xl font-bold text-emerald-400 mt-1">{{ onlineCount }}</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div class="text-[11px] text-slate-400 font-medium">Docker Activo</div>
        <div class="text-2xl font-bold text-indigo-400 mt-1">{{ dockerReadyCount }}</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
        <div class="text-[11px] text-slate-400 font-medium">Credenciales Git</div>
        <div class="text-2xl font-bold text-violet-400 mt-1">
          {{ panelStore.gitCredentials.length }}
        </div>
      </div>
    </div>

    <!-- Tarjetas de Servidores -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div
        v-for="srv in panelStore.servers"
        :key="srv.id"
        class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5 transition hover:border-slate-700"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              :class="
                srv.isLocal
                  ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                  : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
              "
            >
              <i
                class="fa-solid"
                :class="srv.isLocal ? 'fa-house-laptop' : 'fa-server'"
              ></i>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-sm font-bold text-white truncate">{{ srv.name }}</h3>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                  :class="
                    srv.status === 'online'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : srv.status === 'offline'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  "
                >
                  {{ srv.status === 'online' ? 'ONLINE' : srv.status === 'offline' ? 'OFFLINE' : 'SIN VERIFICAR' }}
                </span>
                <span
                  v-if="srv.isLocal"
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                >
                  CENTRAL
                </span>
              </div>
              <div class="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                {{ srv.isLocal ? (panelStore.host.publicIp || srv.host) : `${srv.sshUser}@${srv.host}:${srv.sshPort}` }}
                <span v-if="srv.privateIp" class="text-slate-500"> · VPN {{ srv.privateIp }}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              @click="probeServer(srv)"
              :disabled="probingId === srv.id"
              class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition flex items-center gap-1.5"
              title="Probar conexión y refrescar métricas"
            >
              <i
                class="fa-solid"
                :class="probingId === srv.id ? 'fa-spinner fa-spin' : 'fa-heart-pulse text-emerald-400'"
              ></i>
              <span>Probar</span>
            </button>
            <button
              v-if="!srv.isLocal"
              @click="openAddServerModal(srv)"
              class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Editar servidor"
            >
              <i class="fa-solid fa-pen text-[11px]"></i>
            </button>
            <button
              v-if="!srv.isLocal"
              @click="deleteServer(srv)"
              class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center transition"
              title="Eliminar servidor"
            >
              <i class="fa-solid fa-trash text-[11px]"></i>
            </button>
          </div>
        </div>

        <p v-if="srv.description" class="text-[11px] text-slate-400">
          {{ srv.description }}
        </p>

        <div
          v-if="srv.lastError"
          class="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-300 font-mono"
        >
          {{ srv.lastError }}
        </div>

        <!-- Badges de Stack del Nodo -->
        <div class="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
          <span class="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
            <i class="fa-solid fa-folder text-slate-500 mr-1"></i>{{ srv.projectsRoot }}
          </span>
          <span
            v-if="srv.metrics?.dockerVersion"
            class="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-300"
          >
            <i class="fa-brands fa-docker mr-1"></i>{{ srv.metrics.dockerVersion }}
          </span>
          <span
            v-if="srv.metrics?.caddyStatus"
            class="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
          >
            <i class="fa-solid fa-shield-halved mr-1"></i>Caddy: {{ srv.metrics.caddyStatus }}
          </span>
          <span
            v-else-if="srv.hasCaddy"
            class="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400"
          >
            Caddy: Pendiente
          </span>
          <span
            v-if="srv.metrics?.osName"
            class="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400"
          >
            {{ srv.metrics.osName }}
          </span>
        </div>

        <!-- Telemetría del Nodo -->
        <div
          v-if="srv.metrics"
          class="grid grid-cols-3 gap-2.5 pt-1"
        >
          <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
            <div class="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>CPU ({{ srv.metrics.cpuCores }}c)</span>
              <span class="font-bold text-white">{{ srv.metrics.cpuUsagePercent }}%</span>
            </div>
            <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-indigo-500 rounded-full"
                :style="{ width: `${Math.min(100, srv.metrics.cpuUsagePercent)}%` }"
              ></div>
            </div>
          </div>
          <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
            <div class="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>RAM</span>
              <span class="font-bold text-white">{{ srv.metrics.ramPercent }}%</span>
            </div>
            <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-emerald-500 rounded-full"
                :style="{ width: `${Math.min(100, srv.metrics.ramPercent)}%` }"
              ></div>
            </div>
            <div class="text-[9px] text-slate-500 mt-1 truncate">
              {{ srv.metrics.ramUsedMb }} MB / {{ srv.metrics.ramTotalMb }} MB
            </div>
          </div>
          <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5">
            <div class="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Disco</span>
              <span class="font-bold text-white">{{ srv.metrics.diskPercent }}%</span>
            </div>
            <div class="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-amber-500 rounded-full"
                :style="{ width: `${Math.min(100, srv.metrics.diskPercent)}%` }"
              ></div>
            </div>
            <div class="text-[9px] text-slate-500 mt-1 truncate">
              {{ srv.metrics.diskUsedGb }} GB / {{ srv.metrics.diskTotalGb }} GB
            </div>
          </div>
        </div>

        <!-- Acciones Inferiores del Nodo -->
        <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
          <button
            @click="toggleServerContainers(srv)"
            class="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-brands fa-docker text-sky-400"></i>
            <span>{{ expandedServerId === srv.id ? 'Ocultar Contenedores' : 'Ver Contenedores' }}</span>
          </button>

          <button
            v-if="!srv.isLocal"
            @click="provisionNode(srv)"
            class="px-3 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-[11px] font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <span>Preparar Nodo (Docker/Caddy)</span>
          </button>
        </div>

        <!-- Lista Desplegable de Contenedores del Nodo -->
        <div
          v-if="expandedServerId === srv.id"
          class="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2"
        >
          <div v-if="loadingContainersId === srv.id" class="text-xs text-slate-400 py-2">
            <i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Consultando Docker en {{ srv.name }}...
          </div>
          <div
            v-else-if="(serverContainersMap[srv.id] || []).length === 0"
            class="text-xs text-slate-500 py-1"
          >
            No se encontraron contenedores Docker en este servidor.
          </div>
          <div
            v-else
            class="max-h-56 overflow-y-auto divide-y divide-slate-800/80"
          >
            <div
              v-for="c in serverContainersMap[srv.id]"
              :key="c.id"
              class="py-2 flex items-center justify-between gap-2 text-[11px]"
            >
              <div class="min-w-0">
                <div class="font-mono font-semibold text-white truncate">
                  {{ c.name }}
                </div>
                <div class="text-[10px] text-slate-400 truncate">
                  {{ c.image }}
                  <span v-if="c.ports" class="text-indigo-400 ml-1">· {{ c.ports }}</span>
                </div>
              </div>
              <span
                class="px-2 py-0.5 rounded-full text-[9px] font-bold shrink-0"
                :class="
                  c.state === 'running'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-slate-800 text-slate-400'
                "
              >
                {{ c.state }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bóveda de Credenciales Git (GitHub / GitLab) -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <i class="fa-brands fa-git-alt text-amber-400"></i>
            <span>Bóveda de Credenciales Git (GitHub / GitLab PAT)</span>
          </h3>
          <p class="text-[11px] text-slate-400">
            Guarda Personal Access Tokens cifrados para clonar repositorios privados al crear proyectos o agregar contenedores.
          </p>
        </div>
        <button
          @click="showCredForm = !showCredForm"
          class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition flex items-center gap-1.5"
        >
          <i class="fa-solid" :class="showCredForm ? 'fa-xmark' : 'fa-key'"></i>
          <span>{{ showCredForm ? 'Cerrar' : 'Agregar Credencial Git' }}</span>
        </button>
      </div>

      <form
        v-if="showCredForm"
        @submit.prevent="saveGitCredential"
        class="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800"
      >
        <input
          v-model="credForm.name"
          type="text"
          placeholder="Alias (Ej: GitHub Empresa)"
          required
          class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        />
        <select
          v-model="credForm.provider"
          class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="generic">Otro Git HTTPS</option>
        </select>
        <input
          v-model="credForm.username"
          type="text"
          placeholder="Usuario (opcional, ej: oauth2)"
          class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        />
        <div class="flex gap-2">
          <input
            v-model="credForm.token"
            type="password"
            placeholder="Personal Access Token *"
            required
            class="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            :disabled="savingCred"
            class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0"
          >
            {{ savingCred ? '...' : 'Guardar' }}
          </button>
        </div>
      </form>

      <div
        v-if="panelStore.gitCredentials.length === 0"
        class="text-xs text-slate-500 py-2"
      >
        No hay tokens Git privados registrados todavía.
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="cred in panelStore.gitCredentials"
          :key="cred.id"
          class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-2"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <i
                class="fa-brands text-sm"
                :class="
                  cred.provider === 'github'
                    ? 'fa-github text-white'
                    : cred.provider === 'gitlab'
                      ? 'fa-gitlab text-orange-400'
                      : 'fa-git-alt text-indigo-400'
                "
              ></i>
              <span class="text-xs font-bold text-white truncate">{{ cred.label }}</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
              {{ cred.username || 'token-auth' }} · {{ cred.provider.toUpperCase() }}
            </div>
          </div>
          <button
            @click="deleteGitCredential(cred.id, cred.label)"
            class="w-7 h-7 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center transition shrink-0"
            title="Eliminar credencial"
          >
            <i class="fa-solid fa-trash text-[11px]"></i>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
