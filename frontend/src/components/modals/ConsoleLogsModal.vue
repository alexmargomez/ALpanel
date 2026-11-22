<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  copyText,
  loadSelectedContainerLogs,
  panelStore,
} from '../../composables/usePanelStore';

const outputContainer = ref<HTMLElement | null>(null);
const showTopPanel = ref(true);
const autoScroll = ref(true);
const nowMs = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  clockTimer = setInterval(() => {
    if (panelStore.modals.console.open) {
      nowMs.value = Date.now();
    }
  }, 1000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});

const activeTask = computed(() => {
  const tid = panelStore.modals.console.taskId;
  if (!tid) return null;
  return panelStore.backgroundTasks.find((t) => t.id === tid) || null;
});

const liveTelemetry = computed(() => activeTask.value?.telemetry || null);

const projectContainers = computed(() => {
  const proj = panelStore.projects.find(
    (p) => p.name === panelStore.modals.console.projectName
  );
  return proj?.containers || [];
});

const effectiveOutput = computed(() => {
  if (activeTask.value) {
    return activeTask.value.output || panelStore.modals.console.output;
  }
  return panelStore.modals.console.output;
});

const parsedLines = computed(() => {
  const raw = effectiveOutput.value || '';
  if (!raw) return [];
  return raw.split('\n').map((text, index) => {
    const trimmed = text.trim();
    const withoutClock = trimmed.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');
    let lineClass = 'text-slate-200';

    if (
      withoutClock.startsWith('❌') ||
      withoutClock.startsWith('🛑') ||
      withoutClock.startsWith('⛔') ||
      /\b(error|fatal|failed to solve|exception|access denied|exit code: [1-9])\b/i.test(
        withoutClock
      )
    ) {
      lineClass =
        'text-rose-300 bg-rose-950/40 border-l-2 border-rose-500 pl-2 py-0.5 font-medium';
    } else if (
      withoutClock.startsWith('⚠️') ||
      /\bwarning\b/i.test(withoutClock)
    ) {
      lineClass = 'text-amber-300';
    } else if (
      withoutClock.startsWith('==>') ||
      withoutClock.startsWith('[Paso')
    ) {
      lineClass =
        'text-indigo-300 font-bold bg-indigo-500/10 border-l-2 border-indigo-400 pl-2 py-0.5 mt-1';
    } else if (withoutClock.startsWith('$ ')) {
      lineClass = 'text-cyan-300 font-semibold';
    } else if (
      withoutClock.startsWith('✅') ||
      withoutClock.startsWith('[RAM-GUARD]')
    ) {
      lineClass = 'text-emerald-400 font-semibold';
    } else if (/^#\d+\s+\[/.test(withoutClock)) {
      lineClass = 'text-sky-300';
    }

    return {
      id: index,
      text,
      lineClass,
    };
  });
});

const elapsedFormatted = computed(() => {
  if (!activeTask.value) return '';
  const end = activeTask.value.finishedAt || nowMs.value;
  const secs = Math.max(1, Math.round((end - activeTask.value.startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
});

const ramBarColorClass = computed(() => {
  const host = liveTelemetry.value?.host;
  if (!host) return 'bg-emerald-500';
  if (host.ramAvailableMb < 380 || host.ramPercent >= 88) return 'bg-rose-500';
  if (host.ramAvailableMb < 650 || host.ramPercent >= 78) return 'bg-amber-500';
  return 'bg-emerald-500';
});

watch(
  () => effectiveOutput.value,
  async () => {
    if (!autoScroll.value) return;
    await nextTick();
    if (outputContainer.value) {
      outputContainer.value.scrollTop = outputContainer.value.scrollHeight;
    }
  }
);

function handleScroll(): void {
  const el = outputContainer.value;
  if (!el) return;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScroll.value = distFromBottom < 48;
}

function close(): void {
  panelStore.modals.console.open = false;
}
</script>

<template>
  <div
    v-if="panelStore.modals.console.open"
    class="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-4 sm:p-5 shadow-2xl flex flex-col max-h-[92vh] gap-3"
    >
      <!-- ENCABEZADO DEL MONITOR DE CONSOLA Y TELEMETRÍA -->
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3"
      >
        <div class="flex flex-wrap items-center gap-2.5 min-w-0">
          <div
            class="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0"
          >
            <i class="fa-solid fa-terminal text-xs"></i>
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-bold text-white truncate">
                {{ panelStore.modals.console.title }}
              </h3>

              <!-- Estado en vivo de la Tarea -->
              <span
                v-if="activeTask"
                class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5"
                :class="{
                  'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40':
                    activeTask.status === 'running',
                  'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40':
                    activeTask.status === 'success',
                  'bg-rose-500/20 text-rose-300 border border-rose-500/40':
                    activeTask.status === 'error',
                }"
              >
                <i
                  v-if="activeTask.status === 'running'"
                  class="fa-solid fa-circle-notch fa-spin text-[9px]"
                ></i>
                <span>
                  {{
                    activeTask.status === 'running'
                      ? 'Telemetría en vivo'
                      : activeTask.status === 'success'
                        ? 'Completado'
                        : 'Error / Detenido'
                  }}
                </span>
              </span>

              <span
                v-if="activeTask"
                class="text-xs font-mono text-slate-400"
              >
                ⏱ {{ elapsedFormatted }}
              </span>
            </div>

            <div
              v-if="activeTask?.phase"
              class="text-[11px] text-indigo-400 font-medium truncate mt-0.5"
            >
              Fase actual: {{ activeTask.phase }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Botón para Mostrar/Ocultar Tabla TOP de Procesos -->
          <button
            v-if="activeTask"
            @click="showTopPanel = !showTopPanel"
            class="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition flex items-center gap-1.5"
            :class="
              showTopPanel
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            "
          >
            <i class="fa-solid fa-microchip text-[10px]"></i>
            <span>
              Monitor TOP
              <template v-if="liveTelemetry">
                ({{ liveTelemetry.processes.length }})
              </template>
            </span>
          </button>

          <!-- Selector de Contenedor cuando se abren Logs normales -->
          <template v-if="panelStore.modals.console.showContainerSelect">
            <select
              v-model="panelStore.modals.console.selectedContainer"
              @change="loadSelectedContainerLogs"
              class="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white"
            >
              <option
                v-for="c in projectContainers"
                :key="c.name"
                :value="c.name"
              >
                {{ c.name }} ({{ c.role }})
              </option>
            </select>
            <button
              @click="loadSelectedContainerLogs"
              class="p-1.5 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
              title="Refrescar logs"
            >
              <i class="fa-solid fa-rotate"></i>
            </button>
          </template>

          <button
            @click="close"
            class="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- PANEL HTOP / TOP DE PROCESOS Y RECURSOS EN TIEMPO REAL -->
      <div
        v-if="activeTask && showTopPanel"
        class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5 text-xs"
      >
        <!-- Barra Superior de Recursos Host + RAM Guard -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div
            class="bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-gauge-high text-indigo-400"></i>
              <span class="text-slate-400 font-medium">Carga CPU / LoadAvg:</span>
            </div>
            <span class="font-mono font-bold text-white">
              <template v-if="liveTelemetry">
                {{ liveTelemetry.host.loadAvg1m }} ·
                {{ liveTelemetry.host.loadAvg5m }} ({{
                  liveTelemetry.host.cpuCores
                }}
                vCPU)
              </template>
              <template v-else>
                {{ panelStore.host.cpu.usagePercent }}% ({{
                  panelStore.host.cpu.cores
                }}
                vCPU)
              </template>
            </span>
          </div>

          <div
            class="bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2 space-y-1"
          >
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400 font-medium">
                RAM Disponible (Piso Anti-OOM:
                {{ liveTelemetry?.host.safetyFloorMb || 260 }} MB)
              </span>
              <span class="font-mono font-bold text-white">
                <template v-if="liveTelemetry">
                  Libre: {{ liveTelemetry.host.ramAvailableMb }} MB ({{
                    liveTelemetry.host.ramPercent
                  }}% usado)
                </template>
                <template v-else>
                  {{ panelStore.host.memory.usagePercent }}% usado
                </template>
              </span>
            </div>
            <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="ramBarColorClass"
                :style="{
                  width: `${
                    liveTelemetry?.host.ramPercent ??
                    panelStore.host.memory.usagePercent
                  }%`,
                }"
              ></div>
            </div>
          </div>
        </div>

        <!-- Tabla TOP de Procesos del Sistema Ejecutándose -->
        <div
          class="border border-slate-800/90 rounded-lg overflow-hidden max-h-40 overflow-y-auto scrollbar-thin"
        >
          <table class="w-full text-left font-mono text-[11px]">
            <thead
              class="bg-slate-900 text-slate-400 uppercase text-[10px] sticky top-0"
            >
              <tr>
                <th class="py-1.5 px-2.5">PID</th>
                <th class="py-1.5 px-2">STAT</th>
                <th class="py-1.5 px-2 text-right">%CPU</th>
                <th class="py-1.5 px-2 text-right">RAM (RSS)</th>
                <th class="py-1.5 px-2 text-right">TIME</th>
                <th class="py-1.5 px-2.5">PROCESO / COMANDO EN EJECUCIÓN</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/70">
              <tr
                v-for="proc in liveTelemetry?.processes || []"
                :key="proc.pid"
                class="hover:bg-slate-900/60"
              >
                <td class="py-1 px-2.5 text-indigo-400 font-semibold">
                  {{ proc.pid }}
                </td>
                <td class="py-1 px-2">
                  <span
                    class="px-1.5 py-0.5 rounded text-[9px] font-bold"
                    :class="
                      proc.state.startsWith('R')
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-slate-800 text-slate-400'
                    "
                  >
                    {{ proc.state }}
                  </span>
                </td>
                <td
                  class="py-1 px-2 text-right font-bold"
                  :class="
                    proc.cpuPercent >= 50
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  "
                >
                  {{ proc.cpuPercent.toFixed(1) }}%
                </td>
                <td class="py-1 px-2 text-right text-cyan-300">
                  {{ proc.rssMb }} MB
                </td>
                <td class="py-1 px-2 text-right text-slate-400">
                  {{ proc.elapsed }}
                </td>
                <td
                  class="py-1 px-2.5 text-slate-200 truncate max-w-[360px]"
                  :title="proc.args"
                >
                  <span class="text-indigo-300 font-bold mr-1.5">
                    [{{ proc.command }}]
                  </span>
                  <span>{{ proc.args }}</span>
                </td>
              </tr>
              <tr
                v-if="!liveTelemetry || liveTelemetry.processes.length === 0"
              >
                <td
                  colspan="6"
                  class="py-3 text-center text-slate-500 font-sans"
                >
                  {{
                    activeTask.status === 'running'
                      ? 'Capturando árbol de procesos activos del sistema (ps / top)...'
                      : 'Proceso finalizado — no quedan subprocesos activos en ejecución.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Estado en Vivo de Contenedores Creándose / Iniciándose -->
        <div
          v-if="liveTelemetry && liveTelemetry.containers.length > 0"
          class="flex flex-wrap items-center gap-1.5 pt-0.5"
        >
          <span class="text-[10px] font-bold uppercase text-slate-400 mr-1">
            Contenedores:
          </span>
          <span
            v-for="cnt in liveTelemetry.containers"
            :key="cnt.name"
            class="px-2 py-0.5 rounded-full text-[10px] font-mono border flex items-center gap-1.5"
            :class="
              cnt.state === 'running'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : cnt.state === 'created' || cnt.state === 'restarting'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            "
          >
            <span
              class="w-1.5 h-1.5 rounded-full"
              :class="
                cnt.state === 'running'
                  ? 'bg-emerald-400'
                  : cnt.state === 'created' || cnt.state === 'restarting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-400'
              "
            ></span>
            <span>{{ cnt.name }}</span>
            <span class="text-slate-400">({{ cnt.status || cnt.state }})</span>
          </span>
        </div>
      </div>

      <!-- SALIDA DE TERMINAL PASO A PASO EN TIEMPO REAL -->
      <div
        ref="outputContainer"
        @scroll="handleScroll"
        class="flex-1 min-h-[260px] bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs font-mono overflow-auto scrollbar-thin space-y-0.5"
      >
        <div
          v-for="line in parsedLines"
          :key="line.id"
          class="whitespace-pre-wrap break-words leading-relaxed"
          :class="line.lineClass"
        >
          {{ line.text }}
        </div>
        <div
          v-if="parsedLines.length === 0"
          class="text-slate-500 italic py-4"
        >
          Esperando salida del proceso...
        </div>
      </div>

      <!-- PIE DE ACCIONES -->
      <div class="flex flex-wrap justify-between items-center gap-2 pt-1">
        <div class="flex items-center gap-3">
          <button
            @click="copyText(effectiveOutput, 'Salida completa copiada')"
            class="text-xs text-indigo-400 hover:underline font-medium"
          >
            <i class="fa-regular fa-copy mr-1"></i>Copiar salida ({{
              parsedLines.length
            }}
            líneas)
          </button>

          <button
            @click="autoScroll = !autoScroll"
            class="text-xs px-2.5 py-1 rounded-lg border transition"
            :class="
              autoScroll
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            "
          >
            <i class="fa-solid fa-angles-down mr-1"></i>
            Auto-scroll: {{ autoScroll ? 'ON' : 'OFF' }}
          </button>
        </div>

        <button
          @click="close"
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
        >
          {{
            activeTask?.status === 'running'
              ? 'Minimizar (sigue en segundo plano)'
              : 'Cerrar'
          }}
        </button>
      </div>
    </div>
  </div>
</template>
