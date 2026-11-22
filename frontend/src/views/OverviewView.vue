<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  focusProjectCard,
  hasPerm,
  openErdModal,
  openLogsModal,
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

// Datos para el Gráfico Vertical de Barras (Imagen 1)
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

// Proyectos ordenados por consumo para la tarjeta lateral "Pipeline by stage" (Imagen 1 derecha)
const rankedProjects = computed(() => {
  const sorted = [...panelStore.projects].sort(
    (a, b) => (b.resources?.memoryBytes || 0) - (a.resources?.memoryBytes || 0)
  );
  const maxMem = Math.max(
    ...sorted.map((p) => p.resources?.memoryBytes || 0),
    1
  );
  const barPalette = ['#7DB4D8', '#E5D5A7', '#7DB4D8', '#7DB4D8', '#B9F249'];

  return sorted.slice(0, 6).map((p, idx) => {
    const mem = p.resources?.memoryBytes || 0;
    const pct = Math.max(10, Math.round((mem / maxMem) * 100));
    const color =
      idx === 0 ? '#B9F249' : barPalette[idx % barPalette.length];
    return {
      project: p,
      pct,
      color,
      memFormatted: formatBytes(mem),
      containersCount: p.containers?.length || 0,
    };
  });
});

// Tarjetas Concéntricas para la vista Pipeline & Capacidad (Imágenes 2 & 3)
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
    tag: 'MEJOR SIGUIENTE PASO',
    title: 'Desplegar Nuevo Servicio',
    subtitle: 'Clúster saludable y puertos auto-balanceados listos.',
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
    <!-- HERO HEADER EDITORIAL (Estilo Sylva Imagen 1 & 2) -->
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-1">
      <div class="space-y-2">
        <div>
          <h1
            class="font-editorial text-3xl sm:text-[40px] leading-none text-white tracking-tight inline-block"
          >
            {{
              viewMode === 'overview'
                ? `${greetingText}, ${firstName}`
                : 'Pipeline de Infraestructura'
            }}
          </h1>
          <div class="h-[3px] w-44 rounded-full bg-[#B9F249] mt-1.5"></div>
        </div>

        <p class="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-slate-200 font-medium">
            {{ panelStore.host.distro || 'Linux VPS' }}
          </span>
          <span>·</span>
          <span>{{ formattedToday }}</span>
          <span>·</span>
          <span class="text-[#B9F249] font-medium">
            {{ runningProjectsCount }} proyectos activos
          </span>
          <span>·</span>
          <span>{{ runningContainersCount }} contenedores hoy</span>
          <span>·</span>
          <span>Uptime {{ formatUptime(panelStore.host.uptimeSeconds) }}</span>
        </p>

        <!-- Selector de Vista Estilo Sylva (Overview / Pipeline / Tablero Completo) -->
        <div class="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            @click="viewMode = 'overview'"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold transition border"
            :class="
              viewMode === 'overview'
                ? 'bg-white/[0.12] text-white border-white/25'
                : 'bg-white/[0.04] text-slate-400 hover:text-white border-white/[0.08]'
            "
          >
            Overview
          </button>
          <button
            @click="viewMode = 'pipeline'"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold transition border"
            :class="
              viewMode === 'pipeline'
                ? 'bg-white/[0.12] text-white border-white/25'
                : 'bg-white/[0.04] text-slate-400 hover:text-white border-white/[0.08]'
            "
          >
            Forecast & Capacidad
          </button>
          <button
            @click="switchTab('projects')"
            class="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white/[0.04] hover:bg-white/[0.09] text-slate-400 hover:text-white border border-white/[0.08] transition flex items-center gap-1.5"
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
          class="px-3.5 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 text-xs font-semibold text-slate-200 flex items-center gap-2 transition"
        >
          <i class="fa-solid fa-shield-halved text-[#7DB4D8] text-[11px]"></i>
          <span>Auditoría</span>
        </button>

        <button
          v-if="hasPerm('git', 'create')"
          @click="openClone"
          class="sylva-lime-btn rounded-full px-4 py-2 text-xs flex items-center gap-1.5"
        >
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Nuevo proyecto</span>
        </button>
      </div>
    </div>

    <!-- =======================================================================
         MODO 1: OVERVIEW EJECUTIVO (IMAGEN 1)
         ======================================================================= -->
    <template v-if="viewMode === 'overview'">
      <!-- 4 TARJETAS BENTO KPI TINTADAS -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <!-- KPI 1: Slate-Blue (CPU) -->
        <div class="sylva-card-slate rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="text-xs font-medium text-slate-200/90">
              Carga CPU del Host
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ panelStore.host.cpu.usagePercent }}%
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-2 bg-black/25 rounded-full overflow-hidden">
              <div
                class="h-full bg-white rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.cpu.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-200/80">
                {{ panelStore.host.cpu.cores }} vCPU disponibles
              </span>
              <span class="text-[#B9F249] font-semibold">
                ▲ {{ runningContainersCount }} activos
              </span>
            </div>
          </div>
        </div>

        <!-- KPI 2: Olive-Green (Memoria RAM) -->
        <div class="sylva-card-olive rounded-2xl p-5 flex flex-col justify-between min-h-[146px]">
          <div>
            <div class="text-xs font-medium text-slate-200/90">
              Memoria RAM en Uso
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ formatBytes(panelStore.host.memory.usedBytes) }}
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-1.5 bg-black/25 rounded-full overflow-hidden">
              <div
                class="h-full bg-[#B9F249] rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.memory.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="text-[11px] text-slate-200/85">
              {{ panelStore.host.memory.usagePercent }}% de
              {{ formatBytes(panelStore.host.memory.totalBytes) }} totales
            </div>
          </div>
        </div>

        <!-- KPI 3: Terracotta (Disco NVMe) -->
        <div
          class="sylva-card-terracotta rounded-2xl p-5 flex flex-col justify-between min-h-[146px]"
        >
          <div>
            <div class="text-xs font-medium text-slate-200/90">
              Almacenamiento SSD
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ formatBytes(panelStore.host.disk.usedBytes) }}
            </div>
          </div>

          <div class="space-y-2 mt-3">
            <div class="w-full h-1.5 bg-black/25 rounded-full overflow-hidden">
              <div
                class="h-full bg-[#E09F87] rounded-full transition-all duration-500"
                :style="{
                  width: `${Math.max(6, Math.min(100, panelStore.host.disk.usagePercent))}%`,
                }"
              ></div>
            </div>
            <div class="text-[11px] text-slate-200/85">
              {{ panelStore.host.disk.usagePercent }}% de
              {{ formatBytes(panelStore.host.disk.totalBytes) }} ·
              <code class="font-mono">{{ panelStore.projectsRoot }}</code>
            </div>
          </div>
        </div>

        <!-- KPI 4: Charcoal Glass (Salud del Clúster) -->
        <div
          class="sylva-card-charcoal rounded-2xl p-5 flex flex-col justify-between min-h-[146px]"
        >
          <div>
            <div class="text-xs font-medium text-slate-300">
              Salud del Clúster
            </div>
            <div class="text-3xl font-extrabold text-white tracking-tight mt-1">
              {{ healthRatePercent }}%
            </div>
          </div>

          <div class="space-y-1.5 mt-3 text-[11px] text-slate-400">
            <div>
              {{ runningProjectsCount }} de
              {{ panelStore.projects.length }} proyectos corriendo
            </div>
            <div class="flex items-center gap-2 text-slate-300">
              <span class="w-2 h-2 rounded-full bg-[#B9F249]"></span>
              <span>
                {{ panelStore.domainRoutes.length }} dominios HTTPS activos
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- GRID PRINCIPAL DE ANALÍTICA (8 COLS BARRAS VERTICALES + 4 COLS RANKING HORIZONTAL) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <!-- Tarjeta Izquierda (8 cols): Gráfico Vertical de Barras Redondeadas -->
        <div class="lg:col-span-8 sylva-card-charcoal rounded-2xl p-5 flex flex-col justify-between">
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
                  <span class="w-2 h-2 rounded-full bg-[#7DB4D8]"></span>
                  Proyecto
                </span>
                <span class="flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-[#B9F249]"></span>
                  Mayor carga
                </span>
              </div>

              <div class="flex items-center bg-white/[0.05] p-0.5 rounded-full border border-white/10 text-[11px]">
                <button
                  @click="chartMetric = 'ram'"
                  class="px-2.5 py-1 rounded-full font-semibold transition"
                  :class="
                    chartMetric === 'ram'
                      ? 'bg-white text-[#11150D]'
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
                      ? 'bg-white text-[#11150D]'
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
                      ? 'bg-white text-[#11150D]'
                      : 'text-slate-400 hover:text-white'
                  "
                >
                  Disco
                </button>
              </div>
            </div>
          </div>

          <!-- Lienzo del Gráfico de Barras Estilo Sylva -->
          <div
            v-if="chartBars.length > 0"
            class="relative h-60 pt-6 pb-1 px-1 flex items-end gap-2.5 sm:gap-3.5 border-b border-white/[0.07]"
          >
            <!-- Línea punteada de referencia superior -->
            <div
              class="absolute left-0 right-0 top-12 border-t border-dashed border-white/20 pointer-events-none flex justify-end pr-2"
            >
              <span class="text-[9px] uppercase tracking-wider text-slate-500 -mt-4 bg-[#181B17] px-1.5 rounded">
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
              <!-- Fondo de carril vertical (idéntico a Sylva Imagen 1) -->
              <div
                class="w-full h-full bg-white/[0.03] group-hover:bg-white/[0.06] rounded-xl flex flex-col justify-end overflow-hidden p-0.5 transition"
              >
                <!-- Tooltip flotante en hover -->
                <span
                  class="opacity-0 group-hover:opacity-100 transition text-[10px] font-mono font-bold text-white mb-1 text-center truncate px-1"
                >
                  {{ bar.formatted }}
                </span>

                <!-- Barra activa redondeada -->
                <div
                  class="w-full rounded-xl transition-all duration-500 group-hover:brightness-110"
                  :class="
                    bar.isPeak
                      ? 'bg-[#B9F249] shadow-[0_0_24px_rgba(185,242,73,0.35)]'
                      : 'bg-[#7DB4D8]'
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
              :class="bar.isPeak ? 'text-[#B9F249] font-bold' : 'text-slate-400'"
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

        <!-- Tarjeta Derecha (4 cols): Proyectos por Carga (Estilo "Pipeline by stage" Imagen 1) -->
        <div class="lg:col-span-4 sylva-card-charcoal rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-sm font-bold text-white">Proyectos por Carga</h2>
              <button
                @click="switchTab('projects')"
                class="text-[11px] font-semibold text-slate-300 hover:text-[#B9F249] flex items-center gap-1 transition"
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
                    class="text-xs font-semibold text-white group-hover:text-[#B9F249] truncate transition"
                  >
                    {{ item.project.name }}
                  </div>
                  <div class="text-[10px] text-slate-400 truncate">
                    {{ item.containersCount }} cont. ·
                    {{ item.project.status === 'running' ? 'Activo' : 'Parcial' }}
                  </div>
                </div>

                <div class="col-span-5">
                  <div class="w-full h-2 bg-white/[0.07] rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      :style="{
                        width: `${item.pct}%`,
                        backgroundColor: item.color,
                      }"
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
            class="mt-5 pt-3 border-t border-white/[0.07] flex items-center justify-between text-[11px] text-slate-400"
          >
            <span>Total contenedores</span>
            <strong class="text-white font-mono">
              {{ runningContainersCount }} / {{ totalContainersCount }} online
            </strong>
          </div>
        </div>
      </div>

      <!-- FILA INFERIOR DE 3 TARJETAS DE ACCIÓN (Estilo "Battery bank / Today / Leaderboard" Imagen 1) -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <!-- Card 1 (Olive): Next Best Move -->
        <div class="sylva-card-olive rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div>
            <div class="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-[#B9F249]">
              <i class="fa-solid fa-wand-magic-sparkles"></i>
              <span>{{ nextBestMove.tag }}</span>
            </div>
            <div class="text-base font-bold text-white mt-1">
              {{ nextBestMove.title }}
            </div>
            <p class="text-[11px] text-slate-200/85 mt-0.5">
              {{ nextBestMove.subtitle }}
            </p>
          </div>

          <div class="flex items-center justify-between pt-1">
            <button
              @click="nextBestMove.run"
              class="sylva-lime-btn rounded-full px-3.5 py-1.5 text-[11px]"
            >
              {{ nextBestMove.actionLabel }}
            </button>
            <button
              @click="viewMode = 'pipeline'"
              class="text-[11px] text-slate-200 hover:text-white font-semibold"
            >
              Ver Forecast ›
            </button>
          </div>
        </div>

        <!-- Card 2 (Charcoal): Dominios & Proxy SSL -->
        <div class="sylva-card-charcoal rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white">Dominios & SSL</span>
              <button
                @click="switchTab('domains')"
                class="text-[11px] text-slate-400 hover:text-[#B9F249] font-semibold"
              >
                Rutas SSL ›
              </button>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              {{ panelStore.domainRoutes.length }} dominios configurados en Caddy HTTPS
            </div>

            <div class="mt-2.5 space-y-1.5">
              <div
                v-for="r in panelStore.domainRoutes.slice(0, 3)"
                :key="r.id"
                class="flex items-center justify-between text-xs bg-white/[0.03] px-2.5 py-1.5 rounded-xl"
              >
                <a
                  :href="`https://${r.domain}`"
                  target="_blank"
                  class="text-slate-200 hover:text-[#B9F249] truncate font-medium flex items-center gap-1.5"
                >
                  <i class="fa-solid fa-lock text-[9px] text-[#B9F249]"></i>
                  <span class="truncate">{{ r.domain }}</span>
                </a>
                <span class="text-[10px] font-mono text-slate-400 shrink-0 ml-2">
                  {{ r.projectName }}
                </span>
              </div>
              <div
                v-if="panelStore.domainRoutes.length === 0"
                class="text-[11px] text-slate-500 py-2"
              >
                Conecta tus proyectos a dominios con HTTPS automático.
              </div>
            </div>
          </div>
        </div>

        <!-- Card 3 (Charcoal): Escudo DDoS & Seguridad -->
        <div class="sylva-card-charcoal rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white">Escudo & Telemetría</span>
              <button
                @click="switchTab('audit')"
                class="text-[11px] text-slate-400 hover:text-[#B9F249] font-semibold"
              >
                Seguridad ›
              </button>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">
              Token Bucket en memoria & Batch SQL
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div class="bg-white/[0.03] rounded-xl p-2.5">
                <div class="text-[10px] text-slate-400">Estado Escudo</div>
                <div class="font-bold text-[#B9F249] text-xs mt-0.5">
                  {{ panelStore.securityShield?.protectionMode || 'ACTIVO' }}
                </div>
              </div>
              <div class="bg-white/[0.03] rounded-xl p-2.5">
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
         MODO 2: PIPELINE & CAPACIDAD CONCÉNTRICA (IMÁGENES 2 & 3)
         ======================================================================= -->
    <template v-else>
      <div class="sylva-card-charcoal rounded-2xl p-5 space-y-5">
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

          <!-- Selector de Filtro Estilo Sylva ("Commit / Likely / Best case") -->
          <div
            class="flex items-center bg-white/[0.05] p-1 rounded-full border border-white/10 text-xs"
          >
            <button
              @click="pipelineFilter = 'all'"
              class="px-3 py-1 rounded-full font-semibold transition"
              :class="
                pipelineFilter === 'all'
                  ? 'bg-white text-[#11150D]'
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
                  ? 'bg-white text-[#11150D]'
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
                  ? 'bg-white text-[#11150D]'
                  : 'text-slate-400 hover:text-white'
              "
            >
              Con Base de Datos
            </button>
          </div>
        </div>

        <!-- Tarjetas Visuales de Bloques Concéntricos (Idénticas a Imágenes 2 & 3) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <button
            v-for="card in capacityCards"
            :key="`cap-${card.project.name}`"
            @click="focusProjectCard(card.project.name)"
            class="text-left group focus:outline-none space-y-2.5"
          >
            <div
              class="relative h-44 rounded-2xl bg-[#272B26] border border-white/[0.07] group-hover:border-[#B9F249]/40 overflow-hidden flex items-end justify-center transition"
            >
              <!-- Capa 1: Disco / Huella Total (Slate Exterior) -->
              <div
                class="rounded-t-2xl bg-[#526473]/75 transition-all duration-500 flex items-end justify-center"
                :style="{
                  width: `${card.diskRatio}%`,
                  height: `${card.diskRatio}%`,
                }"
              >
                <!-- Capa 2: Memoria RAM (Sky-Blue Intermedia) -->
                <div
                  class="rounded-t-xl bg-[#8BC0E4] transition-all duration-500 flex items-end justify-center"
                  :style="{
                    width: '78%',
                    height: `${Math.max(35, card.ramRatio)}%`,
                  }"
                >
                  <!-- Capa 3: Salud / Contenedores Activos (Lima Brillante Interior) -->
                  <div
                    v-if="card.healthRatio > 0"
                    class="rounded-t-lg bg-[#B9F249] shadow-[0_0_20px_rgba(185,242,73,0.35)] transition-all duration-500"
                    :style="{
                      width: '68%',
                      height: `${Math.max(40, card.healthRatio)}%`,
                    }"
                  ></div>
                </div>
              </div>

              <span
                class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-black/40 text-slate-200 backdrop-blur-sm"
              >
                {{ card.activeCont }}/{{ card.totalCont }} online
              </span>
            </div>

            <div class="px-0.5">
              <div
                class="text-xs font-bold text-white group-hover:text-[#B9F249] truncate transition"
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
            <span class="w-2.5 h-2.5 rounded-full bg-[#B9F249]"></span>
            Contenedores Activos
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-[#8BC0E4]"></span>
            Memoria RAM
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-[#526473]"></span>
            Huella en Disco
          </span>
        </div>
      </div>

      <!-- Columnas Inferiores de Detalle Rápido por Proyecto (Estilo columnas inferiores Imagen 2 & 3) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div
          v-for="card in capacityCards"
          :key="`detail-${card.project.name}`"
          class="sylva-card-charcoal rounded-2xl p-4 flex flex-col justify-between space-y-3"
        >
          <div>
            <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-white/[0.07]">
              <button
                @click="focusProjectCard(card.project.name)"
                class="text-xs font-bold text-white hover:text-[#B9F249] truncate"
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
                  <div class="font-medium text-slate-200 truncate flex items-center gap-1.5">
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      :class="
                        c.state === 'running' ? 'bg-[#B9F249]' : 'bg-rose-500'
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

          <div class="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center gap-1.5">
            <button
              @click="openLogsModal(card.project.name)"
              class="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-semibold text-slate-200 transition"
            >
              Logs
            </button>
            <button
              @click="openTerminalModal(card.project.name, '', 'shell')"
              class="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-semibold text-slate-200 transition"
            >
              Terminal
            </button>
            <button
              v-if="card.dbContainerName"
              @click="openErdModal(card.project.name, card.dbContainerName)"
              class="px-2.5 py-1 rounded-lg bg-[#7DB4D8]/15 hover:bg-[#7DB4D8]/25 text-[10px] font-semibold text-[#7DB4D8] transition"
            >
              DER / ERD
            </button>
            <button
              @click="focusProjectCard(card.project.name)"
              class="ml-auto text-[10px] font-semibold text-[#B9F249] hover:underline"
            >
              Abrir ›
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
