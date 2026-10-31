<script setup lang="ts">
import { computed } from 'vue';
import {
  copyText,
  hasPerm,
  panelStore,
  pruneServerDocker,
  refreshAll,
  switchTab,
  toggleTheme,
} from '../../composables/usePanelStore';
import { formatBytes, formatUptime } from '../../services/api';
import type { PanelTab } from '../../types/panel';

const emit = defineEmits<{
  (e: 'logout'): void;
}>();

const isSuperUser = computed(() => {
  const u = panelStore.currentUser;
  return Boolean(u && (u.role === 'superadmin' || u.username === 'superadmin'));
});

const navTabs = computed(() => {
  const tabs: Array<{
    id: PanelTab;
    mod: string;
    icon: string;
    label: string;
    subLabel?: string;
  }> = [
    { id: 'projects', mod: 'projects', icon: 'fa-layer-group', label: 'Proyectos', subLabel: '& Contenedores' },
    { id: 'domains', mod: 'domains', icon: 'fa-globe', label: 'Dominios SSL' },
    { id: 'guide', mod: 'git', icon: 'fa-book-open', label: 'Guía Multi-Stack' },
    { id: 'users', mod: 'users', icon: 'fa-users-gear', label: 'Usuarios & Roles' },
    { id: 'permissions', mod: 'users', icon: 'fa-user-shield', label: 'Permisos & Servicios' },
    { id: 'audit', mod: 'security', icon: 'fa-shield-halved', label: 'Auditoría' },
  ];
  return tabs.filter((t) => hasPerm(t.mod, 'view'));
});

function openClone(): void {
  panelStore.modals.clone.open = true;
}
</script>

<template>
  <!-- Top Header -->
  <header class="bg-slate-900/90 border-b border-slate-800 sticky top-0 z-30 backdrop-blur">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-600/30"
        >
          <i class="fa-solid fa-bolt"></i>
        </div>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-lg text-white tracking-tight">ALpanel</span>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> EN VIVO
            </span>
            <span
              v-if="panelStore.currentUser"
              class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] bg-slate-950 border border-slate-800"
            >
              <i
                class="fa-solid"
                :class="isSuperUser ? 'fa-crown text-fuchsia-400' : 'fa-user-check text-indigo-400'"
              ></i>
              <span class="font-bold text-white">@{{ panelStore.currentUser.username }}</span>
              <span class="hidden md:inline text-slate-400">
                ({{ panelStore.currentUser.roleName || panelStore.currentUser.role }})
              </span>
            </span>
          </div>
          <div class="text-xs text-slate-400 flex items-center gap-3">
            <span>
              <i class="fa-solid fa-network-wired mr-1 text-indigo-400"></i>IP:
              <strong
                class="text-slate-200 cursor-pointer hover:text-indigo-400"
                @click="copyText(panelStore.host.publicIp || '127.0.0.1', 'IP del servidor copiada')"
              >
                {{ panelStore.host.publicIp || '127.0.0.1' }}
              </strong>
            </span>
            <span class="hidden sm:inline">•</span>
            <span class="hidden sm:inline">
              {{ panelStore.host.distro || panelStore.host.platform }} ({{ panelStore.host.hostname }})
            </span>
            <span class="hidden sm:inline">•</span>
            <span>Uptime: {{ formatUptime(panelStore.host.uptimeSeconds) }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5 sm:gap-2">
        <button
          v-if="hasPerm('git', 'create')"
          @click="openClone"
          class="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <i class="fa-solid fa-plus"></i>
          <span class="hidden sm:inline">Nuevo Proyecto (Git)</span>
          <span class="sm:hidden">Nuevo</span>
        </button>
        <button
          v-if="hasPerm('security', 'deploy')"
          @click="pruneServerDocker"
          class="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
          title="Liberar espacio limpiando imágenes huérfanas y caché de compilación Docker"
        >
          <i class="fa-solid fa-broom"></i>
          <span class="hidden sm:inline">Limpiar Caché Docker</span>
          <span class="sm:hidden">Caché</span>
        </button>
        <button
          @click="toggleTheme"
          class="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
          :class="panelStore.theme === 'light' ? 'text-amber-500' : 'text-indigo-300'"
          :title="panelStore.theme === 'light' ? 'Cambiar a Modo Noche (Oscuro)' : 'Cambiar a Modo Día (Claro)'"
        >
          <i class="fa-solid" :class="panelStore.theme === 'light' ? 'fa-sun' : 'fa-moon'"></i>
          <span class="hidden sm:inline">{{ panelStore.theme === 'light' ? 'Modo Día' : 'Modo Noche' }}</span>
        </button>
        <button
          @click="refreshAll"
          class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition"
          title="Refrescar ahora"
        >
          <i class="fa-solid fa-rotate"></i>
        </button>
        <button
          @click="emit('logout')"
          class="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-rose-400 border border-slate-700 text-xs transition"
          title="Cerrar sesión"
        >
          <i class="fa-solid fa-power-off"></i>
        </button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 flex overflow-x-auto whitespace-nowrap gap-4 sm:gap-6 text-xs sm:text-sm border-t border-slate-800/60"
    >
      <button
        v-for="tab in navTabs"
        :key="tab.id"
        @click="switchTab(tab.id)"
        class="py-2.5 sm:py-3 border-b-2 flex items-center gap-1.5 shrink-0 transition"
        :class="
          panelStore.activeTab === tab.id
            ? 'border-indigo-500 text-indigo-400 font-semibold'
            : 'border-transparent text-slate-400 hover:text-slate-200 font-medium'
        "
      >
        <i class="fa-solid" :class="tab.icon"></i>
        <span>{{ tab.label }}</span>
        <span v-if="tab.subLabel" class="hidden sm:inline">{{ tab.subLabel }}</span>
      </button>
    </div>
  </header>

  <!-- Global Server Resource Strip -->
  <div class="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-4">
      <div class="flex items-center gap-3 bg-slate-900/90 border border-slate-800/80 rounded-xl px-3.5 py-2">
        <div
          class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-microchip"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-slate-400 font-medium">
              CPU Servidor <span class="text-slate-500">({{ panelStore.host.cpu.cores }} núcleos)</span>
            </span>
            <span class="font-bold text-white">{{ panelStore.host.cpu.usagePercent }}%</span>
          </div>
          <div class="w-full h-1.5 sm:h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-indigo-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, panelStore.host.cpu.usagePercent)}%` }"
            ></div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3 bg-slate-900/90 border border-slate-800/80 rounded-xl px-3.5 py-2">
        <div
          class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-memory"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-slate-400 font-medium">Memoria RAM</span>
            <span class="font-bold text-white">
              {{ formatBytes(panelStore.host.memory.usedBytes) }} /
              {{ formatBytes(panelStore.host.memory.totalBytes) }}
              ({{ panelStore.host.memory.usagePercent }}%)
            </span>
          </div>
          <div class="w-full h-1.5 sm:h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-emerald-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, panelStore.host.memory.usagePercent)}%` }"
            ></div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3 bg-slate-900/90 border border-slate-800/80 rounded-xl px-3.5 py-2">
        <div
          class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0"
        >
          <i class="fa-solid fa-hard-drive"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-slate-400 font-medium">Disco SSD</span>
            <span class="font-bold text-white">
              {{ formatBytes(panelStore.host.disk.usedBytes) }} /
              {{ formatBytes(panelStore.host.disk.totalBytes) }}
              ({{ panelStore.host.disk.usagePercent }}%)
            </span>
          </div>
          <div class="w-full h-1.5 sm:h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-500 transition-all duration-300"
              :style="{ width: `${Math.min(100, panelStore.host.disk.usagePercent)}%` }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
