<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiFetch,
  enqueueBackgroundTask,
  loadServers,
  openProjectWorkspace,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import {
  generateCryptoHex,
  injectDbPasswordInEnvText,
  injectSecretInEnvText,
} from '../../services/api';
import type { ProjectMicroservicesSummary } from '../../types/panel';
import SearchableSelect from '../common/SearchableSelect.vue';

const mode = ref<'empty' | 'git'>('empty');
const serverId = ref('local');
const projectName = ref('');
const description = ref('');

const repoUrl = ref('');
const branch = ref('');
const gitCredentialId = ref('');
const envContent = ref('');
const autoStart = ref(true);

const creatingEmpty = ref(false);
const detectingArchitecture = ref(false);
const detectedSummary = ref<ProjectMicroservicesSummary | null>(null);
const selectedMicroservices = ref<string[]>([]);

const serverOptions = computed(() =>
  panelStore.servers.map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: s.isLocal
      ? `Local (${panelStore.host.publicIp || s.host})`
      : `${s.sshUser}@${s.host}:${s.sshPort}`,
    badge: s.status === 'online' ? 'ONLINE' : s.status.toUpperCase(),
  }))
);

const gitCredentialOptions = computed(() => [
  {
    value: '',
    label: 'Sin credencial (Repositorio público o SSH)',
    sublabel: 'Clonado directo sin token',
  },
  ...panelStore.gitCredentials.map((c) => ({
    value: c.id,
    label: c.label,
    sublabel: `${c.provider.toUpperCase()} · ${c.username || 'token'}`,
  })),
]);

watch(
  () => panelStore.modals.clone.open,
  (isOpen) => {
    if (isOpen && panelStore.servers.length === 0) {
      loadServers().catch(() => {});
    }
  }
);

function close(): void {
  panelStore.modals.clone.open = false;
}

function resetForm(): void {
  projectName.value = '';
  description.value = '';
  repoUrl.value = '';
  branch.value = '';
  gitCredentialId.value = '';
  envContent.value = '';
  detectedSummary.value = null;
  selectedMicroservices.value = [];
}

function onRepoUrlInput(): void {
  detectedSummary.value = null;
  if (projectName.value.trim()) return;
  const match = /\/([^\/]+?)(?:\.git)?\/?$/.exec(repoUrl.value.trim());
  if (match && match[1]) {
    projectName.value = match[1].replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

function syncEnabledMicroservicesInEnvText(): void {
  if (!detectedSummary.value?.isMicroservicesArchitecture) return;
  const total = detectedSummary.value.microservices.length;
  const val =
    selectedMicroservices.value.length === total
      ? '*'
      : selectedMicroservices.value.join(',');

  const current = envContent.value.trim();
  if (!current) {
    envContent.value = `ENABLED_MICROSERVICES=${val}`;
    return;
  }
  if (/^ENABLED_MICROSERVICES\s*=.*$/m.test(current)) {
    envContent.value = current.replace(
      /^ENABLED_MICROSERVICES\s*=.*$/m,
      `ENABLED_MICROSERVICES=${val}`
    );
  } else {
    envContent.value = `${current}\nENABLED_MICROSERVICES=${val}`;
  }
}

function toggleMicroservice(serviceName: string): void {
  const idx = selectedMicroservices.value.indexOf(serviceName);
  if (idx >= 0) {
    selectedMicroservices.value.splice(idx, 1);
  } else {
    selectedMicroservices.value.push(serviceName);
  }
  syncEnabledMicroservicesInEnvText();
}

function selectAllMicroservices(): void {
  if (!detectedSummary.value) return;
  selectedMicroservices.value = detectedSummary.value.microservices.map(
    (m) => m.serviceName
  );
  syncEnabledMicroservicesInEnvText();
}

function selectEssentialMicroservices(): void {
  if (!detectedSummary.value) return;
  const essentialKeywords = [
    'facturacion',
    'clientes',
    'inventario',
    'caja',
    'crm',
    'inventory',
    'invoicing',
    'billing',
    'auth',
  ];
  const filtered = detectedSummary.value.microservices
    .filter((m) =>
      essentialKeywords.some(
        (kw) =>
          m.domainCode.toLowerCase().includes(kw) ||
          m.serviceName.toLowerCase().includes(kw)
      )
    )
    .map((m) => m.serviceName);

  selectedMicroservices.value =
    filtered.length > 0
      ? filtered
      : detectedSummary.value.microservices
          .slice(0, 3)
          .map((m) => m.serviceName);
  syncEnabledMicroservicesInEnvText();
}

function selectCoreOnlyMicroservices(): void {
  selectedMicroservices.value = [];
  syncEnabledMicroservicesInEnvText();
}

async function detectRepoArchitecture(): Promise<void> {
  const url = repoUrl.value.trim();
  if (!url) {
    showToast('Primero ingresa la URL del repositorio Git', true);
    return;
  }

  detectingArchitecture.value = true;
  try {
    const res = await apiFetch<{
      summary: ProjectMicroservicesSummary;
      suggestedEnvContent: string;
    }>('/api/projects/detect-microservices', {
      method: 'POST',
      body: JSON.stringify({
        repoUrl: url,
        branch: branch.value.trim() || undefined,
      }),
    });

    detectedSummary.value = res.summary;
    if (res.summary.totalMicroservices > 5) {
      selectEssentialMicroservices();
    } else {
      selectedMicroservices.value = res.summary.microservices.map(
        (m) => m.serviceName
      );
    }

    if (res.suggestedEnvContent && !envContent.value.trim()) {
      let text = res.suggestedEnvContent.trim();
      text = text.replace(
        /^NODE_ENV\s*=\s*development\s*$/m,
        'NODE_ENV=production'
      );
      const jwtSecret = generateCryptoHex(32);
      if (/^JWT_SECRET\s*=.*$/m.test(text)) {
        text = text.replace(/^JWT_SECRET\s*=.*$/m, `JWT_SECRET=${jwtSecret}`);
      } else {
        text += `\nJWT_SECRET=${jwtSecret}`;
      }
      envContent.value = text;
    }

    if (res.summary.isMicroservicesArchitecture) {
      syncEnabledMicroservicesInEnvText();
      showToast(
        `Detectados ${res.summary.totalMicroservices} microservicios y ${res.summary.coreServices.length} servicios Core`
      );
    } else {
      showToast('Proyecto estándar detectado (sin microservicios independientes)');
    }
  } catch (err: any) {
    showToast(`Error inspeccionando repositorio: ${err.message}`, true);
  } finally {
    detectingArchitecture.value = false;
  }
}

function generateSecret(keyName: string): void {
  envContent.value = injectSecretInEnvText(envContent.value, keyName, 32);
  showToast(`${keyName} criptográfico generado y aplicado`);
}

function generateDbPassword(): void {
  const res = injectDbPasswordInEnvText(envContent.value);
  envContent.value = res.text;
  showToast(`${res.keyUpdated} actualizado con contraseña segura`);
}

async function autoFetchRepoEnvExample(): Promise<void> {
  const url = repoUrl.value.trim();
  const targetBranch = branch.value.trim() || 'main';
  if (!url) {
    showToast('Primero pega la URL del repositorio Git', true);
    return;
  }

  const ghMatch = /github\.com[:/]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i.exec(url);
  if (!ghMatch) {
    generateSecret('JWT_SECRET');
    return;
  }

  const [, owner, repo] = ghMatch;
  const branchesToTry = [targetBranch, 'main', 'master', 'develop'];
  for (const b of branchesToTry) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/.env.example`;
      const resp = await fetch(rawUrl);
      if (resp.ok) {
        let text = (await resp.text()).trim();
        text = text.replace(
          /^NODE_ENV\s*=\s*development\s*$/m,
          'NODE_ENV=production'
        );
        const jwtSecret = generateCryptoHex(32);
        if (/^JWT_SECRET\s*=.*$/m.test(text)) {
          text = text.replace(/^JWT_SECRET\s*=.*$/m, `JWT_SECRET=${jwtSecret}`);
        } else {
          text += `\nJWT_SECRET=${jwtSecret}`;
        }
        envContent.value = text;
        showToast('.env.example cargado + JWT_SECRET generado automáticamente');
        return;
      }
    } catch {
      // Try next branch
    }
  }

  generateSecret('JWT_SECRET');
}

async function handleCreateEmpty(): Promise<void> {
  const name = projectName.value.trim();
  if (!name) {
    showToast('Ingresa un nombre válido para el proyecto.', true);
    return;
  }
  creatingEmpty.value = true;
  try {
    await apiFetch('/api/projects/create-empty', {
      method: 'POST',
      body: JSON.stringify({
        projectName: name,
        serverId: serverId.value || 'local',
        description: description.value.trim(),
      }),
    });
    showToast(`Proyecto aislado "${name}" creado. Abriendo espacio de trabajo...`);
    close();
    resetForm();
    await refreshAll();
    await openProjectWorkspace(name, 'containers');
  } catch (err: any) {
    showToast(`Error creando proyecto: ${err.message}`, true);
  } finally {
    creatingEmpty.value = false;
  }
}

async function handleSubmit(): Promise<void> {
  if (mode.value === 'empty') {
    await handleCreateEmpty();
    return;
  }

  const payload: Record<string, any> = {
    name: projectName.value.trim(),
    repoUrl: repoUrl.value.trim(),
    branch: branch.value.trim(),
    envContent: envContent.value,
    autoStart: autoStart.value,
    serverId: serverId.value || 'local',
    gitCredentialId: gitCredentialId.value || undefined,
  };

  if (detectedSummary.value?.isMicroservicesArchitecture) {
    payload.selectedMicroservices = [...selectedMicroservices.value];
  }

  close();
  resetForm();

  enqueueBackgroundTask({
    title: `Clonando y Desplegando ${payload.name}`,
    projectName: payload.name,
    action: 'clone',
    runningMessage: `Clonando ${payload.repoUrl} y levantando contenedores Docker...`,
    initialOutput: `⏳ Clonando ${payload.repoUrl} en segundo plano...\n`,
    taskFn: () =>
      apiFetch<{ output: string }>('/api/projects/clone', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });
}
</script>

<template>
  <div
    v-if="panelStore.modals.clone.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
    >
      <div
        class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4"
      >
        <div>
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-layer-group text-indigo-400"></i>
            <span>Crear Nuevo Proyecto</span>
          </h3>
          <p class="text-[11px] text-slate-400">
            Cada proyecto opera con red Docker aislada, archivos propios y dominios independientes.
          </p>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <!-- Selector de Modo de Creación -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        <button
          type="button"
          @click="mode = 'empty'"
          class="p-3 rounded-xl border text-left transition flex items-start gap-2.5"
          :class="
            mode === 'empty'
              ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
          "
        >
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            :class="
              mode === 'empty'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400'
            "
          >
            <i class="fa-solid fa-cube text-xs"></i>
          </div>
          <div>
            <div class="text-xs font-bold">Proyecto Vacío Aislado</div>
            <div class="text-[10px] text-slate-400 mt-0.5">
              Crea el workspace con red aislada y luego agrega contenedores de Git, otro servidor o Docker.
            </div>
          </div>
        </button>

        <button
          type="button"
          @click="mode = 'git'"
          class="p-3 rounded-xl border text-left transition flex items-start gap-2.5"
          :class="
            mode === 'git'
              ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
          "
        >
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            :class="
              mode === 'git'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400'
            "
          >
            <i class="fa-brands fa-git-alt text-xs"></i>
          </div>
          <div>
            <div class="text-xs font-bold">Clonar Repositorio Completo</div>
            <div class="text-[10px] text-slate-400 mt-0.5">
              Importa un repositorio completo de GitHub o GitLab con detección automática de microservicios.
            </div>
          </div>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-3.5 text-xs">
        <!-- Selector de Servidor Destino (Select2) -->
        <div>
          <label class="block text-slate-300 font-semibold mb-1">
            Servidor Destino
          </label>
          <SearchableSelect
            v-model="serverId"
            :options="serverOptions"
            placeholder="Seleccionar servidor destino..."
            search-placeholder="Buscar servidor o IP..."
          />
        </div>

        <!-- MODO 1: PROYECTO VACÍO AISLADO -->
        <template v-if="mode === 'empty'">
          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Nombre del Proyecto *
            </label>
            <input
              v-model="projectName"
              type="text"
              placeholder="Ej: Proveko-Core, Facturacion-VPS2"
              required
              class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-white focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-slate-300 font-semibold mb-1">
              Descripción / Propósito (Opcional)
            </label>
            <input
              v-model="description"
              type="text"
              placeholder="Ej: Cluster de microservicios SaaS multi-tenant"
              class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-white focus:outline-none"
            />
          </div>

          <div
            class="p-3.5 rounded-xl bg-slate-950/80 border border-indigo-500/20 text-[11px] text-slate-300 space-y-1"
          >
            <div class="font-semibold text-indigo-300 flex items-center gap-1.5">
              <i class="fa-solid fa-shield-halved"></i>
              <span>Aislamiento Automático Garantizado</span>
            </div>
            <p class="text-slate-400">
              Se creará la carpeta del proyecto, el manifiesto <code class="text-slate-200">.alpanel-project.json</code>, un <code class="text-slate-200">docker-compose.yml</code> base y la red privada dedicada <code class="text-emerald-300">alpanel_isolated_&lt;proyecto&gt;_net</code>.
            </p>
          </div>
        </template>

        <!-- MODO 2: CLONAR REPOSITORIO GIT COMPLETO -->
        <template v-else>
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-slate-300 font-semibold">
                URL del Repositorio Git (HTTPS o SSH) *
              </label>
              <button
                type="button"
                :disabled="detectingArchitecture || !repoUrl.trim()"
                @click="detectRepoArchitecture"
                class="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 disabled:opacity-50 text-violet-300 border border-violet-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition"
              >
                <i
                  class="fa-solid"
                  :class="
                    detectingArchitecture
                      ? 'fa-circle-notch fa-spin'
                      : 'fa-cubes'
                  "
                ></i>
                {{
                  detectingArchitecture
                    ? 'Analizando arquitectura...'
                    : 'Detectar Microservicios'
                }}
              </button>
            </div>
            <input
              v-model="repoUrl"
              @input="onRepoUrlInput"
              type="text"
              placeholder="https://github.com/usuario/proyecto.git"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div class="sm:col-span-2">
              <label class="block text-slate-400 mb-1">
                Nombre de la Carpeta del Proyecto *
              </label>
              <input
                v-model="projectName"
                type="text"
                placeholder="ej. Proveko"
                required
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
              />
            </div>
            <div>
              <label class="block text-slate-400 mb-1">Rama (Opcional)</label>
              <input
                v-model="branch"
                type="text"
                placeholder="main"
                class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
              />
            </div>
          </div>

          <div v-if="panelStore.gitCredentials.length > 0">
            <label class="block text-slate-400 mb-1">
              Credencial Git Privada (Opcional)
            </label>
            <SearchableSelect
              v-model="gitCredentialId"
              :options="gitCredentialOptions"
              placeholder="Repositorio público..."
              search-placeholder="Buscar token GitHub / GitLab..."
            />
          </div>

          <!-- Selector de Microservicios Detectados -->
          <div
            v-if="detectedSummary?.isMicroservicesArchitecture"
            class="bg-slate-950/90 border border-violet-500/30 rounded-xl p-3.5 space-y-3"
          >
            <div
              class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5"
            >
              <div class="flex items-center gap-2">
                <span
                  class="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold text-[10px]"
                >
                  <i class="fa-solid fa-cubes mr-1"></i>ARQUITECTURA DE MICROSERVICIOS
                </span>
                <span class="text-slate-300 font-semibold text-[11px]">
                  {{ selectedMicroservices.length }} de {{ detectedSummary.totalMicroservices }} seleccionados
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  @click="selectAllMicroservices"
                  class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold"
                >
                  Todos
                </button>
                <button
                  type="button"
                  @click="selectEssentialMicroservices"
                  class="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold"
                >
                  Esenciales
                </button>
                <button
                  type="button"
                  @click="selectCoreOnlyMicroservices"
                  class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px] font-semibold"
                >
                  Solo Core
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div
                v-for="ms in detectedSummary.microservices"
                :key="ms.serviceName"
                @click="toggleMicroservice(ms.serviceName)"
                class="cursor-pointer rounded-xl p-2.5 border transition flex items-start gap-2.5"
                :class="
                  selectedMicroservices.includes(ms.serviceName)
                    ? 'bg-violet-950/30 border-violet-500/50 text-white'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-400 opacity-75'
                "
              >
                <input
                  type="checkbox"
                  :checked="selectedMicroservices.includes(ms.serviceName)"
                  @click.stop="toggleMicroservice(ms.serviceName)"
                  class="mt-0.5 rounded bg-slate-950 border-slate-700 text-violet-500"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1">
                    <span class="font-bold text-[11px] truncate">{{ ms.displayName }}</span>
                    <code
                      v-if="ms.port !== '-'"
                      class="text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-violet-300"
                    >
                      :{{ ms.port }}
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
              <label class="text-slate-400">Variables .env iniciales (Opcional)</label>
              <div class="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  @click="autoFetchRepoEnvExample"
                  class="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1"
                >
                  <i class="fa-solid fa-wand-magic-sparkles"></i> Cargar .env.example
                </button>
                <button
                  type="button"
                  @click="generateSecret('JWT_SECRET')"
                  class="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1"
                >
                  <i class="fa-solid fa-key"></i> + JWT_SECRET
                </button>
                <button
                  type="button"
                  @click="generateDbPassword"
                  class="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1"
                >
                  <i class="fa-solid fa-dice"></i> + Password DB
                </button>
              </div>
            </div>
            <textarea
              v-model="envContent"
              rows="4"
              placeholder="Si lo dejas vacío y el repositorio tiene .env.example, ALpanel lo copiará y generará JWT_SECRET automáticamente."
              class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-emerald-300"
            ></textarea>
          </div>

          <label class="flex items-center gap-2 text-slate-300 pt-1">
            <input
              v-model="autoStart"
              type="checkbox"
              class="rounded bg-slate-950 border-slate-700 text-indigo-600"
            />
            Ejecutar <code class="text-indigo-400">docker compose up -d --build</code> al terminar
          </label>
        </template>

        <div class="pt-3 flex justify-end gap-2 border-t border-slate-800">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="creatingEmpty"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
          >
            <i
              class="fa-solid"
              :class="
                creatingEmpty
                  ? 'fa-spinner fa-spin'
                  : mode === 'empty'
                    ? 'fa-folder-plus'
                    : 'fa-rocket'
              "
            ></i>
            <span>
              {{ mode === 'empty' ? 'Crear Proyecto Vacío' : 'Clonar y Desplegar' }}
            </span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
