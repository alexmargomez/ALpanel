<script setup lang="ts">
import { ref } from 'vue';
import {
  apiFetch,
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

const repoUrl = ref('');
const projectName = ref('');
const branch = ref('');
const envContent = ref('');
const autoStart = ref(true);

const detectingArchitecture = ref(false);
const detectedSummary = ref<ProjectMicroservicesSummary | null>(null);
const selectedMicroservices = ref<string[]>([]);

function close(): void {
  panelStore.modals.clone.open = false;
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
  const essentialKeywords = ['crm', 'inventory', 'invoicing', 'billing', 'auth'];
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
    selectedMicroservices.value = res.summary.microservices.map(
      (m) => m.serviceName
    );

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
        `🧩 Detectados ${res.summary.totalMicroservices} microservicios de dominio y ${res.summary.coreServices.length} servicios Core`
      );
    } else {
      showToast(
        '📦 Proyecto estándar / monolítico detectado (sin microservicios independientes)'
      );
    }
  } catch (err: any) {
    showToast(`Error inspeccionando repositorio: ${err.message}`, true);
  } finally {
    detectingArchitecture.value = false;
  }
}

function generateSecret(keyName: string): void {
  envContent.value = injectSecretInEnvText(envContent.value, keyName, 32);
  showToast(`🔑 ${keyName} criptográfico generado y aplicado`);
}

function generateDbPassword(): void {
  const res = injectDbPasswordInEnvText(envContent.value);
  envContent.value = res.text;
  showToast(`🎲 ${res.keyUpdated} actualizado con contraseña segura`);
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
        showToast(
          '✨ .env.example cargado del repositorio + JWT_SECRET generado automáticamente'
        );
        return;
      }
    } catch {
      // Intentar siguiente rama
    }
  }

  generateSecret('JWT_SECRET');
}

async function handleSubmit(): Promise<void> {
  const payload: Record<string, any> = {
    name: projectName.value.trim(),
    repoUrl: repoUrl.value.trim(),
    branch: branch.value.trim(),
    envContent: envContent.value,
    autoStart: autoStart.value,
  };

  if (detectedSummary.value?.isMicroservicesArchitecture) {
    payload.selectedMicroservices = [...selectedMicroservices.value];
  }

  close();

  panelStore.modals.console.title = `Clonando y Desplegando ${payload.name}`;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = `⏳ Clonando ${payload.repoUrl}...\n`;
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{ output: string }>('/api/projects/clone', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    panelStore.modals.console.output = res.output || 'Proceso finalizado.';
    repoUrl.value = '';
    projectName.value = '';
    branch.value = '';
    envContent.value = '';
    detectedSummary.value = null;
    selectedMicroservices.value = [];
    await refreshAll();
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error: ${err.message}`;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.clone.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
    >
      <div
        class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4"
      >
        <h3 class="text-sm font-bold text-white">
          <i class="fa-brands fa-git-alt text-indigo-400 mr-2"></i>Clonar y
          Desplegar Nuevo Proyecto
        </h3>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-3.5 text-xs">
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-slate-400">
              URL del Repositorio Git (HTTPS o SSH)
            </label>
            <button
              type="button"
              :disabled="detectingArchitecture || !repoUrl.trim()"
              @click="detectRepoArchitecture"
              class="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 disabled:opacity-50 text-violet-300 border border-violet-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition"
              title="Analiza el repositorio remoto para detectar si tiene microservicios y elegir cuáles integrar"
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
              Nombre de la Carpeta del Proyecto
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
                <i class="fa-solid fa-cubes mr-1"></i>ARQUITECTURA DE
                MICROSERVICIOS
              </span>
              <span class="text-slate-300 font-semibold text-[11px]">
                {{ selectedMicroservices.length }} de
                {{ detectedSummary.totalMicroservices }} microservicios a
                integrar
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
                Esenciales (CRM/Inv/Fact)
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

          <!-- Servicios Core Obligatorios -->
          <div v-if="detectedSummary.coreServices.length">
            <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5 font-semibold">
              Servicios Core Base (Integrados automáticamente)
            </div>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="core in detectedSummary.coreServices"
                :key="core.serviceName"
                class="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300 text-[11px] font-medium flex items-center gap-1.5"
              >
                <i class="fa-solid fa-check-circle text-[10px] text-emerald-400"></i>
                {{ core.displayName }}
                <code v-if="core.port !== '-'" class="text-[10px] text-slate-400">
                  :{{ core.port }}
                </code>
              </span>
            </div>
          </div>

          <!-- Microservicios de Dominio Seleccionables -->
          <div>
            <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5 font-semibold">
              Decide qué Microservicios de Dominio integrar y levantar:
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
                    <span class="font-bold text-[11px] truncate">
                      {{ ms.displayName }}
                    </span>
                    <code
                      v-if="ms.port !== '-'"
                      class="text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-violet-300"
                    >
                      :{{ ms.port }}
                    </code>
                  </div>
                  <div
                    v-if="ms.subModules.length"
                    class="flex flex-wrap gap-1 mt-1"
                  >
                    <span
                      v-for="mod in ms.subModules"
                      :key="mod"
                      class="px-1.5 py-0.2 rounded bg-slate-950 text-slate-300 text-[9px] font-mono"
                    >
                      {{ mod }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="detectedSummary && !detectedSummary.isMicroservicesArchitecture"
          class="bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-[11px] text-slate-300 flex items-center gap-2"
        >
          <i class="fa-solid fa-cube text-emerald-400"></i>
          <span>
            <strong>{{ detectedSummary.architectureLabel }}</strong> — Se
            desplegarán sus servicios estándar completos.
          </span>
        </div>

        <div>
          <div
            class="flex flex-wrap items-center justify-between gap-1.5 mb-1.5"
          >
            <label class="text-slate-400">
              Variables .env iniciales (Opcional)
            </label>
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                @click="autoFetchRepoEnvExample"
                class="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Carga el .env.example del repositorio de GitHub y genera JWT_SECRET automáticamente"
              >
                <i class="fa-solid fa-wand-magic-sparkles"></i> Cargar
                .env.example
              </button>
              <button
                type="button"
                @click="generateSecret('JWT_SECRET')"
                class="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Genera un JWT_SECRET criptográfico de 256 bits"
              >
                <i class="fa-solid fa-key"></i> + JWT_SECRET
              </button>
              <button
                type="button"
                @click="generateDbPassword"
                class="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Genera una contraseña aleatoria segura para la base de datos"
              >
                <i class="fa-solid fa-dice"></i> + Password DB
              </button>
            </div>
          </div>
          <textarea
            v-model="envContent"
            rows="5"
            placeholder="Si lo dejas vacío y el repositorio tiene .env.example, ALpanel lo copiará y generará JWT_SECRET automáticamente."
            class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-emerald-300"
          ></textarea>
          <p class="text-[10px] text-slate-500 mt-1">
            <i class="fa-solid fa-circle-info text-indigo-400 mr-1"></i>Si no
            escribes un <code class="text-slate-300">JWT_SECRET</code>, ALpanel
            generará uno criptográfico de 256 bits automáticamente al clonar.
          </p>
        </div>

        <label class="flex items-center gap-2 text-slate-300 pt-1">
          <input
            v-model="autoStart"
            type="checkbox"
            class="rounded bg-slate-950 border-slate-700 text-indigo-600"
          />
          Ejecutar
          <code class="text-indigo-400">docker compose up -d --build</code>
          automáticamente al terminar (solo levantará los microservicios
          integrados)
        </label>

        <div class="pt-3 flex justify-end gap-2">
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
            <i class="fa-solid fa-rocket mr-1"></i> Clonar y Desplegar
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
