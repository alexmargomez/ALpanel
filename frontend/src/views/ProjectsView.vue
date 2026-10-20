<script setup lang="ts">
import { computed } from 'vue';
import {
  apiFetch,
  hasPerm,
  openEnvModal,
  openLogsModal,
  panelStore,
  refreshAll,
  runProjectAction,
  showToast,
} from '../composables/usePanelStore';
import { formatBytes } from '../services/api';
import type { ProjectInfo } from '../types/panel';

const filteredProjects = computed<ProjectInfo[]>(() => {
  const q = (panelStore.projectSearchQuery || '').toLowerCase().trim();
  if (!q) return panelStore.projects;
  return panelStore.projects.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.domains.some((d) => d.toLowerCase().includes(q)) ||
      p.stack.some((s) => s.toLowerCase().includes(q))
  );
});

const canDeployProjects = computed(() => hasPerm('projects', 'deploy'));
const canStopRebuildServer = computed(() => hasPerm('projects', 'delete'));
const canViewLogs = computed(() => hasPerm('projects', 'edit'));
const canViewDb = computed(() => hasPerm('project_db', 'view'));
const canViewEnv = computed(() => hasPerm('project_env', 'view'));
const canDeployGitProd = computed(() => hasPerm('git', 'deploy'));
const canUseDevMode = computed(() => hasPerm('git', 'edit'));
const canManageAppUsers = computed(() => hasPerm('projects.app_users', 'view'));

function isSelfPanel(projectName: string): boolean {
  return ['serverpanel', 'alpanel'].includes(projectName.toLowerCase());
}

async function checkGitUpdates(projectName: string): Promise<void> {
  showToast(`Verificando repositorio remoto de ${projectName}...`);
  try {
    const res = await apiFetch<{ output: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/check-updates`,
      { method: 'POST' }
    );
    showToast(res.output || 'Verificación completada');
    await refreshAll();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}

function openDbModal(projectName: string): void {
  panelStore.modals.db.projectName = projectName;
  panelStore.modals.db.open = true;
}

function openAppUsersModal(projectName: string): void {
  panelStore.modals.appUsers.projectName = projectName;
  panelStore.modals.appUsers.open = true;
}
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold text-white">Proyectos Alojados en el Servidor</h2>
        <p class="text-xs text-slate-400">
          Carpeta raíz:
          <code class="text-indigo-400 bg-slate-900 px-1.5 py-0.5 rounded">
            {{ panelStore.projectsRoot }}
          </code>
        </p>
      </div>
      <div class="relative w-full sm:w-72">
        <i class="fa-solid fa-search absolute left-3.5 top-3 text-slate-500 text-xs"></i>
        <input
          v-model="panelStore.projectSearchQuery"
          type="text"
          placeholder="Filtrar proyecto o dominio..."
          class="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        />
      </div>
    </div>

    <div
      v-if="panelStore.loadingProjects && panelStore.projects.length === 0"
      class="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-slate-300 text-sm flex flex-col items-center justify-center gap-3"
    >
      <i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-400"></i>
      <span class="font-medium">Cargando proyectos alojados en el servidor...</span>
    </div>

    <div
      v-else-if="filteredProjects.length === 0"
      class="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-sm"
    >
      {{
        panelStore.projectSearchQuery
          ? 'No se encontraron proyectos con ese filtro.'
          : 'No hay proyectos alojados todavía en el servidor.'
      }}
    </div>

    <div v-else class="grid grid-cols-1 gap-5">
      <div
        v-for="p in filteredProjects"
        :key="p.name"
        class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <h3 class="text-lg font-bold text-white">{{ p.name }}</h3>
              <span
                v-if="p.status === 'running'"
                class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              >
                <i class="fa-solid fa-circle text-[8px] mr-1"></i>ACTIVO
              </span>
              <span
                v-else-if="p.status === 'partial'"
                class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20"
              >
                PARCIAL
              </span>
              <span
                v-else
                class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20"
              >
                DETENIDO
              </span>

              <span
                v-if="p.git.behindCount > 0"
                class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse"
              >
                <i class="fa-solid fa-arrow-up mr-1"></i>{{ p.git.behindCount }} commit(s) por bajar
              </span>

              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="s in p.stack"
                  :key="s"
                  class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px] font-medium"
                >
                  {{ s }}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3 pt-0.5">
              <template v-if="p.domains.length">
                <a
                  v-for="d in p.domains"
                  :key="d"
                  :href="`https://${d}`"
                  target="_blank"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 text-xs font-medium transition"
                >
                  <i class="fa-solid fa-lock text-[10px] text-emerald-400"></i>
                  {{ d }}
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
              </template>
              <span v-else class="text-xs text-slate-500">Sin dominio asignado</span>

              <span class="text-xs text-slate-400 font-mono">
                <i class="fa-brands fa-git-alt text-orange-400 mr-1"></i>{{ p.git.branch }} ({{
                  p.git.commitHash
                }})
              </span>

              <button
                v-if="p.git.isRepo && hasPerm('git', 'view')"
                @click="checkGitUpdates(p.name)"
                class="text-[11px] text-indigo-400 hover:underline"
                title="Consultar si hay nuevos commits en el repositorio remoto"
              >
                <i class="fa-solid fa-magnifying-glass mr-1"></i>Verificar remoto
              </button>
            </div>
          </div>

          <!-- Consumo del Proyecto -->
          <div
            class="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs"
          >
            <div>
              <span class="text-slate-400 block text-[10px] uppercase">CPU Proyecto</span>
              <span class="font-bold text-indigo-400 text-sm">{{ p.resources.cpuPercent }}%</span>
            </div>
            <div class="h-6 w-px bg-slate-800 mx-1"></div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase">RAM Usada</span>
              <span class="font-bold text-emerald-400 text-sm">
                {{ formatBytes(p.resources.memoryBytes) }}
              </span>
            </div>
            <div class="h-6 w-px bg-slate-800 mx-1"></div>
            <div>
              <span class="text-slate-400 block text-[10px] uppercase">Disco</span>
              <span class="font-bold text-amber-400 text-sm">
                {{ formatBytes(p.resources.diskBytes) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Botonera de Acciones del Proyecto -->
        <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
          <button
            v-if="canDeployGitProd"
            @click="runProjectAction(p.name, 'pull')"
            class="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
            title="Descarga cambios de GitHub (git pull origin main) con Rollback de Git si hay conflictos, sin reiniciar ni destruir Docker"
          >
            <i class="fa-solid fa-cloud-arrow-down"></i> Git Pull
          </button>

          <template v-if="canDeployProjects">
            <button
              @click="runProjectAction(p.name, 'restart')"
              class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
              title="Reinicia los contenedores de aplicación (manteniendo la Base de Datos intacta)"
            >
              <i class="fa-solid fa-rotate"></i> Restart Docker
            </button>
            <button
              @click="runProjectAction(p.name, 'clear-cache')"
              class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
              title="Limpia la caché del framework y recarga los contenedores de aplicación sin tocar la Base de Datos"
            >
              <i class="fa-solid fa-broom"></i> Limpiar Caché
            </button>
          </template>

          <button
            v-if="canViewDb"
            @click="openDbModal(p.name)"
            class="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-solid fa-database"></i> Base de Datos
          </button>

          <button
            v-if="!isSelfPanel(p.name) && p.database?.hasDatabase && canManageAppUsers"
            @click="openAppUsersModal(p.name)"
            class="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-semibold transition flex items-center gap-1.5"
            :title="`Ver, crear y cambiar contraseñas de usuarios internos de ${p.name}`"
          >
            <i class="fa-solid fa-users-rectangle"></i> Usuarios App
          </button>

          <button
            v-if="canViewEnv"
            @click="openEnvModal(p.name)"
            class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-solid fa-key"></i> .env
          </button>

          <button
            v-if="canViewLogs"
            @click="openLogsModal(p.name)"
            class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-solid fa-terminal"></i> Logs
          </button>

          <button
            v-if="canStopRebuildServer"
            @click="runProjectAction(p.name, 'rebuild')"
            class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
            title="Reconstruir imágenes Docker (docker compose up -d --build)"
          >
            <i class="fa-solid fa-hammer"></i> Rebuild
          </button>

          <!-- Modo Desarrollador (develop) -->
          <template v-if="canUseDevMode">
            <template v-if="p.devMode && p.devMode.isActive">
              <button
                @click="runProjectAction(p.name, 'dev-activate')"
                class="px-3 py-2 rounded-xl bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-300 border border-fuchsia-500/40 text-xs font-semibold transition flex items-center gap-1.5"
                title="Sincronizar últimos commits de origin/develop en el entorno de pruebas"
              >
                <i class="fa-solid fa-flask"></i> Actualizar Dev (develop)
              </button>
              <button
                @click="runProjectAction(p.name, 'dev-deactivate')"
                class="px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition flex items-center gap-1.5"
                title="Apagar Modo Desarrollador y liberar subdominio de pruebas"
              >
                <i class="fa-solid fa-power-off"></i> Apagar Modo Dev
              </button>
            </template>
            <button
              v-else
              @click="runProjectAction(p.name, 'dev-activate')"
              class="px-3 py-2 rounded-xl bg-fuchsia-950/60 hover:bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-700/50 text-xs font-semibold transition flex items-center gap-1.5"
              title="Desplegar rama develop de este proyecto en el subdominio de pruebas"
            >
              <i class="fa-solid fa-flask"></i> Modo Desarrollador
            </button>
          </template>

          <span
            v-if="isSelfPanel(p.name)"
            class="ml-auto px-3 py-2 rounded-xl bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-shield-halved"></i> Panel Principal
          </span>
          <template v-else-if="canStopRebuildServer">
            <button
              v-if="p.status === 'running'"
              @click="runProjectAction(p.name, 'stop')"
              class="ml-auto px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-800/60 text-xs font-semibold transition flex items-center gap-1.5"
            >
              <i class="fa-solid fa-stop"></i> Detener
            </button>
            <button
              v-else
              @click="runProjectAction(p.name, 'start')"
              class="ml-auto px-3 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/60 text-xs font-semibold transition flex items-center gap-1.5"
            >
              <i class="fa-solid fa-play"></i> Iniciar
            </button>
          </template>
        </div>

        <!-- Banner de Modo Desarrollador Activo en esta Tarjeta -->
        <div
          v-if="p.devMode && p.devMode.isActive"
          class="flex flex-wrap items-center justify-between gap-3 bg-fuchsia-950/30 border border-fuchsia-500/40 rounded-xl px-4 py-2.5 text-xs"
        >
          <div class="flex flex-wrap items-center gap-2.5">
            <span
              class="px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-bold text-[11px]"
            >
              <i class="fa-solid fa-flask mr-1"></i>MODO DESARROLLADOR ACTIVO
            </span>
            <span class="text-slate-300 font-mono">
              <i class="fa-brands fa-git-alt text-fuchsia-400 mr-1"></i>develop ({{
                p.devMode.commitHash
              }})
            </span>
            <span class="text-slate-400 truncate max-w-md">{{ p.devMode.commitMessage || '' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <a
              :href="`https://${p.devMode.domain}`"
              target="_blank"
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-semibold transition shadow"
            >
              <i class="fa-solid fa-lock text-[10px]"></i>
              https://{{ p.devMode.domain }}
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
            <button
              @click="openLogsModal(p.name, 'alpanel_dev_app')"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-fuchsia-200 border border-slate-700"
            >
              <i class="fa-solid fa-terminal mr-1"></i>Logs Dev
            </button>
          </div>
        </div>

        <!-- Lista de Contenedores del Proyecto -->
        <div class="space-y-1.5 pt-1">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Contenedores del Proyecto ({{ p.containers.length }})
          </div>
          <div v-if="p.containers.length === 0" class="text-xs text-slate-500 italic">
            No hay contenedores creados para este proyecto todavía.
          </div>
          <div
            v-for="c in p.containers"
            :key="c.id || c.name"
            class="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2 text-xs"
          >
            <div class="flex items-center gap-2.5 min-w-[180px]">
              <span
                class="w-2 h-2 rounded-full"
                :class="c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'"
              ></span>
              <span class="font-semibold text-white">{{ c.name }}</span>
              <span class="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                <span v-if="c.role === 'database'" class="text-amber-400">
                  <i class="fa-solid fa-database mr-1"></i>DB
                </span>
                <span v-else-if="c.role === 'proxy'" class="text-emerald-400">
                  <i class="fa-solid fa-shield-halved mr-1"></i>SSL Proxy
                </span>
                <span v-else-if="c.role === 'frontend'" class="text-sky-400">
                  <i class="fa-solid fa-desktop mr-1"></i>Frontend
                </span>
                <span v-else class="text-indigo-400">
                  <i class="fa-solid fa-gears mr-1"></i>Backend
                </span>
              </span>
            </div>

            <div class="text-slate-400 text-[11px] font-mono">{{ c.image }}</div>

            <div class="flex items-center gap-4 text-[11px]">
              <span>
                CPU: <strong class="text-slate-200">{{ c.cpuPercent }}%</strong>
              </span>
              <span>
                RAM: <strong class="text-emerald-400">{{ formatBytes(c.memoryBytes) }}</strong>
              </span>
              <span v-if="c.ports.length" class="text-slate-400 hidden sm:inline">
                <i class="fa-solid fa-plug mr-1"></i>{{ c.ports.join(', ') }}
              </span>
            </div>

            <div class="flex items-center gap-1.5">
              <button
                v-if="canDeployProjects"
                @click="runProjectAction(p.name, 'restart', { containerName: c.name })"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                title="Reiniciar solo este contenedor"
              >
                <i class="fa-solid fa-rotate"></i> Restart
              </button>
              <button
                v-if="canViewLogs"
                @click="openLogsModal(p.name, c.name)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px]"
                title="Ver logs de este contenedor"
              >
                <i class="fa-solid fa-terminal"></i> Logs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
