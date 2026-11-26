<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  apiFetch,
  loadServers,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import type { RemoteContainerItem } from '../../types/panel';
import SearchableSelect from '../common/SearchableSelect.vue';

const sourceTab = ref<'git' | 'server' | 'image'>('git');
const submitting = ref(false);
const loadingRemoteContainers = ref(false);
const remoteContainers = ref<RemoteContainerItem[]>([]);

const form = reactive({
  serviceName: '',
  port: 3000,
  autoStart: true,
  // Git mode
  repoUrl: '',
  branch: '',
  gitCredentialId: '',
  // Server mode
  sourceServerId: '',
  sourceContainerName: '',
  transferMode: 'link' as 'link' | 'clone',
  openFirewallPort: true,
  // Image / Dockerfile mode
  image: 'node:20-alpine',
  dockerfileContent: '',
});

const serverOptions = computed(() =>
  panelStore.servers.map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: s.isLocal ? 'Nodo Local' : `${s.sshUser}@${s.host}:${s.sshPort}`,
    badge: s.status === 'online' ? 'ONLINE' : s.status.toUpperCase(),
  }))
);

const remoteContainerOptions = computed(() =>
  remoteContainers.value.map((c) => ({
    value: c.name,
    label: c.name,
    sublabel: `${c.image}${c.ports ? ` · ${c.ports}` : ''}`,
    badge: c.state === 'running' ? 'UP' : c.state.toUpperCase(),
  }))
);

const gitCredentialOptions = computed(() => [
  {
    value: '',
    label: 'Sin credencial (Repositorio público)',
    sublabel: 'Clonado directo',
  },
  ...panelStore.gitCredentials.map((c) => ({
    value: c.id,
    label: c.label,
    sublabel: `${c.provider.toUpperCase()} · ${c.username || 'token'}`,
  })),
]);

watch(
  () => panelStore.modals.addContainer.open,
  (isOpen) => {
    if (!isOpen) return;
    if (panelStore.servers.length === 0) {
      loadServers().catch(() => {});
    }
    const firstRemote = panelStore.servers.find((s) => !s.isLocal);
    if (!form.sourceServerId && firstRemote) {
      form.sourceServerId = firstRemote.id;
    } else if (!form.sourceServerId && panelStore.servers[0]) {
      form.sourceServerId = panelStore.servers[0].id;
    }
  }
);

watch(
  () => form.sourceServerId,
  async (srvId) => {
    if (!srvId || !panelStore.modals.addContainer.open) return;
    await fetchContainersForServer(srvId);
  }
);

async function fetchContainersForServer(srvId: string): Promise<void> {
  if (!srvId) return;
  loadingRemoteContainers.value = true;
  remoteContainers.value = [];
  form.sourceContainerName = '';
  try {
    const res = await apiFetch<{ containers: RemoteContainerItem[] }>(
      `/api/servers/${encodeURIComponent(srvId)}/containers`
    );
    remoteContainers.value = res.containers || [];
  } catch (err: any) {
    showToast(`Error consultando contenedores del servidor: ${err.message}`, true);
  } finally {
    loadingRemoteContainers.value = false;
  }
}

function onGitUrlInput(): void {
  if (form.serviceName.trim()) return;
  const match = /\/([^\/]+?)(?:\.git)?\/?$/.exec(form.repoUrl.trim());
  if (match && match[1]) {
    form.serviceName = match[1]
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-');
  }
}

function onRemoteContainerSelect(val: string): void {
  if (!val) return;
  if (!form.serviceName.trim()) {
    form.serviceName = val.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  }
  const found = remoteContainers.value.find((c) => c.name === val);
  if (found?.ports) {
    const portMatch = /:(\d+)->/.exec(found.ports);
    if (portMatch) {
      form.port = Number(portMatch[1]);
    }
  }
}

function close(): void {
  panelStore.modals.addContainer.open = false;
}

async function submit(): Promise<void> {
  const projectName = panelStore.modals.addContainer.projectName;
  if (!projectName) return;
  if (!form.serviceName.trim()) {
    showToast('Ingresa un nombre para el servicio/contenedor.', true);
    return;
  }

  submitting.value = true;
  try {
    const payload: Record<string, any> = {
      source: sourceTab.value,
      serviceName: form.serviceName.trim(),
      internalPort: String(Number(form.port) || 3000),
      autoStart: form.autoStart,
    };

    if (sourceTab.value === 'git') {
      if (!form.repoUrl.trim()) {
        showToast('Ingresa la URL del repositorio Git.', true);
        submitting.value = false;
        return;
      }
      payload.repoUrl = form.repoUrl.trim();
      payload.branch = form.branch.trim() || undefined;
      payload.gitCredentialId = form.gitCredentialId || undefined;
    } else if (sourceTab.value === 'server') {
      if (!form.sourceServerId || !form.sourceContainerName) {
        showToast('Selecciona un servidor origen y un contenedor.', true);
        submitting.value = false;
        return;
      }
      payload.sourceServerId = form.sourceServerId;
      payload.sourceContainerName = form.sourceContainerName;
      payload.sourcePort = String(Number(form.port) || 3000);
      payload.linkMode = form.transferMode;
      payload.applyFirewallRule = form.openFirewallPort;
      payload.syncGatewayEnvVar = true;
    } else {
      payload.image = form.image.trim();
      payload.dockerfileContent = form.dockerfileContent.trim() || undefined;
    }

    const res = await apiFetch<{ message?: string; output?: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/containers`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    showToast(res.message || `Contenedor "${form.serviceName}" integrado correctamente.`);
    form.serviceName = '';
    form.repoUrl = '';
    form.branch = '';
    form.sourceContainerName = '';
    form.dockerfileContent = '';
    close();
    await refreshAll();
  } catch (err: any) {
    showToast(`Error agregando contenedor: ${err.message}`, true);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.addContainer.open"
    class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <div
        class="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50"
      >
        <div>
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <i class="fa-brands fa-docker text-sky-400"></i>
            <span>
              Agregar Contenedor a {{ panelStore.modals.addContainer.projectName }}
            </span>
          </h3>
          <p class="text-[11px] text-slate-400">
            Integra un módulo desde GitHub/GitLab, enlaza un contenedor desde otro servidor o crea un servicio Docker.
          </p>
        </div>
        <button
          @click="close"
          class="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <!-- Tabs de Origen -->
      <div class="px-5 pt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          @click="sourceTab = 'git'"
          class="px-3 py-2 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1.5"
          :class="
            sourceTab === 'git'
              ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
          "
        >
          <i class="fa-brands fa-git-alt"></i>
          <span>GitHub / GitLab</span>
        </button>
        <button
          type="button"
          @click="sourceTab = 'server'"
          class="px-3 py-2 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1.5"
          :class="
            sourceTab === 'server'
              ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
          "
        >
          <i class="fa-solid fa-server"></i>
          <span>Otro Servidor</span>
        </button>
        <button
          type="button"
          @click="sourceTab = 'image'"
          class="px-3 py-2 rounded-xl border text-xs font-semibold transition flex items-center justify-center gap-1.5"
          :class="
            sourceTab === 'image'
              ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
          "
        >
          <i class="fa-solid fa-cube"></i>
          <span>Imagen / Dockerfile</span>
        </button>
      </div>

      <form
        @submit.prevent="submit"
        class="p-5 overflow-y-auto space-y-3.5 text-xs"
      >
        <!-- Campos comunes -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="sm:col-span-2">
            <label class="block text-slate-300 font-semibold mb-1">
              Nombre del Servicio / Contenedor *
            </label>
            <input
              v-model="form.serviceName"
              type="text"
              placeholder="Ej: ms-facturacion, worker-pdf, redis"
              required
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Puerto Interno / Destino
            </label>
            <input
              v-model.number="form.port"
              type="number"
              min="1"
              max="65535"
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
            />
          </div>
        </div>

        <!-- TAB 1: GIT -->
        <template v-if="sourceTab === 'git'">
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              URL del Repositorio (GitHub / GitLab) *
            </label>
            <input
              v-model="form.repoUrl"
              @input="onGitUrlInput"
              type="text"
              placeholder="https://github.com/org/microservicio.git"
              required
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-300 font-semibold mb-1">
                Rama (Opcional)
              </label>
              <input
                v-model="form.branch"
                type="text"
                placeholder="main"
                class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1">
                Credencial Git (Si es privado)
              </label>
              <SearchableSelect
                v-model="form.gitCredentialId"
                :options="gitCredentialOptions"
                placeholder="Repositorio público..."
              />
            </div>
          </div>

          <p class="text-[11px] text-slate-400 bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            Se clonará en <code class="text-emerald-300">services/{{ form.serviceName || 'servicio' }}</code>, se inyectará automáticamente en <code class="text-slate-200">docker-compose.yml</code> dentro de la red aislada del proyecto y quedará listo para operar.
          </p>
        </template>

        <!-- TAB 2: OTRO SERVIDOR -->
        <template v-else-if="sourceTab === 'server'">
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Servidor Origen *
            </label>
            <SearchableSelect
              v-model="form.sourceServerId"
              :options="serverOptions"
              placeholder="Seleccionar servidor conectado..."
              search-placeholder="Buscar servidor..."
            />
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-slate-300 font-semibold">
                Contenedor en el Servidor Origen *
              </label>
              <button
                type="button"
                @click="fetchContainersForServer(form.sourceServerId)"
                class="text-[10px] text-indigo-400 hover:underline"
              >
                <i
                  class="fa-solid fa-rotate mr-1"
                  :class="{ 'fa-spin': loadingRemoteContainers }"
                ></i>
                Refrescar contenedores
              </button>
            </div>
            <SearchableSelect
              v-model="form.sourceContainerName"
              :options="remoteContainerOptions"
              :placeholder="
                loadingRemoteContainers
                  ? 'Consultando Docker en el servidor...'
                  : 'Seleccionar contenedor...'
              "
              search-placeholder="Buscar contenedor o imagen..."
              @update:model-value="onRemoteContainerSelect"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              @click="form.transferMode = 'link'"
              class="p-3 rounded-xl border text-left transition"
              :class="
                form.transferMode === 'link'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              "
            >
              <div class="font-bold text-xs">Enlazar como Upstream Remoto</div>
              <div class="text-[10px] text-slate-400 mt-0.5">
                Mantiene el contenedor corriendo en el VPS remoto, registra la IP:Puerto en el proyecto y sincroniza <code class="text-emerald-300">MS_*_URL</code> en <code class="text-slate-300">.env</code>.
              </div>
            </button>
            <button
              type="button"
              @click="form.transferMode = 'clone'"
              class="p-3 rounded-xl border text-left transition"
              :class="
                form.transferMode === 'clone'
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              "
            >
              <div class="font-bold text-xs">Clonar Imagen a este Proyecto</div>
              <div class="text-[10px] text-slate-400 mt-0.5">
                Inspecciona la imagen del contenedor remoto y la incorpora directamente al <code class="text-slate-300">docker-compose.yml</code> local.
              </div>
            </button>
          </div>

          <label
            v-if="form.transferMode === 'link'"
            class="flex items-center gap-2 text-slate-300"
          >
            <input
              v-model="form.openFirewallPort"
              type="checkbox"
              class="rounded border-slate-600 text-indigo-500"
            />
            <span>Permitir automáticamente el puerto en UFW del servidor remoto desde este Gateway</span>
          </label>
        </template>

        <!-- TAB 3: IMAGEN / DOCKERFILE -->
        <template v-else>
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Imagen Docker Base
            </label>
            <input
              v-model="form.image"
              type="text"
              placeholder="Ej: redis:7-alpine, postgres:16-alpine, nginx:alpine"
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Dockerfile Personalizado (Opcional — si lo llenas, se creará <code class="text-slate-400">services/{{ form.serviceName || 'servicio' }}/Dockerfile</code>)
            </label>
            <textarea
              v-model="form.dockerfileContent"
              rows="5"
              placeholder="FROM node:20-alpine&#10;WORKDIR /app&#10;..."
              class="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl p-3 text-emerald-300 font-mono text-[11px] focus:outline-none"
            ></textarea>
          </div>
        </template>

        <label
          v-if="sourceTab !== 'server' || form.transferMode === 'clone'"
          class="flex items-center gap-2 text-slate-300 pt-1"
        >
          <input
            v-model="form.autoStart"
            type="checkbox"
            class="rounded border-slate-600 text-indigo-500"
          />
          <span>Levantar inmediatamente con <code class="text-indigo-300">docker compose up -d --build</code></span>
        </label>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="submitting"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5"
          >
            <i
              class="fa-solid"
              :class="submitting ? 'fa-spinner fa-spin' : 'fa-plus-circle'"
            ></i>
            <span>Integrar Contenedor</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
