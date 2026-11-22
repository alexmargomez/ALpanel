<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  copyText,
  hasPerm,
  panelStore,
  switchTab,
  toggleSidebar,
} from '../../composables/usePanelStore';
import { formatBytes } from '../../services/api';
import type { PanelTab } from '../../types/panel';

const emit = defineEmits<{
  (e: 'logout'): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);

const tabLabels: Record<PanelTab, string> = {
  overview: 'Overview',
  projects: 'Pipeline & Proyectos',
  domains: 'Dominios & SSL',
  guide: 'Guía Multi-Stack',
  users: 'Usuarios & Roles',
  permissions: 'Permisos RBAC',
  audit: 'Auditoría & Escudo',
};

const currentTabTitle = computed(
  () => tabLabels[panelStore.activeTab] || 'Overview'
);

const hostDisplayLabel = computed(() => {
  const h = (panelStore.host.hostname || '').trim();
  if (!h || /^[0-9a-f]{12}$/i.test(h)) {
    return 'ALpanel';
  }
  return h;
});

const runningTasksCount = computed(
  () => panelStore.backgroundTasks.filter((t) => t.status === 'running').length
);

const pendingUpdatesCount = computed(() =>
  panelStore.projects.reduce((acc, p) => acc + (p.git?.behindCount || 0), 0)
);

const badgeAlertCount = computed(
  () => runningTasksCount.value + pendingUpdatesCount.value
);

const userInitials = computed(() => {
  const raw =
    panelStore.currentUser?.fullName ||
    panelStore.currentUser?.username ||
    'AD';
  const parts = raw.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return raw.slice(0, 2).toUpperCase();
});

function openClone(): void {
  panelStore.modals.clone.open = true;
}

function handleSearchEnter(): void {
  if (panelStore.activeTab !== 'projects') {
    switchTab('projects');
  }
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    searchInputRef.value?.focus();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
});
</script>

<template>
  <header class="w-full space-y-3">
    <!-- Barra Contextual Superior -->
    <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
      <!-- Izquierda: Botón Móvil + Spaces Colapsados + Breadcrumb + IP -->
      <div class="flex items-center gap-2.5 min-w-0">
        <button
          @click="panelStore.mobileSidebarOpen = true"
          class="lg:hidden w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white"
          title="Abrir menú"
        >
          <i class="fa-solid fa-bars text-xs"></i>
        </button>

        <!-- Píldora de Espacios Apilados cuando el Rail está colapsado -->
        <button
          v-if="panelStore.sidebarCollapsed"
          @click="toggleSidebar"
          class="hidden lg:inline-flex items-center -space-x-1.5 px-2 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
          title="Expandir barra lateral de espacios"
        >
          <span
            class="w-4 h-4 rounded-md bg-indigo-600 keep-white text-[8px] font-bold flex items-center justify-center"
          >
            <i class="fa-solid fa-bolt"></i>
          </span>
          <span
            class="w-4 h-4 rounded-md bg-emerald-600 keep-white text-[8px] font-bold flex items-center justify-center"
          >
            <i class="fa-solid fa-cubes"></i>
          </span>
          <span
            class="w-4 h-4 rounded-md bg-violet-600 keep-white text-[8px] font-bold flex items-center justify-center"
          >
            <i class="fa-solid fa-server"></i>
          </span>
        </button>

        <div class="flex items-center gap-2 text-xs min-w-0">
          <button
            @click="switchTab('overview')"
            class="text-slate-400 hover:text-indigo-400 font-medium truncate transition"
          >
            {{ hostDisplayLabel }}
          </button>
          <span class="text-slate-500">/</span>
          <span class="text-white font-semibold truncate">
            {{ currentTabTitle }}
          </span>
        </div>

        <button
          @click="
            copyText(
              panelStore.host.publicIp || '127.0.0.1',
              'IP pública copiada al portapapeles'
            )
          "
          class="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 font-mono transition"
          title="Clic para copiar IP pública del servidor"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>{{ panelStore.host.publicIp || '127.0.0.1' }}</span>
        </button>
      </div>

      <!-- Derecha: Buscador Global ⌘K + CTA Indigo (+ Nuevo) + Alertas + Avatar -->
      <div class="flex items-center gap-2 ml-auto">
        <div class="relative hidden md:flex items-center">
          <i
            class="fa-solid fa-magnifying-glass absolute left-3 text-slate-400 text-[11px]"
          ></i>
          <input
            ref="searchInputRef"
            v-model="panelStore.projectSearchQuery"
            @keydown.enter="handleSearchEnter"
            type="text"
            placeholder="Buscar proyectos, dominios, stack..."
            class="w-60 lg:w-72 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-full pl-8 pr-12 py-1.5 text-xs text-white placeholder-slate-400 focus:outline-none transition"
          />
          <kbd
            class="absolute right-2.5 px-1.5 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-400 border border-slate-700 font-mono"
          >
            ⌘K
          </kbd>
        </div>

        <button
          v-if="hasPerm('git', 'create')"
          @click="openClone"
          class="px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <i class="fa-solid fa-plus text-[10px]"></i>
          <span>Nuevo</span>
        </button>

        <button
          @click="switchTab(pendingUpdatesCount > 0 ? 'projects' : 'audit')"
          class="relative w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition"
          :title="
            badgeAlertCount > 0
              ? `${badgeAlertCount} notificaciones / tareas activas`
              : 'Estado del sistema al día'
          "
        >
          <i class="fa-regular fa-bell text-xs"></i>
          <span
            v-if="badgeAlertCount > 0"
            class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold flex items-center justify-center"
          >
            {{ badgeAlertCount }}
          </span>
        </button>

        <div
          v-if="panelStore.currentUser"
          class="relative flex items-center"
          :title="`@${panelStore.currentUser.username} (${panelStore.currentUser.roleName || panelStore.currentUser.role})`"
        >
          <button
            @click="emit('logout')"
            class="w-8 h-8 rounded-full bg-indigo-600 keep-white font-bold text-[11px] flex items-center justify-center shadow hover:bg-indigo-500 transition"
          >
            {{ userInitials }}
          </button>
        </div>
      </div>
    </div>

    <!-- Barra Compacta de Telemetría cuando NO estamos en Overview -->
    <div
      v-if="panelStore.activeTab !== 'overview'"
      class="grid grid-cols-1 sm:grid-cols-3 gap-2.5"
    >
      <div
        class="bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-2.5 flex items-center gap-3"
      >
        <div
          class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-microchip text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-[11px] mb-1">
            <span class="text-slate-400">
              CPU ({{ panelStore.host.cpu.cores }} vCPU)
            </span>
            <span class="font-bold text-white">
              {{ panelStore.host.cpu.usagePercent }}%
            </span>
          </div>
          <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-indigo-500 rounded-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, panelStore.host.cpu.usagePercent)}%`,
              }"
            ></div>
          </div>
        </div>
      </div>

      <div
        class="bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-2.5 flex items-center gap-3"
      >
        <div
          class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-memory text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-[11px] mb-1">
            <span class="text-slate-400">RAM</span>
            <span class="font-bold text-white">
              {{ formatBytes(panelStore.host.memory.usedBytes) }} /
              {{ formatBytes(panelStore.host.memory.totalBytes) }}
            </span>
          </div>
          <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-emerald-500 rounded-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, panelStore.host.memory.usagePercent)}%`,
              }"
            ></div>
          </div>
        </div>
      </div>

      <div
        class="bg-slate-900 border border-slate-800 rounded-2xl px-3.5 py-2.5 flex items-center gap-3"
      >
        <div
          class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-hard-drive text-xs"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-[11px] mb-1">
            <span class="text-slate-400">Disco SSD</span>
            <span class="font-bold text-white">
              {{ formatBytes(panelStore.host.disk.usedBytes) }} /
              {{ formatBytes(panelStore.host.disk.totalBytes) }}
            </span>
          </div>
          <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-500 rounded-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, panelStore.host.disk.usagePercent)}%`,
              }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>
