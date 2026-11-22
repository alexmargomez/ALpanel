<script setup lang="ts">
import { computed } from 'vue';
import {
  focusProjectCard,
  hasPerm,
  panelStore,
  pruneServerDocker,
  refreshAll,
  switchTab,
  toggleSidebar,
  toggleTheme,
} from '../../composables/usePanelStore';
import type { PanelTab, ProjectInfo } from '../../types/panel';

const emit = defineEmits<{
  (e: 'logout'): void;
}>();

const spaceBadges = [
  { bg: '#7DB4D8', text: '#0D1720', icon: 'fa-bolt' },
  { bg: '#B9F249', text: '#11150D', icon: 'fa-cubes' },
  { bg: '#F28B66', text: '#1F0F0A', icon: 'fa-server' },
  { bg: '#E5D5A7', text: '#1F1A0C', icon: 'fa-database' },
];

const featuredSpaces = computed(() => {
  return panelStore.projects.slice(0, 4).map((p, idx) => {
    const palette = spaceBadges[idx % spaceBadges.length];
    const primaryDomain = p.domains?.[0] || p.stack?.[0] || p.git?.branch || 'Docker';
    const statusLabel =
      p.status === 'running'
        ? 'Activo'
        : p.status === 'partial'
          ? 'Parcial'
          : 'Detenido';
    return {
      project: p,
      name: p.name,
      subtitle: `${primaryDomain} · ${statusLabel}`,
      bg: palette.bg,
      text: palette.text,
      icon: p.microservices?.isMicroservicesArchitecture
        ? 'fa-cubes'
        : p.database?.hasDatabase
          ? 'fa-layer-group'
          : palette.icon,
    };
  });
});

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
      icon: 'fa-chart-simple',
      label: 'Pipeline & Proyectos',
      badge: panelStore.projects.length || undefined,
    },
    {
      id: 'domains',
      mod: 'domains',
      icon: 'fa-globe',
      label: 'Dominios & SSL',
      badge: panelStore.domainRoutes.length || undefined,
    },
    {
      id: 'guide',
      mod: 'git',
      icon: 'fa-code-branch',
      label: 'Guía Multi-Stack',
    },
    {
      id: 'users',
      mod: 'users',
      icon: 'fa-user-group',
      label: 'Equipo & Roles',
      badge: panelStore.users.length || undefined,
    },
    {
      id: 'permissions',
      mod: 'users',
      icon: 'fa-sliders',
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

function handleSpaceClick(proj: ProjectInfo): void {
  if (
    panelStore.activeTab === 'projects' &&
    panelStore.projectSearchQuery.toLowerCase() === proj.name.toLowerCase()
  ) {
    panelStore.projectSearchQuery = '';
  } else {
    focusProjectCard(proj.name);
  }
  panelStore.mobileSidebarOpen = false;
}

function isSpaceSelected(name: string): boolean {
  return (
    panelStore.activeTab === 'projects' &&
    panelStore.projectSearchQuery.trim().toLowerCase() === name.toLowerCase()
  );
}
</script>

<template>
  <!-- Backdrop Móvil -->
  <div
    v-if="panelStore.mobileSidebarOpen"
    @click="panelStore.mobileSidebarOpen = false"
    class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
  ></div>

  <!-- Sidebar Flotante Dual (Expandido Sylva / Rail Colapsado) -->
  <aside
    class="fixed lg:sticky top-0 lg:top-3 left-0 z-40 h-screen lg:h-[calc(100vh-1.5rem)] transition-all duration-300 shrink-0 flex flex-col"
    :class="[
      panelStore.mobileSidebarOpen
        ? 'translate-x-0 p-2.5 w-[268px]'
        : '-translate-x-full lg:translate-x-0',
      panelStore.sidebarCollapsed ? 'lg:w-[62px]' : 'lg:w-[254px]',
    ]"
  >
    <!-- MODO EXPANDIDO (Imagen 1 & 2) -->
    <div
      v-if="!panelStore.sidebarCollapsed || panelStore.mobileSidebarOpen"
      class="sylva-sidebar rounded-2xl flex-1 flex flex-col justify-between p-3.5 overflow-y-auto scrollbar-thin"
    >
      <div class="space-y-5">
        <!-- Brand Header -->
        <div class="flex items-center justify-between px-1 pt-0.5">
          <button
            @click="switchTab('overview')"
            class="flex items-center gap-2.5 text-left group"
          >
            <div
              class="w-7 h-7 rounded-lg bg-[#B9F249] text-[#11150D] flex items-center justify-center font-extrabold shadow-md shadow-[#B9F249]/25 group-hover:scale-105 transition"
            >
              <i class="fa-solid fa-bolt text-xs"></i>
            </div>
            <div class="flex items-baseline gap-1.5">
              <span class="font-bold text-[15px] tracking-tight text-white">
                ALpanel
              </span>
              <span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                CLOUD
              </span>
            </div>
          </button>

          <button
            @click="
              panelStore.mobileSidebarOpen
                ? (panelStore.mobileSidebarOpen = false)
                : toggleSidebar()
            "
            class="w-7 h-7 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition"
            title="Contraer barra lateral"
          >
            <i class="fa-solid fa-table-columns text-xs"></i>
          </button>
        </div>

        <!-- SPACES (Nodos / Proyectos Rápidos) -->
        <div v-if="featuredSpaces.length > 0" class="space-y-1.5">
          <div class="flex items-center justify-between px-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Spaces
            </span>
            <button
              v-if="panelStore.projectSearchQuery"
              @click="panelStore.projectSearchQuery = ''"
              class="text-[10px] text-[#B9F249] hover:underline"
            >
              Ver todos
            </button>
          </div>

          <div class="space-y-1">
            <button
              v-for="sp in featuredSpaces"
              :key="sp.name"
              @click="handleSpaceClick(sp.project)"
              class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition group"
              :class="
                isSpaceSelected(sp.name)
                  ? 'bg-white/[0.09] ring-1 ring-white/15'
                  : 'hover:bg-white/[0.05]'
              "
            >
              <div
                class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs shadow-sm transition group-hover:scale-105"
                :style="{ backgroundColor: sp.bg, color: sp.text }"
              >
                <i class="fa-solid" :class="sp.icon"></i>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                  <span class="truncate">{{ sp.name }}</span>
                  <span
                    v-if="sp.project.status === 'running'"
                    class="w-1.5 h-1.5 rounded-full bg-[#B9F249] shrink-0"
                  ></span>
                </div>
                <div class="text-[10px] text-slate-400 truncate">
                  {{ sp.subtitle }}
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- MENÚ PRINCIPAL -->
        <div class="space-y-1.5">
          <div class="px-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
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
                panelStore.activeTab === item.id
                  ? 'bg-white/[0.09] text-white font-semibold shadow-inner'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium'
              "
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <i
                  class="fa-solid w-4 text-center text-[12px]"
                  :class="[
                    item.icon,
                    panelStore.activeTab === item.id
                      ? 'text-white'
                      : 'text-slate-400',
                  ]"
                ></i>
                <span class="truncate">{{ item.label }}</span>
                <span
                  v-if="panelStore.activeTab === item.id"
                  class="w-1.5 h-1.5 rounded-full bg-[#B9F249] shrink-0 shadow-[0_0_8px_#B9F249]"
                ></span>
              </div>

              <span
                v-if="item.badge !== undefined"
                class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-white/[0.07] text-slate-300 min-w-[20px] text-center"
              >
                {{ item.badge }}
              </span>
            </button>
          </nav>
        </div>
      </div>

      <!-- FOOTER DE UTILIDADES + TEMA + PERFIL -->
      <div class="pt-4 mt-4 border-t border-white/[0.07] space-y-1">
        <button
          v-if="hasPerm('security', 'deploy')"
          @click="pruneServerDocker"
          class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] transition"
        >
          <i class="fa-solid fa-broom w-4 text-center text-[12px]"></i>
          <span>Limpiar Caché Docker</span>
        </button>

        <button
          @click="refreshAll"
          class="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] transition"
        >
          <i class="fa-solid fa-arrows-rotate w-4 text-center text-[12px]"></i>
          <span>Sincronizar Servidor</span>
        </button>

        <!-- Toggle Switch Modo Oscuro / Día (Idéntico a Sylva) -->
        <div
          @click="toggleTheme"
          class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-white/[0.04] cursor-pointer select-none transition"
        >
          <div class="flex items-center gap-2.5">
            <i
              class="fa-solid w-4 text-center text-[12px]"
              :class="panelStore.theme === 'dark' ? 'fa-moon' : 'fa-sun text-amber-500'"
            ></i>
            <span>Dark mode</span>
          </div>

          <div
            class="w-9 h-5 rounded-full p-0.5 transition-colors flex items-center"
            :class="
              panelStore.theme === 'dark'
                ? 'bg-[#B9F249] justify-end'
                : 'bg-slate-400/40 justify-start'
            "
          >
            <span
              class="w-4 h-4 rounded-full shadow transition"
              :class="
                panelStore.theme === 'dark' ? 'bg-[#11150D]' : 'bg-white'
              "
            ></span>
          </div>
        </div>

        <!-- Perfil de Usuario -->
        <div
          v-if="panelStore.currentUser"
          class="mt-2 pt-2.5 border-t border-white/[0.07] flex items-center justify-between gap-2 px-1.5"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div
              class="w-8 h-8 rounded-full bg-gradient-to-br from-[#7DB4D8] to-[#B9F249] text-[#11150D] font-extrabold text-[11px] flex items-center justify-center shrink-0 shadow"
            >
              {{ userInitials }}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-bold text-white truncate">
                {{ panelStore.currentUser.fullName || panelStore.currentUser.username }}
              </div>
              <div class="text-[10px] text-slate-400 truncate">
                {{ panelStore.currentUser.roleName || panelStore.currentUser.role }}
              </div>
            </div>
          </div>

          <button
            @click="emit('logout')"
            class="w-7 h-7 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 flex items-center justify-center transition shrink-0"
            title="Cerrar sesión"
          >
            <i class="fa-solid fa-right-from-bracket text-xs"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- MODO RAIL COLAPSADO (Imagen 3) -->
    <div
      v-else
      class="sylva-sidebar rounded-2xl flex-1 hidden lg:flex flex-col items-center justify-between py-3 px-1.5"
    >
      <div class="flex flex-col items-center gap-3 w-full">
        <button
          @click="toggleSidebar"
          class="w-9 h-9 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition"
          title="Expandir barra lateral"
        >
          <i class="fa-solid fa-table-columns text-xs"></i>
        </button>

        <div class="w-6 h-px bg-white/10"></div>

        <nav class="flex flex-col items-center gap-1.5 w-full">
          <button
            v-for="item in menuItems"
            :key="item.id"
            @click="switchTab(item.id)"
            :title="item.label"
            class="relative w-9 h-9 rounded-xl flex items-center justify-center transition"
            :class="
              panelStore.activeTab === item.id
                ? 'bg-white/[0.11] text-white shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
            "
          >
            <i class="fa-solid text-xs" :class="item.icon"></i>
            <span
              v-if="panelStore.activeTab === item.id"
              class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#B9F249]"
            ></span>
          </button>
        </nav>
      </div>

      <div class="flex flex-col items-center gap-2 w-full">
        <button
          @click="refreshAll"
          title="Sincronizar Servidor"
          class="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] flex items-center justify-center transition"
        >
          <i class="fa-solid fa-arrows-rotate text-xs"></i>
        </button>

        <button
          @click="toggleTheme"
          :title="panelStore.theme === 'dark' ? 'Cambiar a Modo Día' : 'Cambiar a Modo Oscuro'"
          class="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.05] flex items-center justify-center transition"
        >
          <i
            class="fa-solid text-xs"
            :class="panelStore.theme === 'dark' ? 'fa-moon text-[#B9F249]' : 'fa-sun text-amber-500'"
          ></i>
        </button>

        <button
          @click="emit('logout')"
          title="Cerrar sesión"
          class="w-8 h-8 rounded-full bg-gradient-to-br from-[#7DB4D8] to-[#B9F249] text-[#11150D] font-extrabold text-[10px] flex items-center justify-center shadow hover:opacity-90 transition"
        >
          {{ userInitials }}
        </button>
      </div>
    </div>
  </aside>
</template>
