<script setup lang="ts">
import {
  hasPerm,
  openAddContainerModal,
  openLogsModal,
  openMicroservicesModal,
  openTerminalModal,
  runProjectAction,
} from '../../composables/usePanelStore';
import type { ProjectInfo } from '../../types/panel';

const props = defineProps<{
  project: ProjectInfo;
}>();

function handleContainerRebuild(containerName: string): void {
  if (
    !confirm(
      `¿Reconstruir la imagen y recrear únicamente el contenedor "${containerName}" sin destruir los demás servicios ni la base de datos?`
    )
  ) {
    return;
  }
  runProjectAction(props.project.name, 'rebuild', { containerName });
}
</script>

<template>
  <div class="space-y-4">
    <!-- Barra de acciones de Contenedores -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <i class="fa-brands fa-docker text-sky-400"></i>
          <span>Contenedores &amp; Topología del Proyecto</span>
        </h3>
        <p class="text-[11px] text-slate-400">
          Red aislada:
          <code class="text-emerald-300 font-mono">
            {{ project.isolatedNetwork || `alpanel_isolated_${project.name.toLowerCase()}_net` }}
          </code>
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="project.microservices?.isMicroservicesArchitecture"
          @click="openMicroservicesModal(project.name)"
          class="px-3 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <i class="fa-solid fa-cubes"></i>
          <span>Gestionar Microservicios</span>
        </button>

        <button
          @click="openAddContainerModal(project.name)"
          class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Nuevo Contenedor</span>
        </button>
      </div>
    </div>

    <!-- Lista de Contenedores Locales -->
    <div
      v-if="project.containers.length === 0"
      class="bg-slate-950/60 border border-dashed border-slate-800 rounded-2xl p-8 text-center space-y-3"
    >
      <div class="text-slate-400 text-xs">
        Este proyecto todavía no tiene contenedores en ejecución.
      </div>
      <button
        @click="openAddContainerModal(project.name)"
        class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
      >
        <i class="fa-solid fa-plus mr-1.5"></i>Agregar Primer Contenedor
      </button>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div
        v-for="c in project.containers"
        :key="c.name"
        class="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-3.5 flex flex-col justify-between gap-3 transition"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :class="c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-400'"
              ></span>
              <span class="font-mono font-bold text-xs text-white truncate">
                {{ c.name }}
              </span>
              <span
                class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-900 border border-slate-700 text-slate-300"
              >
                {{ c.role }}
              </span>
              <span
                v-if="c.isGateway"
                class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
              >
                Gateway / Core
              </span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono mt-1 truncate">
              {{ c.image }}
            </div>
            <div class="text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-2">
              <span>{{ c.status }}</span>
              <span v-if="c.internalPort" class="text-indigo-400 font-mono">
                :{{ c.internalPort }}
              </span>
              <span v-if="c.stats" class="text-emerald-400 font-mono">
                CPU {{ c.stats.cpuPercent }}% · RAM {{ c.stats.memUsage }}
              </span>
            </div>
          </div>

          <span
            class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
            :class="
              c.state === 'running'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
            "
          >
            {{ c.state === 'running' ? 'UP' : c.state.toUpperCase() }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80">
          <button
            v-if="c.state === 'running'"
            @click="openTerminalModal(project.name, c.name, 'shell')"
            class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300 text-[11px] font-semibold transition flex items-center gap-1"
          >
            <i class="fa-solid fa-terminal text-[10px]"></i>
            <span>Terminal</span>
          </button>

          <button
            @click="openLogsModal(project.name, c.name)"
            class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-semibold transition flex items-center gap-1"
          >
            <i class="fa-solid fa-file-lines text-[10px]"></i>
            <span>Logs</span>
          </button>

          <button
            v-if="hasPerm('projects', 'deploy')"
            @click="runProjectAction(project.name, 'restart', { containerName: c.name })"
            class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300 text-[11px] font-semibold transition flex items-center gap-1"
          >
            <i class="fa-solid fa-rotate-right text-[10px]"></i>
            <span>Restart</span>
          </button>

          <button
            v-if="hasPerm('projects', 'deploy')"
            @click="handleContainerRebuild(c.name)"
            class="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-semibold transition flex items-center gap-1"
          >
            <i class="fa-solid fa-hammer text-[10px]"></i>
            <span>Rebuild</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Upstreams Enlazados desde Otros Servidores -->
    <div
      v-if="project.linkedUpstreams && project.linkedUpstreams.length > 0"
      class="bg-slate-950/70 border border-violet-500/25 rounded-2xl p-4 space-y-3"
    >
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-bold text-violet-300 flex items-center gap-2">
          <i class="fa-solid fa-network-wired"></i>
          <span>Servicios Enlazados desde Otros Servidores (Multi-VPS)</span>
        </h4>
        <span class="text-[10px] text-slate-400">
          {{ project.linkedUpstreams.length }} enlace(s) remoto(s)
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div
          v-for="u in project.linkedUpstreams"
          :key="`${u.serverId}-${u.serviceName}`"
          class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs"
        >
          <div class="min-w-0">
            <div class="font-mono font-bold text-white truncate">
              {{ u.serviceName }}
            </div>
            <div class="text-[11px] text-slate-400 font-mono truncate">
              {{ u.serverName }} · {{ u.host }}:{{ u.port }}
            </div>
            <div v-if="u.envVarName" class="text-[10px] text-emerald-400 font-mono">
              .env → {{ u.envVarName }}
            </div>
          </div>
          <span
            class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30 shrink-0"
          >
            REMOTO
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
