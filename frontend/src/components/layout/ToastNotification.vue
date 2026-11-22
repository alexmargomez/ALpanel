<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  type BackgroundTaskItem,
  dismissBackgroundTask,
  openTaskConsole,
  panelStore,
} from '../../composables/usePanelStore';

const nowMs = ref(Date.now());
let timerInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  timerInterval = setInterval(() => {
    if (panelStore.backgroundTasks.some((t) => t.status === 'running')) {
      nowMs.value = Date.now();
    }
  }, 1000);
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});

function formatDuration(task: BackgroundTaskItem): string {
  const end = task.finishedAt || nowMs.value;
  const secs = Math.max(1, Math.round((end - task.startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}
</script>

<template>
  <!-- Centro de Tareas Asíncronas y Telemetría en la Parte Inferior Izquierda -->
  <div
    class="fixed bottom-4 left-4 z-50 flex flex-col gap-2.5 max-w-md w-[calc(100vw-2rem)] sm:w-[410px] pointer-events-none"
  >
    <!-- Notificación Toast Rápida -->
    <div
      v-if="panelStore.toast.visible"
      class="pointer-events-auto text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center justify-between gap-2 transition-all border"
      :class="
        panelStore.toast.isError
          ? 'bg-rose-600 border-rose-400/40'
          : 'bg-indigo-600 border-indigo-400/40'
      "
    >
      <div class="flex items-center gap-2 min-w-0">
        <i
          class="fa-solid shrink-0 keep-white"
          :class="
            panelStore.toast.isError
              ? 'fa-circle-exclamation'
              : 'fa-circle-check'
          "
        ></i>
        <span class="truncate keep-white">{{ panelStore.toast.message }}</span>
      </div>
      <button
        @click="panelStore.toast.visible = false"
        class="text-white/80 hover:text-white shrink-0 px-1 keep-white"
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- Tarjetas de Procesos en Segundo Plano con Telemetría Viva -->
    <div
      v-for="task in panelStore.backgroundTasks"
      :key="task.id"
      class="pointer-events-auto rounded-2xl p-3.5 shadow-2xl border backdrop-blur-md transition-all bg-slate-900/95"
      :class="{
        'border-indigo-500/50': task.status === 'running',
        'border-emerald-500/60': task.status === 'success',
        'border-rose-500/60': task.status === 'error',
      }"
    >
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex items-start gap-2.5 min-w-0 flex-1">
          <!-- Icono de Estado -->
          <div
            class="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            :class="{
              'bg-indigo-500/20 text-indigo-400': task.status === 'running',
              'bg-emerald-500/20 text-emerald-400': task.status === 'success',
              'bg-rose-500/20 text-rose-400': task.status === 'error',
            }"
          >
            <i
              v-if="task.status === 'running'"
              class="fa-solid fa-circle-notch fa-spin text-xs"
            ></i>
            <i
              v-else-if="task.status === 'success'"
              class="fa-solid fa-circle-check text-sm"
            ></i>
            <i v-else class="fa-solid fa-triangle-exclamation text-xs"></i>
          </div>

          <!-- Contenido de la Alerta -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                class="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded"
                :class="{
                  'bg-indigo-500/20 text-indigo-300': task.status === 'running',
                  'bg-emerald-500/20 text-emerald-300':
                    task.status === 'success',
                  'bg-rose-500/20 text-rose-300': task.status === 'error',
                }"
              >
                {{
                  task.status === 'running'
                    ? task.phase || 'En ejecución'
                    : task.status === 'success'
                      ? 'Completado'
                      : 'Error'
                }}
              </span>
              <span class="text-[10px] font-mono text-slate-400">
                ⏱ {{ formatDuration(task) }}
              </span>
            </div>

            <div class="text-xs font-bold text-white truncate mt-1">
              {{ task.title }}
            </div>

            <!-- Línea actual del stream en tiempo real -->
            <p
              class="text-[11px] text-slate-300 line-clamp-2 mt-0.5 break-words font-mono"
            >
              {{ task.message }}
            </p>

            <!-- Mini Telemetría TOP en Vivo -->
            <div
              v-if="task.status === 'running' && task.telemetry"
              class="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1"
            >
              <span class="text-indigo-400 font-semibold">
                <i class="fa-solid fa-microchip mr-1"></i>{{
                  task.telemetry.processes.length
                }}
                procs
              </span>
              <span>·</span>
              <span class="text-emerald-400 font-semibold">
                RAM libre: {{ task.telemetry.host.ramAvailableMb }} MB
              </span>
              <span v-if="task.telemetry.processes[0]" class="truncate max-w-[130px]">
                · {{ task.telemetry.processes[0].command }}
              </span>
            </div>

            <div class="mt-2 flex items-center gap-2">
              <button
                @click="openTaskConsole(task)"
                class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition flex items-center gap-1"
                :class="{
                  'bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30':
                    task.status === 'running',
                  'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30':
                    task.status === 'success',
                  'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30':
                    task.status === 'error',
                }"
              >
                <i class="fa-solid fa-terminal text-[10px]"></i>
                <span>
                  {{
                    task.status === 'running'
                      ? 'Monitor TOP & Consola en vivo'
                      : 'Ver salida completa / Logs'
                  }}
                </span>
              </button>

              <button
                v-if="task.status !== 'running'"
                @click="dismissBackgroundTask(task.id)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>

        <button
          @click="dismissBackgroundTask(task.id)"
          class="text-slate-400 hover:text-white shrink-0 px-1"
          :title="
            task.status === 'running'
              ? 'Ocultar tarjeta (la tarea seguirá ejecutándose en segundo plano)'
              : 'Cerrar notificación'
          "
        >
          <i class="fa-solid fa-xmark text-sm"></i>
        </button>
      </div>
    </div>
  </div>
</template>
