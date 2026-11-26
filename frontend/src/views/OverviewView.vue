<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  focusProjectCard,
  hasPerm,
  openErdModal,
  openLogsModal,
  openProjectWorkspace,
  openTerminalModal,
  panelStore,
  pruneServerDocker,
  runProjectAction,
  switchTab,
} from '../composables/usePanelStore';
import { formatBytes, formatUptime } from '../services/api';
import type { ProjectInfo } from '../types/panel';

const viewMode = ref<'overview' | 'pipeline'>('overview');
const chartMetric = ref<'ram' | 'cpu' | 'disk'>('ram');
const pipelineFilter = ref<'all' | 'active' | 'db'>('all');

const firstName = computed(() => {
  const raw =
    panelStore.currentUser?.fullName ||
    panelStore.currentUser?.username ||
    'Admin';
  return raw.trim().split(/\s+/)[0];
});

const greetingText = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
});

const formattedToday = computed(() => {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date());
  } catch {
    return 'Hoy';
  }
});

const filteredProjects = computed<ProjectInfo[]>(() => {
  const q = (panelStore.projectSearchQuery || '').trim().toLowerCase();
  let list = panelStore.projects;
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.domains.some((d) => d.toLowerCase().includes(q)) ||
        p.stack.some((s) => s.toLowerCase().includes(q))
    );
  }
  if (viewMode.value === 'pipeline') {
    if (pipelineFilter.value === 'active') {
      list = list.filter((p) => p.status === 'running');
    } else if (pipelineFilter.value === 'db') {
      list = list.filter((p) => p.database?.hasDatabase);
    }
  }
  return list;
});

const runningProjectsCount = computed(
  () => panelStore.projects.filter((p) => p.status === 'running').length
);

const totalContainersCount = computed(() =>
  panelStore.projects.reduce((acc, p) => acc + (p.containers?.length || 0), 0)
);

const runningContainersCount = computed(() =>
  panelStore.projects.reduce(
    (acc, p) =>
      acc +
      (p.containers?.filter((c) => c.state === 'running').length || 0),
    0
  )
);

const pendingGitUpdates = computed(() =>
  panelStore.projects.filter((p) => (p.git?.behindCount || 0) > 0)
);

const healthRatePercent = computed(() => {
  const total = panelStore.projects.length;
  if (!total) return 100;
  return Math.round((runningProjectsCount.value / total) * 100);
});

const totalAllocatedProjectRam = computed(() =>
  panelStore.projects.reduce(
    (acc, p) => acc + (p.resources?.memoryBytes || 0),
    0
  )
);

const chartBars = computed(() => {
  const list = filteredProjects.value.slice(0, 12);
  if (list.length === 0) return [];

  const getVal = (p: ProjectInfo): number => {
    if (chartMetric.value === 'cpu') return p.resources?.cpuPercent || 0;
    if (chartMetric.value === 'disk') return p.resources?.diskBytes || 0;
    return p.resources?.memoryBytes || 0;
  };

  const values = list.map(getVal);
  const maxVal = Math.max(...values, 1);
  let peakIdx = 0;
  values.forEach((v, idx) => {
    if (v >= values[peakIdx]) peakIdx = idx;
  });

  return list.map((p, idx) => {
    const raw = getVal(p);
    const ratio = maxVal > 0 ? (raw / maxVal) * 100 : 12;
    const heightPct = Math.max(16, Math.min(100, Math.round(ratio)));
    const formatted =
      chartMetric.value === 'cpu'
        ? `${raw.toFixed(1)}%`
        : formatBytes(raw);

    return {
      project: p,
      shortName: p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name,
      raw,
      heightPct,
      formatted,
      isPeak: idx === peakIdx,
    };
  });
});

const rankedProjects = computed(() => {
  const sorted = [...panelStore.projects].sort(
    (a, b) => (b.resources?.memoryBytes || 0) - (a.resources?.memoryBytes || 0)
  );
  const maxMem = Math.max(
    ...sorted.map((p) => p.resources?.memoryBytes || 0),
    1
  );
  const barClasses = [
    'bg-emerald-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-cyan-500',
    'bg-amber-500',
  ];

  return sorted.slice(0, 6).map((p, idx) => {
    const mem = p.resources?.memoryBytes || 0;
    const pct = Math.max(10, Math.round((mem / maxMem) * 100));
    return {
      project: p,
      pct,
      barClass: barClasses[idx % barClasses.length],
      memFormatted: formatBytes(mem),
      containersCount: p.containers?.length || 0,
    };
  });
});

const capacityCards = computed(() => {
  const list = filteredProjects.value;
  const maxDisk = Math.max(
    ...list.map((p) => p.resources?.diskBytes || 0),
    100 * 1024 * 1024
  );
  const maxRam = Math.max(
    ...list.map((p) => p.resources?.memoryBytes || 0),
    64 * 1024 * 1024
  );

  return list.map((p) => {
    const diskRatio = Math.max(
      42,
      Math.min(92, Math.round(((p.resources?.diskBytes || 0) / maxDisk) * 92))
    );
    const ramRatio = Math.max(
      28,
      Math.min(
        diskRatio - 8,
        Math.round(((p.resources?.memoryBytes || 0) / maxRam) * 78)
      )
    );
    const activeCont =
      p.containers?.filter((c) => c.state === 'running').length || 0;
    const totalCont = Math.max(p.containers?.length || 1, 1);
    const healthRatio =
      activeCont === 0
        ? 0
        : Math.max(
            18,
            Math.min(ramRatio - 8, Math.round((activeCont / totalCont) * 58))
          );

    const dbCont = p.containers?.find((c) => c.role === 'database');

    return {
      project: p,
      diskRatio,
      ramRatio,
      healthRatio,
      activeCont,
      totalCont,
      dbContainerName: dbCont?.name || '',
    };
  });
});

const nextBestMove = computed(() => {
  if (pendingGitUpdates.value.length > 0) {
    const target = pendingGitUpdates.value[0];
    return {
      tag: 'ACTUALIZACIÓN GIT PENDIENTE',
      title: `${target.name} (${target.git.behindCount} commits)`,
      subtitle: 'Hay cambios listos en origin/main para desplegar.',
      actionLabel: 'Aplicar Git Pull',
      run: () => runProjectAction(target.name, 'pull'),
    };
  }
  const stopped = panelStore.projects.find((p) => p.status === 'stopped');
  if (stopped) {
    return {
      tag: 'SERVICIO DETENIDO',
      title: stopped.name,
      subtitle: 'Este proyecto tiene sus contenedores detenidos.',
      actionLabel: 'Iniciar Contenedores',
      run: () => runProjectAction(stopped.name, 'start'),
    };
  }
  if (panelStore.host.disk.usagePercent >= 75) {
    return {
      tag: 'OPTIMIZACIÓN DE DISCO',
      title: `Disco al ${panelStore.host.disk.usagePercent}%`,
      subtitle: 'Libera imágenes huérfanas y caché de compilación Docker.',
      actionLabel: 'Ejecutar Prune',
      run: () => pruneServerDocker(),
    };
  }
  return {
    tag: 'ACCIONES RÁPIDAS DEL CLÚSTER',
    title: 'Desplegar Nuevo Servicio',
    subtitle: 'RAM Guard activo y puertos auto-balanceados listos.',
    actionLabel: 'Clonar Repositorio',
    run: () => {
      panelStore.modals.clone.open = true;
    },
  };
});

function openClone(): void {
  panelStore.modals.clone.open = true;
}
</script>

<template>
  <section class="space-y-5 pb-6">
    <!-- HERO HEADER CON TIPOGRAFÍA Y PALETA ORIGINAL DE ALPANEL -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-1">
      <div class="space-y-2">
        <div>
          <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {{
              viewMode === 'overview'
                ? `${greetingText}, ${firstName}`
                : 'Pipeline de Infraestructura'
            }}
          </h1>
          <div class="h-1 w-32 rounded-full bg-indigo-500 mt-1.5"></div>
        </div>

        <p class="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-slate-200 font-semibold">
            {{ panelStore.host.distro || 'Linux VPS' }}
          </span>
          <span>·</span>
          <span>{{ formattedToday }}</span>
          <span>·</span>
          <span class="text-emerald-400 font-semibold">
            {{ runningProjectsCount }} proyectos activos
          </span>
          <span>·</span>
          <span>{{ runningContainersCount }} contenedores corriendo</span>
          <span>·</span>
          <span>Uptime {{ formatUptime(panelStore.host.uptimeSeconds) }}</span>
        </p>

        <!-- Selector de Vista (Overview / Forecast & Capacidad / Gestión Detallada) -->
        <div class="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            @click="viewMode = 'overview'"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold transition border"
            :class="
              viewMode === 'overview'
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800'
            "
          >
            Overview
          </button>
          <button
            @click="viewMode = 'pipeline'"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold transition border"
            :class="
              viewMode === 'pipeline'
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/20'
                : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800'
            "
          >
            Forecast & Capacidad
          </button>
          <button
            @click="switchTab('projects')"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition flex items-center gap-1.5"
          >
            <span>Gestión Detallada</span>
            <i class="fa-solid fa-arrow-right text-[10px]"></i>
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="hasPerm('security', 'view')"
          @click="switchTab('audit')"
          class="px-3.5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-2 transition"
        >
          <i class="fa-solid fa-shield-halved text-indigo-400 text-[11px]"></i>
          <span>Auditoría</span>
        </button>

        <button
          v-if="hasPerm('git', 'create')"
          @click="openClone"
          class="px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/25"
        >
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Nuevo proyecto</span>
        </button>
      </div>
    </div>

    <!-- =======================================================================
         MODO 1: OVERVIEW EJECUTIVO
         ======================================================================= -->
    <template v-if="viewMode === 'overview'">
      <!-- 4 TARJETAS BENTO KPI (Indigo / Emerald / Amber / Slate — Alto Contraste Día/Noche) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <!-- KPI 1: Indigo (CPU) -->
        <div class="bento-kpi-indigo rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Carga CPU del Host</span>
              <i class="fa-solid fa-microchip text-indigo-400"></i>
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ panelStore.host.cpu.usagePercent }}%
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-2 bg-slate-950/50 border border-slate-700/60 rounded-full overflow-hidden">
              <div
                class="h-full bg-indigo-500 rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.cpu.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400 font-medium">
                {{ panelStore.host.cpu.cores }} vCPU disponibles
              </span>
              <span class="text-emerald-400 font-bold">
                ▲ {{ runningContainersCount }} activos
              </span>
            </div>
          </div>
        </div>

        <!-- KPI 2: Emerald (Memoria RAM) -->
        <div class="bento-kpi-emerald rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Memoria RAM en Uso</span>
              <i class="fa-solid fa-memory text-emerald-400"></i>
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ formatBytes(panelStore.host.memory.usedBytes) }}
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-2 bg-slate-950/50 border border-slate-700/60 rounded-full overflow-hidden">
              <div
                class="h-full bg-emerald-500 rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.memory.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="text-[11px] text-slate-400 font-medium">
              {{ panelStore.host.memory.usagePercent }}% de
              {{ formatBytes(panelStore.host.memory.totalBytes) }} totales
            </div>
          </div>
        </div>

        <!-- KPI 3: Amber (Disco SSD) -->
        <div class="bento-kpi-amber rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Almacenamiento SSD</span>
              <i class="fa-solid fa-hard-drive text-amber-400"></i>
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ formatBytes(panelStore.host.disk.usedBytes) }}
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-2 bg-slate-950/50 border border-slate-700/60 rounded-full overflow-hidden">
              <div
                class="h-full bg-amber-500 rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.disk.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="text-[11px] text-slate-400 font-medium">
              {{ panelStore.host.disk.usagePercent }}% de
              {{ formatBytes(panelStore.host.disk.totalBytes) }} ·
              <code class="font-mono text-indigo-400">{{ panelStore.projectsRoot }}</code>
            </div>
          </div>
        </div>

        <!-- KPI 4: Slate (Salud del Clúster) -->
        <div class="bento-kpi-slate rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span>Salud del Clúster</span>
              <i class="fa-solid fa-heart-pulse text-cyan-400"></i>
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ healthRatePercent }}%
            </div>
          </div>

          <div class="space-y-1.5 mt-3 text-[11px] text-slate-400">
            <div class="font-medium">
              {{ runningProjectsCount }} de
              {{ panelStore.projects.length }} proyectos corriendo
            </div>
            <div class="flex items-center gap-2 text-slate-300 font-medium">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>
                {{ panelStore.domainRoutes.length }} dominios HTTPS activos
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- GRID PRINCIPAL DE ANALÍTICA (8 COLS BARRAS VERTICALES + 4 COLS RANKING HORIZONTAL) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <!-- Tarjeta Izquierda (8 cols): Gráfico Vertical de Barras -->
        <div
          class="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl"
        >
          <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 class="text-sm font-bold text-white">
                Consumo de Recursos por Proyecto
              </h2>
              <p class="text-[11px] text-slate-400 mt-0.5">
                Comparativa en tiempo real entre contenedores desplegados — clic en una barra para inspeccionar
              </p>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <div class="hidden sm:flex items-center gap-3 text-[11px] text-slate-400">
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
                  Proyecto
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Mayor carga
                </span>
              </div>

              <div
                class="flex items-center bg-slate-950 p-0.5 rounded-full border border-slate-800 text-[11px]"
              >
                <button
                  @click="chartMetric = 'ram'"
                  class="px-2.5 py-1 rounded-full font-semibold transition"
                  :class="
                    chartMetric === 'ram'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  "
                >
                  RAM
                </button>
                <button
                  @click="chartMetric = 'cpu'"
                  class="px-2.5 py-1 rounded-full font-semibold transition"
                  :class="
                    chartMetric === 'cpu'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  "
                >
                  CPU
                </button>
                <button
                  @click="chartMetric = 'disk'"
                  class="px-2.5 py-1 rounded-full font-semibold transition"
                  :class="
                    chartMetric === 'disk'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  "
                >
                  Disco
                </button>
              </div>
            </div>
          </div>

          <div
            v-if="chartBars.length > 0"
            class="relative h-60 pt-6 pb-1 px-1 flex items-end gap-2.5 sm:gap-3.5 border-b border-slate-800"
          >
            <div
              class="absolute left-0 right-0 top-12 border-t border-dashed border-slate-700 pointer-events-none flex justify-end pr-2"
            >
              <span
                class="text-[9px] uppercase tracking-wider text-slate-400 -mt-4 bg-slate-900 px-1.5 rounded"
              >
                Umbral Pico
              </span>
            </div>

            <button
              v-for="bar in chartBars"
              :key="bar.project.name"
              @click="focusProjectCard(bar.project.name)"
              class="group relative flex-1 h-full flex flex-col justify-end items-center min-w-0 focus:outline-none"
              :title="`${bar.project.name}: ${bar.formatted}`"
            >
              <div
                class="w-full h-full bg-slate-950/70 group-hover:bg-slate-800/80 border border-slate-800/60 rounded-xl flex flex-col justify-end overflow-hidden p-0.5 transition"
              >
                <span
                  class="opacity-0 group-hover:opacity-100 transition text-[10px] font-mono font-bold text-white mb-1 text-center truncate px-1"
                >
                  {{ bar.formatted }}
                </span>

                <div
                  class="w-full rounded-xl transition-all duration-500 group-hover:brightness-110"
                  :class="
                    bar.isPeak
                      ? 'bg-emerald-500 shadow-lg shadow-emerald-500/25'
                      : 'bg-indigo-500'
                  "
                  :style="{ height: `${bar.heightPct}%` }"
                ></div>
              </div>
            </button>
          </div>

          <div
            v-if="chartBars.length > 0"
            class="flex items-center gap-2.5 sm:gap-3.5 pt-2.5 px-1"
          >
            <div
              v-for="bar in chartBars"
              :key="`lbl-${bar.project.name}`"
              class="flex-1 min-w-0 text-center text-[10px] font-medium truncate"
              :class="bar.isPeak ? 'text-emerald-400 font-bold' : 'text-slate-400'"
            >
              {{ bar.shortName }}
            </div>
          </div>

          <div
            v-else
            class="h-56 flex flex-col items-center justify-center text-slate-400 text-xs gap-2"
          >
            <i class="fa-solid fa-layer-group text-xl text-slate-500"></i>
            <span>No hay proyectos que coincidan con el filtro actual.</span>
          </div>
        </div>

        <!-- Tarjeta Derecha (4 cols): Proyectos por Carga -->
        <div
          class="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between shadow-xl"
        >
          <div>
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-sm font-bold text-white">Proyectos por Carga</h2>
              <button
                @click="switchTab('projects')"
                class="text-[11px] font-semibold text-indigo-400 hover:underline flex items-center gap-1 transition"
              >
                <span>Tablero</span>
                <i class="fa-solid fa-chevron-right text-[9px]"></i>
              </button>
            </div>
            <p class="text-[11px] text-slate-400 mb-4">
              Memoria RAM activa y contenedores por nodo
            </p>

            <div class="space-y-3.5">
              <button
                v-for="item in rankedProjects"
                :key="item.project.name"
                @click="focusProjectCard(item.project.name)"
                class="w-full grid grid-cols-12 items-center gap-2.5 text-left group"
              >
                <div class="col-span-4 min-w-0">
                  <div
                    class="text-xs font-semibold text-white group-hover:text-indigo-400 truncate transition"
                  >
                    {{ item.project.name }}
                  </div>
                  <div class="text-[10px] text-slate-400 truncate">
                    {{ item.containersCount }} cont. ·
                    {{ item.project.status === 'running' ? 'Activo' : 'Parcial' }}
                  </div>
                </div>

                <div class="col-span-5">
                  <div class="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      :class="item.barClass"
                      :style="{ width: `${item.pct}%` }"
                    ></div>
                  </div>
                </div>

                <div
                  class="col-span-3 text-right font-mono text-[11px] font-semibold text-slate-200"
                >
                  {{ item.memFormatted }}
                </div>
              </button>
            </div>
          </div>

          <div
            class="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400"
          >
            <span>Total contenedores</span>
            <strong class="text-white font-mono">
              {{ runningContainersCount }} / {{ totalContainersCount }} online
            </strong>
          </div>
        </div>
      </div>

      <!-- FILA INFERIOR DE 3 TARJETAS DE ACCIÓN -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <!-- Card 1: Siguiente Paso / Acción Rápida -->
        <div
          class="bento-kpi-indigo rounded-2xl p-4 flex flex-col justify-between gap-3"
        >
          <div>
            <div
              class="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-400"
            >
              <i class="fa-solid fa-wand-magic-sparkles"></i>
              <span>{{ nextBestMove.tag }}</span>
            </div>
            <div class="text-base font-bold text-white mt-1">
              {{ nextBestMove.title }}
            </div>
            <p class="text-[11px] text-slate-300 mt-0.5">
              {{ nextBestMove.subtitle }}
            </p>
          </div>

          <div class="flex items-center justify-between pt-1">
            <button
              @click="nextBestMove.run"
              class="px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition shadow"
            >
              {{ nextBestMove.actionLabel }}
            </button>
            <button
              @click="viewMode = 'pipeline'"
              class="text-[11px] text-indigo-400 hover:underline font-semibold"
            >
              Ver Forecast ›
            </button>
          </div>
        </div>

        <!-- Card 2: Dominios & Proxy SSL -->
        <div
          class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-xl"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white">Dominios &amp; SSL</span>
              <button
                @click="
                  panelStore.domainRoutes[0]?.projectName
                    ? openProjectWorkspace(panelStore.domainRoutes[0].projectName, 'domains')
                    : switchTab('projects')
                "
                class="text-[11px] text-indigo-400 hover:underline font-semibold"
              >
                Por Proyecto ›
              </button>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              {{ panelStore.domainRoutes.length }} dominios activos ·
              <button
                @click="switchTab('servers')"
                class="text-indigo-400 hover:underline font-semibold"
              >
                {{ panelStore.servers.length || 1 }} servidor(es)
              </button>
            </div>

            <div class="mt-2.5 space-y-1.5">
              <div
                v-for="r in panelStore.domainRoutes.slice(0, 3)"
                :key="r.id"
                class="flex items-center justify-between text-xs bg-slate-950 border border-slate-800/80 px-2.5 py-1.5 rounded-xl"
              >
                <a
                  :href="`https://${r.domain}`"
                  target="_blank"
                  class="text-slate-200 hover:text-indigo-400 truncate font-medium flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-lock text-[9px] text-emerald-400"></i>
                  <span class="truncate">{{ r.domain }}</span>
                </a>
                <button
                  @click="openProjectWorkspace(r.projectName, 'domains')"
                  class="text-[10px] font-mono text-indigo-400 hover:underline shrink-0 ml-2"
                  title="Administrar dominios de este proyecto"
                >
                  {{ r.projectName }} ›
                </button>
              </div>
              <div
                v-if="panelStore.domainRoutes.length === 0"
                class="text-[11px] text-slate-500 py-2"
              >
                Entra a <strong>Administrar</strong> en cualquier proyecto para vincular dominios HTTPS.
              </div>
            </div>
          </div>
        </div>

        <!-- Card 3: Escudo DDoS & RAM Guard -->
        <div
          class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-xl"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white">Escudo & RAM Guard</span>
              <button
                @click="switchTab('audit')"
                class="text-[11px] text-indigo-400 hover:underline font-semibold"
              >
                Seguridad ›
              </button>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              Token Bucket + Watchdog Anti-OOM (400ms)
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div class="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5">
                <div class="text-[10px] text-slate-400">Estado Escudo</div>
                <div class="font-bold text-emerald-400 text-xs mt-0.5">
                  {{ panelStore.securityShield?.protectionMode || 'ACTIVO' }}
                </div>
              </div>
              <div class="bg-slate-950 border border-slate-800/80 rounded-xl p-2.5">
                <div class="text-[10px] text-slate-400">Tareas Async</div>
                <div class="font-bold text-white text-xs mt-0.5">
                  {{ panelStore.backgroundTasks.length }} recientes
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- =======================================================================
         MODO 2: PIPELINE & CAPACIDAD CONCÉNTRICA
         ======================================================================= -->
    <template v-else>
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-xl">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-xs font-bold text-white">
              Mapa de Capacidad por Nodo
            </div>
            <p class="text-[11px] text-slate-400 mt-0.5">
              Salud activa = contenedores corriendo · RAM = memoria dedicada · Base = huella en disco
            </p>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="text-3xl font-extrabold text-white tracking-tight">
                {{ formatBytes(totalAllocatedProjectRam) }}
              </span>
              <span class="text-xs text-slate-400">
                RAM dedicada en {{ capacityCards.length }} proyectos
              </span>
            </div>
          </div>

          <div
            class="flex items-center bg-slate-950 p-1 rounded-full border border-slate-800 text-xs"
          >
            <button
              @click="pipelineFilter = 'all'"
              class="px-3 py-1 rounded-full font-semibold transition"
              :class="
                pipelineFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              "
            >
              Todos
            </button>
            <button
              @click="pipelineFilter = 'active'"
              class="px-3 py-1 rounded-full font-semibold transition"
              :class="
                pipelineFilter === 'active'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              "
            >
              Activos
            </button>
            <button
              @click="pipelineFilter = 'db'"
              class="px-3 py-1 rounded-full font-semibold transition"
              :class="
                pipelineFilter === 'db'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              "
            >
              Con Base de Datos
            </button>
          </div>
        </div>

        <!-- Tarjetas Visuales de Bloques Concéntricos (Slate -> Indigo -> Emerald) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <button
            v-for="card in capacityCards"
            :key="`cap-${card.project.name}`"
            @click="focusProjectCard(card.project.name)"
            class="text-left group focus:outline-none space-y-2.5"
          >
            <div
              class="relative h-44 rounded-2xl bg-slate-950 border border-slate-800 group-hover:border-indigo-500/60 overflow-hidden flex items-end justify-center transition"
            >
              <!-- Capa 1: Disco / Huella Total -->
              <div
                class="rounded-t-2xl bg-indigo-500/20 border-t border-x border-indigo-500/30 transition-all duration-500 flex items-end justify-center"
                :style="{
                  width: `${card.diskRatio}%`,
                  height: `${card.diskRatio}%`,
                }"
              >
                <!-- Capa 2: Memoria RAM -->
                <div
                  class="rounded-t-xl bg-indigo-500/75 transition-all duration-500 flex items-end justify-center"
                  :style="{
                    width: '78%',
                    height: `${Math.max(35, card.ramRatio)}%`,
                  }"
                >
                  <!-- Capa 3: Salud / Contenedores Activos -->
                  <div
                    v-if="card.healthRatio > 0"
                    class="rounded-t-lg bg-emerald-400 shadow-lg shadow-emerald-500/30 transition-all duration-500"
                    :style="{
                      width: '68%',
                      height: `${Math.max(40, card.healthRatio)}%`,
                    }"
                  ></div>
                </div>
              </div>

              <span
                class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-900/90 border border-slate-700 text-slate-200"
              >
                {{ card.activeCont }}/{{ card.totalCont }} online
              </span>
            </div>

            <div class="px-0.5">
              <div
                class="text-xs font-bold text-white group-hover:text-indigo-400 truncate transition"
              >
                {{ card.project.name }}
              </div>
              <div class="text-[11px] text-slate-400 font-mono">
                {{ formatBytes(card.project.resources.memoryBytes) }} RAM ·
                {{ formatBytes(card.project.resources.diskBytes) }} Disco
              </div>
            </div>
          </button>
        </div>

        <!-- Leyenda de Capas -->
        <div class="flex flex-wrap items-center gap-5 pt-1 text-[11px] text-slate-400">
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            Contenedores Activos
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
            Memoria RAM
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-indigo-500/30 border border-indigo-500/50"></span>
            Huella en Disco
          </span>
        </div>
      </div>

      <!-- Columnas Inferiores de Detalle Rápido por Proyecto -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div
          v-for="card in capacityCards"
          :key="`detail-${card.project.name}`"
          class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3 shadow-xl"
        >
          <div>
            <div
              class="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-800"
            >
              <button
                @click="focusProjectCard(card.project.name)"
                class="text-xs font-bold text-white hover:text-indigo-400 truncate"
              >
                {{ card.project.name }}
              </button>
              <span class="text-[10px] text-slate-400 shrink-0">
                {{ card.project.containers.length }} servicios
              </span>
            </div>

            <div class="mt-2.5 space-y-2">
              <div
                v-for="c in card.project.containers.slice(0, 4)"
                :key="c.id"
                class="flex items-center justify-between text-[11px] gap-2"
              >
                <div class="min-w-0">
                  <div
                    class="font-medium text-slate-200 truncate flex items-center gap-1.5"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      :class="
                        c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'
                      "
                    ></span>
                    <span class="truncate">{{ c.name }}</span>
                  </div>
                  <div class="text-[10px] text-slate-500 truncate pl-3">
                    {{ c.role }} · {{ c.image }}
                  </div>
                </div>
                <span class="font-mono text-[10px] text-slate-300 shrink-0">
                  {{ formatBytes(c.memoryBytes) }}
                </span>
              </div>
            </div>
          </div>

          <div
            class="pt-2.5 border-t border-slate-800 flex flex-wrap items-center gap-1.5"
          >
            <button
              @click="openLogsModal(card.project.name)"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 transition"
            >
              Logs
            </button>
            <button
              @click="openTerminalModal(card.project.name, '', 'shell')"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 transition"
            >
              Terminal
            </button>
            <button
              v-if="card.dbContainerName"
              @click="openErdModal(card.project.name, card.dbContainerName)"
              class="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-[10px] font-semibold text-indigo-300 transition"
            >
              DER / ERD
            </button>
            <button
              @click="focusProjectCard(card.project.name)"
              class="ml-auto text-[10px] font-semibold text-indigo-400 hover:underline"
            >
              Abrir ›
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
