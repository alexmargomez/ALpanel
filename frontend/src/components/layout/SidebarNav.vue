<script setup lang="ts">
import { computed } from 'vue';
import {
  hasPerm,
  panelStore,
  pruneServerDocker,
  refreshAll,
  switchTab,
  toggleSidebar,
  toggleTheme,
} from '../../composables/usePanelStore';
import type { PanelTab } from '../../types/panel';

const emit = defineEmits<{
  (e: 'logout'): void;
}>();

const menuItems = computed(() => {
  const items: Array<{
    id: PanelTab;
    mod: string;
    icon: string;
    label: string;
    badge?: number;
  }> = [
    {
      id: 'overview',
      mod: 'projects',
      icon: 'fa-border-all',
      label: 'Overview',
    },
    {
      id: 'projects',
      mod: 'projects',
      icon: 'fa-layer-group',
      label: 'Proyectos',
      badge: panelStore.projects.length || undefined,
    },
    {
      id: 'servers',
      mod: 'projects',
      icon: 'fa-server',
      label: 'Servidores',
      badge: panelStore.servers.length || undefined,
    },
    {
      id: 'guide',
      mod: 'git',
      icon: 'fa-book-open',
      label: 'Guía Multi-Stack',
    },
    {
      id: 'users',
      mod: 'users',
      icon: 'fa-users-gear',
      label: 'Usuarios & Roles',
      badge: panelStore.users.length || undefined,
    },
    {
      id: 'permissions',
      mod: 'users',
      icon: 'fa-user-shield',
      label: 'Permisos RBAC',
    },
    {
      id: 'audit',
      mod: 'security',
      icon: 'fa-shield-halved',
      label: 'Auditoría & Escudo',
      badge: panelStore.auditLogs.length || undefined,
    },
  ];
  return items.filter((item) => hasPerm(item.mod, 'view'));
});

function isMenuActive(itemId: PanelTab): boolean {
  if (itemId === 'projects' && panelStore.activeTab === 'project-workspace') {
    return true;
  }
  return panelStore.activeTab === itemId;
}

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
</script>

<template>
  <!-- Backdrop Móvil -->
  <div
    v-if="panelStore.mobileSidebarOpen"
    @click="panelStore.mobileSidebarOpen = false"
    class="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
  ></div>

  <!-- Sidebar Flotante Dual (Expandido / Rail Colapsado) con Paleta Original ALpanel -->
  <aside
    class="fixed lg:sticky top-0 lg:top-3 left-0 z-40 h-screen lg:h-[calc(100vh-1.5rem)] transition-all duration-300 shrink-0 flex flex-col"
    :class="[
      panelStore.mobileSidebarOpen
        ? 'translate-x-0 p-2.5 w-[268px]'
        : '-translate-x-full lg:translate-x-0',
      panelStore.sidebarCollapsed ? 'lg:w-[62px]' : 'lg:w-[254px]',
    ]"
  >
    <!-- MODO EXPANDIDO -->
    <div
      v-if="!panelStore.sidebarCollapsed || panelStore.mobileSidebarOpen"
      class="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl flex-1 flex flex-col justify-between p-3.5 overflow-y-auto scrollbar-thin"
    >
      <div class="space-y-5">
        <!-- Brand Header -->
        <div class="flex items-center justify-between px-1 pt-0.5">
          <button
            @click="switchTab('overview')"
            class="flex items-center gap-2.5 text-left group"
          >
            <div
              class="w-8 h-8 rounded-xl bg-indigo-600 keep-white flex items-center justify-center font-bold shadow-lg shadow-indigo-600/30 group-hover:scale-105 transition"
            >
              <i class="fa-solid fa-bolt text-xs"></i>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-bold text-base tracking-tight text-white">
                ALpanel
              </span>
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              >
                LIVE
              </span>
            </div>
          </button>

          <button
            @click="
              panelStore.mobileSidebarOpen
                ? (panelStore.mobileSidebarOpen = false)
                : toggleSidebar()
            "
            class="w-7 h-7 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
            title="Contraer barra lateral"
          >
            <i class="fa-solid fa-table-columns text-xs"></i>
          </button>
        </div>

        <!-- MENÚ PRINCIPAL -->
        <div class="space-y-1.5">
          <div class="px-2">
            <span
              class="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"
            >
              Menú
            </span>
          </div>

          <nav class="space-y-0.5">
            <button
              v-for="item in menuItems"
              :key="item.id"
              @click="switchTab(item.id)"
              class="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition"
              :class="
                isMenuActive(item.id)
                  ? 'bg-indigo-500/15 text-indigo-400 font-semibold border border-indigo-500/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70 font-medium border border-transparent'
              "
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <i
                  class="fa-solid w-4 text-center text-[12px]"
                  :class="[
                    item.icon,
                    isMenuActive(item.id)
                      ? 'text-indigo-400'
                      : 'text-slate-400',
                  ]"
                ></i>
                <span class="truncate">{{ item.label }}</span>
                <span
                  v-if="isMenuActive(item.id)"
                  class="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"
                ></span>
              </div>

              <span
                v-if="item.badge !== undefined"
                class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 min-w-[20px] text-center"
              >
                {{ item.badge }}
              </span>
            </button>
          </nav>
        </div>
      </div>

      <!-- FOOTER DE UTILIDADES + MODO DÍA/NOCHE + PERFIL -->
      <div class="pt-4 mt-4 border-t border-slate-800 space-y-1">
        <button
          v-if="hasPerm('security', 'deploy')"
          @click="pruneServerDocker"
          class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-amber-400 hover:bg-slate-800/70 transition"
        >
          <i class="fa-solid fa-broom w-4 text-center text-[12px]"></i>
          <span>Limpiar Caché Docker</span>
        </button>

        <button
          @click="refreshAll"
          class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800/70 transition"
        >
          <i class="fa-solid fa-rotate w-4 text-center text-[12px]"></i>
          <span>Sincronizar Servidor</span>
        </button>

        <!-- Toggle Switch Modo Noche / Día -->
        <div
          @click="toggleTheme"
          class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-slate-800/70 cursor-pointer select-none transition"
        >
          <div class="flex items-center gap-2.5">
            <i
              class="fa-solid w-4 text-center text-[12px]"
              :class="
                panelStore.theme === 'dark'
                  ? 'fa-moon text-indigo-400'
                  : 'fa-sun text-amber-500'
              "
            ></i>
            <span>{{ panelStore.theme === 'dark' ? 'Modo Noche' : 'Modo Día' }}</span>
          </div>

          <div
            class="w-9 h-5 rounded-full p-0.5 transition-colors flex items-center"
            :class="
              panelStore.theme === 'dark'
                ? 'bg-indigo-600 justify-end'
                : 'bg-slate-400/50 justify-start'
            "
          >
            <span class="w-4 h-4 rounded-full bg-white shadow transition"></span>
          </div>
        </div>

        <!-- Perfil de Usuario -->
        <div
          v-if="panelStore.currentUser"
          class="mt-2 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2 px-1.5"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div
              class="w-8 h-8 rounded-full bg-indigo-600 keep-white font-bold text-[11px] flex items-center justify-center shrink-0 shadow"
            >
              {{ userInitials }}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-bold text-white truncate">
                {{
                  panelStore.currentUser.fullName ||
                  panelStore.currentUser.username
                }}
              </div>
              <div class="text-[10px] text-slate-400 truncate">
                {{
                  panelStore.currentUser.roleName || panelStore.currentUser.role
                }}
              </div>
            </div>
          </div>

          <button
            @click="emit('logout')"
            class="w-7 h-7 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 flex items-center justify-center transition shrink-0"
            title="Cerrar sesión"
          >
            <i class="fa-solid fa-power-off text-xs"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- MODO RAIL COLAPSADO -->
    <div
      v-else
      class="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl flex-1 hidden lg:flex flex-col items-center justify-between py-3 px-1.5"
    >
      <div class="flex flex-col items-center gap-3 w-full">
        <button
          @click="toggleSidebar"
          class="w-9 h-9 rounded-xl hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition"
          title="Expandir barra lateral"
        >
          <i class="fa-solid fa-table-columns text-xs"></i>
        </button>

        <div class="w-6 h-px bg-slate-800"></div>

        <nav class="flex flex-col items-center gap-1.5 w-full">
          <button
            v-for="item in menuItems"
            :key="item.id"
            @click="switchTab(item.id)"
            :title="item.label"
            class="relative w-9 h-9 rounded-xl flex items-center justify-center transition"
            :class="
              isMenuActive(item.id)
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            "
          >
            <i class="fa-solid text-xs" :class="item.icon"></i>
            <span
              v-if="isMenuActive(item.id)"
              class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400"
            ></span>
          </button>
        </nav>
      </div>

      <div class="flex flex-col items-center gap-2 w-full">
        <button
          @click="refreshAll"
          title="Sincronizar Servidor"
          class="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition"
        >
          <i class="fa-solid fa-rotate text-xs"></i>
        </button>

        <button
          @click="toggleTheme"
          :title="
            panelStore.theme === 'dark'
              ? 'Cambiar a Modo Día'
              : 'Cambiar a Modo Noche'
          "
          class="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition"
        >
          <i
            class="fa-solid text-xs"
            :class="
              panelStore.theme === 'dark'
                ? 'fa-moon text-indigo-400'
                : 'fa-sun text-amber-500'
            "
          ></i>
        </button>

        <button
          @click="emit('logout')"
          title="Cerrar sesión"
          class="w-8 h-8 rounded-full bg-indigo-600 keep-white font-bold text-[10px] flex items-center justify-center shadow hover:bg-indigo-500 transition"
        >
          {{ userInitials }}
        </button>
      </div>
    </div>
  </aside>
</template>
