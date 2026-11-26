<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  apiFetch,
  hasPerm,
  runProjectAction,
  showToast,
} from '../../composables/usePanelStore';
import type {
  ProjectGitInspectorOverview,
  ProjectInfo,
} from '../../types/panel';

const props = defineProps<{
  project: ProjectInfo;
}>();

const loading = ref(false);
const overview = ref<ProjectGitInspectorOverview | null>(null);
const selectedDiffPath = ref('');
const diffOutput = ref('');
const loadingDiff = ref(false);

async function loadGitOverview(): Promise<void> {
  loading.value = true;
  try {
    const res = await apiFetch<ProjectGitInspectorOverview>(
      `/api/projects/${encodeURIComponent(props.project.name)}/git-inspector?limit=30`
    );
    overview.value = res;
  } catch (err: any) {
    showToast(`Error consultando Git: ${err.message}`, true);
  } finally {
    loading.value = false;
  }
}

async function inspectDiff(filePath = ''): Promise<void> {
  selectedDiffPath.value = filePath;
  loadingDiff.value = true;
  try {
    const res = await apiFetch<{ diff: string }>(
      `/api/projects/${encodeURIComponent(props.project.name)}/git-inspector/diff?path=${encodeURIComponent(filePath)}`
    );
    diffOutput.value = res.diff || 'Sin diferencias de texto en este archivo.';
  } catch (err: any) {
    diffOutput.value = `Error obteniendo diff: ${err.message}`;
  } finally {
    loadingDiff.value = false;
  }
}

function formatCommitDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

watch(
  () => props.project.name,
  () => {
    diffOutput.value = '';
    selectedDiffPath.value = '';
    loadGitOverview();
  }
);

onMounted(() => {
  loadGitOverview();
});
</script>

<template>
  <div class="space-y-4">
    <!-- Barra Superior Git -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <i class="fa-brands fa-git-alt text-orange-400"></i>
          <span>Estado Git &amp; Historial de Commits</span>
        </h3>
        <p v-if="overview?.isRepo" class="text-[11px] text-slate-400 font-mono">
          Rama actual:
          <span class="text-emerald-400 font-semibold">{{ overview.currentBranch }}</span>
          <span v-if="overview.remoteUrl" class="text-slate-500">
            · {{ overview.remoteUrl }}
          </span>
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          @click="loadGitOverview"
          :disabled="loading"
          class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
        >
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }"></i>
          <span>Actualizar</span>
        </button>

        <button
          v-if="overview?.isRepo && hasPerm('projects', 'git_pull')"
          @click="runProjectAction(project.name, 'pull')"
          class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>Git Pull &amp; Deploy</span>
        </button>
      </div>
    </div>

    <div
      v-if="loading && !overview"
      class="bg-slate-950/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs"
    >
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>Inspeccionando repositorio Git...
    </div>

    <div
      v-else-if="overview && !overview.isRepo"
      class="bg-slate-950/60 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs"
    >
      Este proyecto no está inicializado como repositorio Git todavía.
    </div>

    <template v-else-if="overview">
      <!-- Estado del Working Tree (git status) -->
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-xs font-bold text-white">
            <i class="fa-solid fa-code-compare text-indigo-400"></i>
            <span>Cambios Locales (git status)</span>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-bold"
              :class="
                overview.changedFiles.length === 0
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-amber-500/15 text-amber-300'
              "
            >
              {{
                overview.changedFiles.length === 0
                  ? 'Árbol limpio'
                  : `${overview.changedFiles.length} archivo(s) modificados`
              }}
            </span>
          </div>

          <button
            v-if="overview.changedFiles.length > 0"
            @click="inspectDiff('')"
            class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-semibold"
          >
            Ver Diff Completo
          </button>
        </div>

        <div
          v-if="overview.changedFiles.length > 0"
          class="divide-y divide-slate-800/70 max-h-56 overflow-y-auto"
        >
          <div
            v-for="entry in overview.changedFiles"
            :key="entry.path"
            @click="inspectDiff(entry.path)"
            class="py-2 px-2 hover:bg-slate-900 rounded-lg cursor-pointer flex items-center justify-between gap-2 text-xs font-mono"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                :class="
                  entry.code.includes('?')
                    ? 'bg-sky-500/15 text-sky-300'
                    : entry.code.includes('D')
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-amber-500/15 text-amber-300'
                "
              >
                {{ entry.code }}
              </span>
              <span class="text-slate-200 truncate">{{ entry.path }}</span>
              <span class="text-[10px] text-slate-500 hidden sm:inline">
                ({{ entry.statusLabel }})
              </span>
            </div>
            <span class="text-[10px] text-indigo-400 shrink-0">Ver diff →</span>
          </div>
        </div>

        <!-- Visor de Diff -->
        <div
          v-if="diffOutput || loadingDiff"
          class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"
        >
          <div
            class="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-300"
          >
            <span>git diff {{ selectedDiffPath || '(todos los archivos)' }}</span>
            <button
              @click="diffOutput = ''"
              class="text-slate-400 hover:text-white"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <pre
            class="p-3 text-[11px] font-mono text-emerald-200 overflow-x-auto max-h-72 leading-relaxed"
          >{{ loadingDiff ? 'Cargando diff...' : diffOutput }}</pre>
        </div>
      </div>

      <!-- Historial de Commits -->
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-white flex items-center gap-2">
            <i class="fa-solid fa-clock-rotate-left text-emerald-400"></i>
            <span>Historial de Commits ({{ overview.currentBranch }})</span>
          </h4>
          <span class="text-[10px] text-slate-400">
            Mostrando últimos {{ overview.commits.length }} commits
          </span>
        </div>

        <div
          v-if="overview.commits.length === 0"
          class="text-xs text-slate-500 py-3"
        >
          No se encontraron commits en esta rama.
        </div>

        <div v-else class="divide-y divide-slate-800/70">
          <div
            v-for="commit in overview.commits"
            :key="commit.hash"
            class="py-3 flex flex-col gap-1.5"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <code
                  class="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 text-[11px] font-bold shrink-0"
                >
                  {{ commit.shortHash }}
                </code>
                <span class="text-xs font-semibold text-white truncate">
                  {{ commit.subject }}
                </span>
              </div>
              <span class="text-[10px] text-slate-400 font-mono shrink-0">
                {{ formatCommitDate(commit.dateIso) }}
                <span v-if="commit.relativeDate" class="text-slate-500">
                  ({{ commit.relativeDate }})
                </span>
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span class="flex items-center gap-1 text-slate-300 font-medium">
                <i class="fa-solid fa-user text-[10px] text-emerald-400"></i>
                {{ commit.authorName }}
              </span>
              <span class="text-slate-500 font-mono">&lt;{{ commit.authorEmail }}&gt;</span>
            </div>

            <div
              v-if="commit.filesChanged && commit.filesChanged.length > 0"
              class="flex flex-wrap gap-1 pt-0.5"
            >
              <span
                v-for="f in commit.filesChanged.slice(0, 8)"
                :key="f"
                class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400"
              >
                {{ f }}
              </span>
              <span
                v-if="commit.filesChanged.length > 8"
                class="px-1.5 py-0.5 rounded bg-slate-900 text-[10px] text-slate-500"
              >
                +{{ commit.filesChanged.length - 8 }} más
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
