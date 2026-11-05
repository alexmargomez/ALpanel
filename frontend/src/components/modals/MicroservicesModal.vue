<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  apiFetch,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import type { ProjectMicroservicesSummary } from '../../types/panel';

const loading = ref(false);
const saving = ref(false);
const summary = ref<ProjectMicroservicesSummary | null>(null);
const selectedServices = ref<string[]>([]);

function close(): void {
  panelStore.modals.microservices.open = false;
}

async function loadMicroservices(): Promise<void> {
  const projectName = panelStore.modals.microservices.projectName;
  if (!projectName) return;
  loading.value = true;
  try {
    const res = await apiFetch<ProjectMicroservicesSummary>(
      `/api/projects/${encodeURIComponent(projectName)}/microservices`
    );
    summary.value = res;
    selectedServices.value = res.microservices
      .filter((m) => m.enabled)
      .map((m) => m.serviceName);
  } catch (err: any) {
    showToast(`Error cargando microservicios: ${err.message}`, true);
  } finally {
    loading.value = false;
  }
}

watch(
  () => panelStore.modals.microservices.open,
  (isOpen) => {
    if (isOpen) {
      loadMicroservices();
    }
  }
);

function toggleService(serviceName: string): void {
  const idx = selectedServices.value.indexOf(serviceName);
  if (idx >= 0) {
    selectedServices.value.splice(idx, 1);
  } else {
    selectedServices.value.push(serviceName);
  }
}

function selectAll(): void {
  if (!summary.value) return;
  selectedServices.value = summary.value.microservices.map(
    (m) => m.serviceName
  );
}

function selectEssentials(): void {
  if (!summary.value) return;
  const essentialKeywords = ['crm', 'inventory', 'invoicing', 'billing', 'auth'];
  const filtered = summary.value.microservices
    .filter((m) =>
      essentialKeywords.some(
        (kw) =>
          m.domainCode.toLowerCase().includes(kw) ||
          m.serviceName.toLowerCase().includes(kw)
      )
    )
    .map((m) => m.serviceName);
  selectedServices.value =
    filtered.length > 0
      ? filtered
      : summary.value.microservices.slice(0, 3).map((m) => m.serviceName);
}

function selectNone(): void {
  selectedServices.value = [];
}

async function applyChanges(): Promise<void> {
  const projectName = panelStore.modals.microservices.projectName;
  if (!projectName) return;
  saving.value = true;

  close();
  panelStore.modals.console.title = `Aplicando Microservicios — ${projectName}`;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = `⏳ Sincronizando topología de microservicios de ${projectName}...\n`;
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{
      success: boolean;
      output: string;
      microservices?: ProjectMicroservicesSummary;
    }>(`/api/projects/${encodeURIComponent(projectName)}/microservices`, {
      method: 'POST',
      body: JSON.stringify({
        enabledMicroservices: selectedServices.value,
      }),
    });
    panelStore.modals.console.output =
      res.output || 'Configuración de microservicios aplicada.';
    showToast(
      `✅ Microservicios de ${projectName} actualizados (${selectedServices.value.length} activos)`
    );
    await refreshAll();
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error aplicando microservicios: ${err.message}`;
    showToast(`Error: ${err.message}`, true);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.microservices.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto space-y-4"
    >
      <div
        class="flex items-center justify-between border-b border-slate-800 pb-3"
      >
        <div>
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-cubes text-violet-400"></i>
            <span>
              Orquestador de Microservicios —
              <span class="text-violet-300">
                {{ panelStore.modals.microservices.projectName }}
              </span>
            </span>
          </h3>
          <p class="text-[11px] text-slate-400 mt-0.5">
            Decide qué microservicios integrar y mantener encendidos en este
            servidor. Los microservicios desmarcados se detendrán para ahorrar
            RAM y CPU.
          </p>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white px-2">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div
        v-if="loading"
        class="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2"
      >
        <i class="fa-solid fa-circle-notch fa-spin text-2xl text-violet-400"></i>
        <span>Inspeccionando arquitectura y microservicios del proyecto...</span>
      </div>

      <div v-else-if="summary" class="space-y-4 text-xs">
        <!-- Resumen y Acciones Rápidas -->
        <div
          class="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3"
        >
          <div class="flex flex-wrap items-center gap-2.5">
            <span
              class="px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 font-bold text-[11px]"
            >
              {{ selectedServices.length }} / {{ summary.totalMicroservices }}
              Seleccionados
            </span>
            <span class="text-slate-400 text-[11px]">
              En ejecución ahora:
              <strong class="text-emerald-400">
                {{ summary.runningMicroservicesCount }}
              </strong>
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              @click="selectAll"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold"
            >
              Integrar Todos
            </button>
            <button
              type="button"
              @click="selectEssentials"
              class="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold"
            >
              Solo Esenciales (CRM/Inv/Fact)
            </button>
            <button
              type="button"
              @click="selectNone"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px] font-semibold"
            >
              Solo Core
            </button>
          </div>
        </div>

        <!-- Servicios Core Obligatorios -->
        <div v-if="summary.coreServices.length" class="space-y-2">
          <div
            class="text-[11px] font-bold uppercase tracking-wider text-slate-400"
          >
            Servicios Core Base ({{ summary.coreServices.length }} — Siempre
            activos)
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div
              v-for="core in summary.coreServices"
              :key="core.serviceName"
              class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  :class="
                    core.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'
                  "
                ></span>
                <div class="min-w-0">
                  <div class="font-bold text-white truncate">
                    {{ core.displayName }}
                  </div>
                  <div class="text-[10px] text-slate-400 truncate">
                    Contenedor:
                    <code class="text-slate-300">{{ core.containerName }}</code>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <code
                  v-if="core.port !== '-'"
                  class="px-2 py-0.5 rounded bg-slate-900 text-indigo-300 text-[10px]"
                >
                  :{{ core.port }}
                </code>
                <span
                  class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                >
                  CORE
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Microservicios de Dominio Seleccionables -->
        <div class="space-y-2">
          <div
            class="text-[11px] font-bold uppercase tracking-wider text-slate-400"
          >
            Microservicios de Dominio ({{ summary.microservices.length }}) —
            Marca cuáles integrar:
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div
              v-for="ms in summary.microservices"
              :key="ms.serviceName"
              @click="toggleService(ms.serviceName)"
              class="cursor-pointer rounded-xl p-3.5 border transition space-y-2"
              :class="
                selectedServices.includes(ms.serviceName)
                  ? 'bg-violet-950/25 border-violet-500/50 text-white shadow-md shadow-violet-950/20'
                  : 'bg-slate-950/60 border-slate-800/80 text-slate-400 opacity-75'
              "
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-start gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    :checked="selectedServices.includes(ms.serviceName)"
                    @click.stop="toggleService(ms.serviceName)"
                    class="mt-0.5 rounded bg-slate-950 border-slate-700 text-violet-500"
                  />
                  <div class="min-w-0">
                    <div class="font-bold text-xs truncate">
                      {{ ms.displayName }}
                    </div>
                    <div class="text-[10px] text-slate-400 font-mono">
                      {{ ms.containerName }}
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                  <code
                    v-if="ms.port !== '-'"
                    class="px-1.5 py-0.5 rounded bg-slate-900 text-violet-300 text-[10px]"
                  >
                    :{{ ms.port }}
                  </code>
                  <span
                    v-if="ms.state === 'running'"
                    class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  >
                    ACTIVO
                  </span>
                  <span
                    v-else
                    class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-slate-400"
                  >
                    APAGADO
                  </span>
                </div>
              </div>

              <div
                v-if="ms.subModules.length"
                class="flex flex-wrap gap-1 pt-1 border-t border-slate-800/70"
              >
                <span
                  v-for="mod in ms.subModules"
                  :key="mod"
                  class="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-mono"
                >
                  {{ mod }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="button"
            :disabled="saving"
            @click="applyChanges"
            class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold flex items-center gap-1.5 shadow-lg shadow-violet-600/25"
          >
            <i class="fa-solid fa-cubes"></i>
            Guardar y Aplicar Integración ({{ selectedServices.length }}/{{
              summary.totalMicroservices
            }})
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
