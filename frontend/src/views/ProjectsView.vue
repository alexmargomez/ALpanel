<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  apiFetch,
  hasPerm,
  loadServers,
  openProjectWorkspace,
  panelStore,
  refreshAll,
  runProjectAction,
  showToast,
} from '../composables/usePanelStore';
import { formatBytes } from '../services/api';
import type { ProjectInfo } from '../types/panel';
import SearchableSelect from '../components/common/SearchableSelect.vue';

const serverFilter = ref('all');
const expandedProjects = reactive<Record<string, boolean>>({});
const checkingGitName = ref('');

const serverFilterOptions = computed(() => [
  {
    value: 'all',
    label: 'Todos los servidores',
    sublabel: `${panelStore.projects.length} proyectos totales`,
  },
  ...panelStore.servers.map((s) => ({
    value: s.id,
    label: s.name,
    sublabel: s.isLocal ? 'Nodo Local' : s.host,
    badge: s.status === 'online' ? 'ONLINE' : s.status.toUpperCase(),
  })),
]);

const filteredProjects = computed(() => {
  const q = panelStore.projectSearchQuery.trim().toLowerCase();
  return panelStore.projects.filter((p) => {
    const srvId = p.serverId || 'local';
    if (serverFilter.value !== 'all' && srvId !== serverFilter.value) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      p.name,
      p.serverName || '',
      ...(p.stack || []),
      ...(p.domains || []),
      p.git?.branch || '',
      ...p.containers.map((c) => c.name),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
});

function toggleExpand(name: string): void {
  expandedProjects[name] = !expandedProjects[name];
}

function getStatusBadge(p: ProjectInfo): { label: string; cls: string } {
  if (p.containers.length === 0) {
    return {
      label: 'VACÍO',
      cls: 'bg-slate-800 text-slate-300 border-slate-700',
    };
  }
  if (p.status === 'running') {
    return {
      label: 'ACTIVO',
      cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    };
  }
  if (p.status === 'partial') {
    return {
      label: 'PARCIAL',
      cls: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    };
  }
  return {
    label: 'DETENIDO',
    cls: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  };
}

function getCpuPercent(p: ProjectInfo): string {
  const val = Number(p.resources?.cpuPercent || 0);
  return `${val.toFixed(1)}%`;
}

function getMemUsed(p: ProjectInfo): string {
  const bytes = Number(p.resources?.memUsedBytes || 0);
  return bytes > 0 ? formatBytes(bytes) : '0 B';
}

function getDiskUsed(p: ProjectInfo): string {
  const bytes = Number(p.resources?.diskBytes || 0);
  return bytes > 0 ? formatBytes(bytes) : '—';
}

async function checkRemoteGit(p: ProjectInfo): Promise<void> {
  checkingGitName.value = p.name;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(p.name)}/git-check`, {
      method: 'POST',
    });
    await refreshAll();
    showToast(`Estado remoto de ${p.name} actualizado.`);
  } catch (err: any) {
    showToast(`No se pudo consultar remoto: ${err.message}`, true);
  } finally {
    checkingGitName.value = '';
  }
}

onMounted(() => {
  if (panelStore.servers.length === 0) {
    loadServers().catch(() => {});
  }
});
</script>

<template>
  <section class="space-y-4">
    <!-- Barra Superior de Filtros y Acciones -->
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3"
    >
      <div class="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
        <div class="relative flex-1 min-w-[200px] max-w-sm">
          <i
            class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
          ></i>
          <input
            v-model="panelStore.projectSearchQuery"
            type="text"
            placeholder="Filtrar proyecto, dominio, stack..."
            class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
          />
        </div>

        <div class="w-56">
          <SearchableSelect
            v-model="serverFilter"
            :options="serverFilterOptions"
            placeholder="Filtrar por servidor..."
            search-placeholder="Buscar servidor..."
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="refreshAll"
          class="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <i
            class="fa-solid fa-rotate text-[11px]"
            :class="{ 'fa-spin': panelStore.loadingProjects }"
          ></i>
          <span>Sincronizar</span>
        </button>

        <button
          v-if="hasPerm('git', 'create')"
          @click="panelStore.modals.clone.open = true"
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
        >
          <i class="fa-solid fa-plus text-[11px]"></i>
          <span>Nuevo Proyecto</span>
        </button>
      </div>
    </div>

    <!-- Estado de Carga / Vacío -->
    <div
      v-if="panelStore.loadingProjects && panelStore.projects.length === 0"
      class="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-slate-400 text-xs"
    >
      <i class="fa-solid fa-circle-notch fa-spin text-indigo-400 text-lg mb-2"></i>
      <div>Escaneando proyectos, contenedores y servidores...</div>
    </div>

    <div
      v-else-if="filteredProjects.length === 0"
      class="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3"
    >
      <div class="text-slate-400 text-xs">
        No se encontraron proyectos con los filtros actuales.
      </div>
      <button
        v-if="hasPerm('git', 'create')"
        @click="panelStore.modals.clone.open = true"
        class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
      >
        <i class="fa-solid fa-plus mr-1.5"></i>Crear Primer Proyecto
      </button>
    </div>

    <!-- Lista de Tarjetas Compactas de Proyectos -->
    <div v-else class="space-y-2.5">
      <div
        v-for="p in filteredProjects"
        :key="p.name"
        class="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl transition overflow-hidden"
      >
        <!-- Fila Principal Compacta (Click despliega resumen inferior) -->
        <div
          @click="toggleExpand(p.name)"
          class="px-4 py-3.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 cursor-pointer select-none"
        >
          <!-- Izquierda: Identidad + Servidor + Stack + Dominio + Git -->
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-bold text-white tracking-tight">
                {{ p.name }}
              </span>

              <span
                class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                :class="getStatusBadge(p).cls"
              >
                {{ getStatusBadge(p).label }}
              </span>

              <span
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-950 border border-slate-800 text-slate-300 flex items-center gap-1"
                title="Servidor donde vive este proyecto"
              >
                <i class="fa-solid fa-server text-[9px] text-indigo-400"></i>
                <span>{{ p.serverName || 'Nodo Central (Local)' }}</span>
              </span>

              <span
                v-for="st in (p.stack || []).slice(0, 4)"
                :key="st"
                class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
              >
                {{ st }}
              </span>

              <span
                v-if="p.microservices?.isMicroservicesArchitecture"
                class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25"
              >
                <i class="fa-solid fa-cubes mr-1 text-[9px]"></i>Microservicios
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <a
                v-if="p.domains && p.domains.length > 0"
                :href="`https://${p.domains[0]}`"
                target="_blank"
                rel="noopener"
                @click.stop
                class="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-mono"
              >
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                <span>{{ p.domains[0] }}</span>
                <span
                  v-if="p.domains.length > 1"
                  class="text-[10px] text-slate-500"
                >
                  +{{ p.domains.length - 1 }}
                </span>
              </a>

              <span v-if="p.git?.isRepo" class="flex items-center gap-1.5 font-mono">
                <i class="fa-solid fa-code-branch text-[10px] text-emerald-400"></i>
                <span class="text-slate-300">{{ p.git.branch }}</span>
                <span class="text-slate-500">@{{ p.git.commit }}</span>
                <span
                  v-if="p.git.behindCount > 0"
                  class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold"
                >
                  -{{ p.git.behindCount }} atrás
                </span>
                <button
                  type="button"
                  @click.stop="checkRemoteGit(p)"
                  :disabled="checkingGitName === p.name"
                  class="text-[10px] text-slate-400 hover:text-indigo-300 underline ml-1"
                >
                  {{ checkingGitName === p.name ? 'Verificando...' : 'Verificar remoto' }}
                </button>
              </span>

              <span class="text-slate-500">
                <i class="fa-brands fa-docker mr-1"></i>
                {{ p.containers.filter((c) => c.state === 'running').length }}/{{ p.containers.length }} contenedores
              </span>
            </div>
          </div>

          <!-- Derecha: Mini-telemetría (CPU | RAM | DISCO) + Botón Administrar + Chevron -->
          <div class="flex items-center gap-3 shrink-0 ml-auto">
            <div
              class="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-950/90 border border-slate-800/90"
            >
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                  CPU Proyecto
                </div>
                <div class="text-xs font-mono font-bold text-indigo-300">
                  {{ getCpuPercent(p) }}
                </div>
              </div>
              <div class="w-px h-6 bg-slate-800"></div>
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                  RAM Usada
                </div>
                <div class="text-xs font-mono font-bold text-emerald-300">
                  {{ getMemUsed(p) }}
                </div>
              </div>
              <div class="w-px h-6 bg-slate-800"></div>
              <div class="text-right">
                <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                  Disco
                </div>
                <div class="text-xs font-mono font-bold text-amber-300">
                  {{ getDiskUsed(p) }}
                </div>
              </div>
            </div>

            <button
              type="button"
              @click.stop="openProjectWorkspace(p.name, 'containers')"
              class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-indigo-600/20"
            >
              <i class="fa-solid fa-sliders text-[11px]"></i>
              <span>Administrar</span>
              <i class="fa-solid fa-arrow-right text-[10px]"></i>
            </button>

            <button
              type="button"
              @click.stop="toggleExpand(p.name)"
              class="w-8 h-8 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition"
              :title="expandedProjects[p.name] ? 'Contraer resumen' : 'Ver resumen rápido'"
            >
              <i
                class="fa-solid fa-chevron-down text-xs transition-transform duration-200"
                :class="{ 'rotate-180': expandedProjects[p.name] }"
              ></i>
            </button>
          </div>
        </div>

        <!-- Desplegable Rápido (Accordion) -->
        <div
          v-if="expandedProjects[p.name]"
          class="px-4 pb-4 pt-3 border-t border-slate-800/80 bg-slate-950/50 space-y-3"
        >
          <!-- Accesos Rápidos a Pestañas del Workspace + Acciones Docker -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                @click="openProjectWorkspace(p.name, 'containers')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-brands fa-docker text-sky-400 mr-1"></i>Contenedores
              </button>
              <button
                @click="openProjectWorkspace(p.name, 'files')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-solid fa-folder-tree text-amber-400 mr-1"></i>Archivos
              </button>
              <button
                @click="openProjectWorkspace(p.name, 'git')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-brands fa-git-alt text-orange-400 mr-1"></i>Git &amp; Commits
              </button>
              <button
                @click="openProjectWorkspace(p.name, 'domains')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-solid fa-globe text-emerald-400 mr-1"></i>Dominios &amp; Gateway
              </button>
              <button
                @click="openProjectWorkspace(p.name, 'database')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-solid fa-database text-violet-400 mr-1"></i>Base de Datos
              </button>
              <button
                @click="openProjectWorkspace(p.name, 'env-cron')"
                class="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-medium"
              >
                <i class="fa-solid fa-sliders text-indigo-400 mr-1"></i>.env &amp; Cron
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-if="p.git?.isRepo && hasPerm('projects', 'git_pull')"
                @click="runProjectAction(p.name, 'pull')"
                class="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold"
              >
                <i class="fa-solid fa-cloud-arrow-down mr-1"></i>Git Pull
              </button>
              <button
                v-if="hasPerm('projects', 'deploy')"
                @click="runProjectAction(p.name, 'restart')"
                class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold"
              >
                <i class="fa-solid fa-rotate-right mr-1"></i>Restart
              </button>
              <button
                v-if="hasPerm('projects', 'deploy')"
                @click="runProjectAction(p.name, 'rebuild')"
                class="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-semibold"
              >
                <i class="fa-solid fa-hammer mr-1"></i>Rebuild
              </button>
            </div>
          </div>

          <!-- Resumen de Contenedores -->
          <div v-if="p.containers.length > 0" class="flex flex-wrap gap-2">
            <div
              v-for="c in p.containers"
              :key="c.name"
              class="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-2 text-[11px]"
            >
              <span
                class="w-2 h-2 rounded-full"
                :class="c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-400'"
              ></span>
              <span class="font-mono font-semibold text-slate-200">{{ c.name }}</span>
              <span class="text-[10px] text-slate-500">{{ c.role }}</span>
            </div>
          </div>
          <div v-else class="text-[11px] text-slate-500">
            Proyecto sin contenedores activos todavía. Entra a <strong>Administrar</strong> para agregar contenedores desde Git, otro servidor o Docker.
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
