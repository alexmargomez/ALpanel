<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  apiFetch,
  hasPerm,
  openCronjobsModal,
  openErdModal,
  openTerminalModal,
  panelStore,
  runProjectAction,
  showToast,
  switchTab,
} from '../composables/usePanelStore';
import type { WorkspaceSubTab } from '../types/panel';
import ProjectContainersTab from '../components/project-workspace/ProjectContainersTab.vue';
import ProjectFilesTab from '../components/project-workspace/ProjectFilesTab.vue';
import ProjectGitTab from '../components/project-workspace/ProjectGitTab.vue';
import ProjectDomainsGatewayTab from '../components/project-workspace/ProjectDomainsGatewayTab.vue';

const project = computed(() =>
  panelStore.projects.find(
    (p) => p.name === panelStore.activeProjectWorkspace.projectName
  )
);

const activeSubTab = computed({
  get: () => panelStore.activeProjectWorkspace.subTab,
  set: (v: WorkspaceSubTab) => {
    panelStore.activeProjectWorkspace.subTab = v;
  },
});

const envContent = ref('');
const loadingEnv = ref(false);
const savingEnv = ref(false);

const subTabs: Array<{
  id: WorkspaceSubTab;
  label: string;
  icon: string;
}> = [
  { id: 'containers', label: 'Contenedores', icon: 'fa-brands fa-docker' },
  { id: 'files', label: 'Archivos', icon: 'fa-solid fa-folder-tree' },
  { id: 'git', label: 'Git & Commits', icon: 'fa-brands fa-git-alt' },
  { id: 'domains', label: 'Dominios & Gateway', icon: 'fa-solid fa-globe' },
  { id: 'database', label: 'Base de Datos', icon: 'fa-solid fa-database' },
  { id: 'env-cron', label: '.env & Cronjobs', icon: 'fa-solid fa-sliders' },
];

async function loadInlineEnv(): Promise<void> {
  if (!project.value) return;
  loadingEnv.value = true;
  try {
    const res = await apiFetch<{ content: string }>(
      `/api/projects/${encodeURIComponent(project.value.name)}/env`
    );
    envContent.value = res.content || '';
  } catch (err: any) {
    envContent.value = '';
    showToast(`No se pudo leer .env: ${err.message}`, true);
  } finally {
    loadingEnv.value = false;
  }
}

async function saveInlineEnv(): Promise<void> {
  if (!project.value) return;
  savingEnv.value = true;
  try {
    await apiFetch(
      `/api/projects/${encodeURIComponent(project.value.name)}/env`,
      {
        method: 'POST',
        body: JSON.stringify({ content: envContent.value }),
      }
    );
    showToast(`Archivo .env de ${project.value.name} guardado.`);
  } catch (err: any) {
    showToast(`Error guardando .env: ${err.message}`, true);
  } finally {
    savingEnv.value = false;
  }
}

function openDbModal(): void {
  if (!project.value) return;
  panelStore.modals.db.projectName = project.value.name;
  panelStore.modals.db.open = true;
}

function openAppUsersModal(): void {
  if (!project.value) return;
  panelStore.modals.appUsers.projectName = project.value.name;
  panelStore.modals.appUsers.open = true;
}

function confirmRebuildDestroy(): void {
  if (!project.value) return;
  if (
    !confirm(
      `⚠️ ¿Ejecutar REBUILD DESTROY TOTAL en "${project.value.name}"? Esto detendrá y recreará todos los contenedores desde cero.`
    )
  ) {
    return;
  }
  runProjectAction(project.value.name, 'rebuild-destroy');
}

function confirmDeleteProject(): void {
  if (!project.value) return;
  const name = project.value.name;
  if (
    !confirm(
      `⚠️ ¿ELIMINAR DEFINITIVAMENTE el proyecto "${name}" y detener sus contenedores?`
    )
  ) {
    return;
  }
  runProjectAction(name, 'delete');
  switchTab('projects');
}

watch(
  () => [activeSubTab.value, project.value?.name],
  ([tab]) => {
    if (tab === 'env-cron') {
      loadInlineEnv();
    }
  },
  { immediate: true }
);
</script>

<template>
  <section v-if="project" class="space-y-4">
    <!-- Encabezado del Espacio de Trabajo del Proyecto -->
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1.5 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <button
              @click="switchTab('projects')"
              class="w-8 h-8 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition"
              title="Volver a Proyectos"
            >
              <i class="fa-solid fa-arrow-left text-xs"></i>
            </button>

            <h2 class="text-lg font-bold text-white tracking-tight">
              {{ project.name }}
            </h2>

            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
              :class="
                project.status === 'running'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : project.status === 'partial'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
              "
            >
              {{ project.status.toUpperCase() }}
            </span>

            <span
              class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 flex items-center gap-1"
            >
              <i class="fa-solid fa-server text-[9px]"></i>
              <span>{{ project.serverName || 'Nodo Central (Local)' }}</span>
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono pl-10">
            <span>{{ project.path }}</span>
            <a
              v-if="project.domains && project.domains.length > 0"
              :href="`https://${project.domains[0]}`"
              target="_blank"
              rel="noopener"
              class="text-indigo-400 hover:underline"
            >
              https://{{ project.domains[0] }}
            </a>
          </div>
        </div>

        <!-- Acciones Maestras del Proyecto -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-if="project.git?.isRepo && hasPerm('projects', 'git_pull')"
            @click="runProjectAction(project.name, 'pull')"
            class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-cloud-arrow-down text-[11px]"></i>
            <span>Git Pull</span>
          </button>

          <!-- Botón Dinámico Único: Detener (si está activo/parcial) o Iniciar (si está detenido) -->
          <button
            v-if="
              (project.status === 'running' || project.status === 'partial') &&
              hasPerm('projects', 'delete')
            "
            @click="runProjectAction(project.name, 'stop')"
            class="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-stop text-[11px]"></i>
            <span>Detener</span>
          </button>
          <button
            v-else-if="hasPerm('projects', 'deploy')"
            @click="runProjectAction(project.name, 'start')"
            class="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-play text-[11px]"></i>
            <span>Iniciar</span>
          </button>

          <button
            v-if="hasPerm('projects', 'deploy')"
            @click="runProjectAction(project.name, 'restart')"
            class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
            title="Reiniciar contenedores Docker del proyecto"
          >
            <i class="fa-solid fa-rotate-right text-[11px]"></i>
            <span>Restart</span>
          </button>

          <button
            v-if="hasPerm('projects', 'deploy')"
            @click="runProjectAction(project.name, 'clear-cache')"
            class="px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1.5"
            title="Limpiar caché interna del proyecto"
          >
            <i class="fa-solid fa-broom text-[11px]"></i>
            <span>Limpiar Caché</span>
          </button>

          <button
            v-if="hasPerm('projects', 'deploy')"
            @click="runProjectAction(project.name, 'rebuild')"
            class="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-hammer text-[11px]"></i>
            <span>Rebuild</span>
          </button>

          <button
            v-if="hasPerm('projects', 'delete')"
            @click="confirmRebuildDestroy"
            class="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold"
            title="Rebuild Destroy Total"
          >
            <i class="fa-solid fa-bomb"></i>
          </button>

          <button
            v-if="hasPerm('projects', 'delete')"
            @click="confirmDeleteProject"
            class="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-xs font-semibold"
            title="Eliminar proyecto"
          >
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <!-- Barra de Sub-Pestañas Internas -->
      <div class="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-800">
        <button
          v-for="t in subTabs"
          :key="t.id"
          @click="activeSubTab = t.id"
          class="px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 whitespace-nowrap border"
          :class="
            activeSubTab === t.id
              ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35'
              : 'bg-slate-950/60 text-slate-400 hover:text-white border-transparent hover:border-slate-800'
          "
        >
          <i :class="t.icon"></i>
          <span>{{ t.label }}</span>
        </button>
      </div>
    </div>

    <!-- Contenido de la Sub-Pestaña Activa -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
      <ProjectContainersTab
        v-if="activeSubTab === 'containers'"
        :project="project"
      />
      <ProjectFilesTab
        v-else-if="activeSubTab === 'files'"
        :project="project"
      />
      <ProjectGitTab
        v-else-if="activeSubTab === 'git'"
        :project="project"
      />
      <ProjectDomainsGatewayTab
        v-else-if="activeSubTab === 'domains'"
        :project="project"
      />

      <!-- Sub-Tab 5: Base de Datos, DER & App Users -->
      <div v-else-if="activeSubTab === 'database'" class="space-y-4">
        <div>
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-database text-violet-400"></i>
            <span>Base de Datos, Diagrama DER &amp; Usuarios de Aplicación</span>
          </h3>
          <p class="text-[11px] text-slate-400">
            Motor detectado:
            <strong class="text-white">
              {{ project.database?.engine || 'Sin motor detectado' }}
            </strong>
            <span v-if="project.database?.containerName" class="font-mono text-indigo-300 ml-1">
              ({{ project.database.containerName }})
            </span>
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            @click="openDbModal"
            class="p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-indigo-500/40 text-left transition space-y-2"
          >
            <div class="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center">
              <i class="fa-solid fa-key"></i>
            </div>
            <div class="text-xs font-bold text-white">Credenciales &amp; Backups</div>
            <div class="text-[11px] text-slate-400">
              Ver credenciales, exportar dump SQL y restaurar backups.
            </div>
          </button>

          <button
            v-if="project.database?.containerName"
            @click="openTerminalModal(project.name, project.database.containerName, 'sql', project.database.database || '')"
            class="p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-left transition space-y-2"
          >
            <div class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <i class="fa-solid fa-terminal"></i>
            </div>
            <div class="text-xs font-bold text-white">Consola SQL Interactiva</div>
            <div class="text-[11px] text-slate-400">
              Ejecuta consultas psql / mysql directamente en el contenedor.
            </div>
          </button>

          <button
            v-if="project.database?.containerName"
            @click="openErdModal(project.name, project.database.containerName, project.database.database || '')"
            class="p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-violet-500/40 text-left transition space-y-2"
          >
            <div class="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center">
              <i class="fa-solid fa-diagram-project"></i>
            </div>
            <div class="text-xs font-bold text-white">Diagrama DER / ERD</div>
            <div class="text-[11px] text-slate-400">
              Visualiza tablas, relaciones y llaves foráneas en vivo.
            </div>
          </button>

          <button
            @click="openAppUsersModal"
            class="p-4 rounded-2xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-amber-500/40 text-left transition space-y-2"
          >
            <div class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <i class="fa-solid fa-users"></i>
            </div>
            <div class="text-xs font-bold text-white">Usuarios de Aplicación</div>
            <div class="text-[11px] text-slate-400">
              Administra usuarios, contraseñas y tenants de la app.
            </div>
          </button>
        </div>
      </div>

      <!-- Sub-Tab 6: Variables .env & Cronjobs -->
      <div v-else-if="activeSubTab === 'env-cron'" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-sliders text-indigo-400"></i>
              <span>Variables de Entorno (.env) &amp; Cronjobs</span>
            </h3>
            <p class="text-[11px] text-slate-400">
              Edita el archivo <code>.env</code> raíz del proyecto o administra tareas programadas.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="openCronjobsModal(project.name)"
              class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
            >
              <i class="fa-solid fa-clock text-amber-400"></i>
              <span>Gestionar Cronjobs</span>
            </button>
            <button
              @click="saveInlineEnv"
              :disabled="savingEnv || loadingEnv"
              class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <i
                class="fa-solid"
                :class="savingEnv ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"
              ></i>
              <span>Guardar .env</span>
            </button>
          </div>
        </div>

        <div v-if="loadingEnv" class="text-xs text-slate-400 py-6 text-center">
          <i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Cargando .env...
        </div>
        <textarea
          v-else
          v-model="envContent"
          rows="16"
          spellcheck="false"
          placeholder="KEY=VALUE"
          class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-2xl p-4 font-mono text-xs text-emerald-300 leading-relaxed focus:outline-none"
        ></textarea>
      </div>
    </div>
  </section>

  <!-- Fallback si el proyecto no se encuentra -->
  <section
    v-else
    class="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3"
  >
    <div class="text-slate-400 text-xs">
      No se encontró el proyecto seleccionado.
    </div>
    <button
      @click="switchTab('projects')"
      class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
    >
      Volver a Proyectos
    </button>
  </section>
</template>
