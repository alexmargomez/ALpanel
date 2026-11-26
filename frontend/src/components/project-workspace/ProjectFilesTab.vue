<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  apiFetch,
  runProjectAction,
  showToast,
} from '../../composables/usePanelStore';
import { formatBytes } from '../../services/api';
import type {
  ProjectFileReadResult,
  ProjectFileTreeEntry,
  ProjectInfo,
} from '../../types/panel';

const props = defineProps<{
  project: ProjectInfo;
}>();

const currentDir = ref('');
const entries = ref<ProjectFileTreeEntry[]>([]);
const loadingTree = ref(false);

const selectedFile = ref<ProjectFileReadResult | null>(null);
const editorContent = ref('');
const loadingFile = ref(false);
const savingFile = ref(false);
const yamlWarning = ref('');

const showNewEntry = ref(false);
const newEntryType = ref<'file' | 'directory'>('file');
const newEntryName = ref('');

const breadcrumbs = computed(() => {
  if (!currentDir.value) return [];
  const parts = currentDir.value.split('/').filter(Boolean);
  return parts.map((label, idx) => ({
    label,
    path: parts.slice(0, idx + 1).join('/'),
  }));
});

const isDirty = computed(
  () =>
    selectedFile.value !== null &&
    !selectedFile.value.isBinary &&
    editorContent.value !== selectedFile.value.content
);

async function loadDirectory(dirPath = ''): Promise<void> {
  loadingTree.value = true;
  try {
    const res = await apiFetch<{
      currentPath: string;
      entries: ProjectFileTreeEntry[];
    }>(
      `/api/projects/${encodeURIComponent(props.project.name)}/files?path=${encodeURIComponent(dirPath)}`
    );
    currentDir.value = res.currentPath || '';
    entries.value = res.entries || [];
  } catch (err: any) {
    showToast(`Error explorando archivos: ${err.message}`, true);
  } finally {
    loadingTree.value = false;
  }
}

async function openEntry(entry: ProjectFileTreeEntry): Promise<void> {
  if (entry.kind === 'directory') {
    await loadDirectory(entry.relativePath);
    return;
  }
  loadingFile.value = true;
  yamlWarning.value = '';
  try {
    const res = await apiFetch<ProjectFileReadResult>(
      `/api/projects/${encodeURIComponent(props.project.name)}/files/content?path=${encodeURIComponent(entry.relativePath)}`
    );
    selectedFile.value = res;
    editorContent.value = res.content || '';
  } catch (err: any) {
    showToast(`Error abriendo archivo: ${err.message}`, true);
  } finally {
    loadingFile.value = false;
  }
}

async function saveFile(triggerRebuild = false): Promise<void> {
  if (!selectedFile.value || selectedFile.value.isBinary) return;
  savingFile.value = true;
  yamlWarning.value = '';
  try {
    const res = await apiFetch<{
      success: boolean;
      hasBackup: boolean;
      validationWarning?: string;
    }>(
      `/api/projects/${encodeURIComponent(props.project.name)}/files/content`,
      {
        method: 'PUT',
        body: JSON.stringify({
          path: selectedFile.value.relativePath,
          content: editorContent.value,
        }),
      }
    );
    selectedFile.value.content = editorContent.value;
    selectedFile.value.hasBackup = Boolean(res.hasBackup);
    yamlWarning.value = res.validationWarning || '';
    showToast(
      res.validationWarning
        ? 'Archivo guardado con advertencia de validación.'
        : `Archivo ${selectedFile.value.relativePath} guardado (respaldo automático creado).`
    );
    if (triggerRebuild) {
      runProjectAction(props.project.name, 'rebuild');
    }
  } catch (err: any) {
    showToast(`Error guardando archivo: ${err.message}`, true);
  } finally {
    savingFile.value = false;
  }
}

async function restoreBackup(): Promise<void> {
  if (!selectedFile.value || !selectedFile.value.hasBackup) return;
  try {
    await apiFetch(
      `/api/projects/${encodeURIComponent(props.project.name)}/files/restore`,
      {
        method: 'POST',
        body: JSON.stringify({
          path: selectedFile.value.relativePath,
        }),
      }
    );
    showToast('Respaldo anterior restaurado correctamente.');
    await openEntry({
      name: selectedFile.value.relativePath.split('/').pop() || selectedFile.value.relativePath,
      relativePath: selectedFile.value.relativePath,
      kind: 'file',
      sizeBytes: 0,
      updatedAt: '',
    });
  } catch (err: any) {
    showToast(`Error restaurando respaldo: ${err.message}`, true);
  }
}

async function createNewEntry(): Promise<void> {
  const cleanName = newEntryName.value.trim().replace(/^\/+/, '');
  if (!cleanName) return;
  const fullPath = currentDir.value
    ? `${currentDir.value}/${cleanName}`
    : cleanName;
  try {
    await apiFetch(
      `/api/projects/${encodeURIComponent(props.project.name)}/files/create`,
      {
        method: 'POST',
        body: JSON.stringify({
          path: fullPath,
          kind: newEntryType.value,
        }),
      }
    );
    newEntryName.value = '';
    showNewEntry.value = false;
    await loadDirectory(currentDir.value);
    showToast(
      `${newEntryType.value === 'directory' ? 'Carpeta' : 'Archivo'} "${cleanName}" creado.`
    );
  } catch (err: any) {
    showToast(`Error creando elemento: ${err.message}`, true);
  }
}

async function deleteEntry(entry: ProjectFileTreeEntry): Promise<void> {
  if (!confirm(`¿Eliminar "${entry.relativePath}" del proyecto ${props.project.name}?`)) {
    return;
  }
  try {
    await apiFetch(
      `/api/projects/${encodeURIComponent(props.project.name)}/files?path=${encodeURIComponent(entry.relativePath)}`,
      { method: 'DELETE' }
    );
    if (selectedFile.value?.relativePath === entry.relativePath) {
      selectedFile.value = null;
      editorContent.value = '';
    }
    await loadDirectory(currentDir.value);
    showToast(`"${entry.name}" eliminado.`);
  } catch (err: any) {
    showToast(`Error eliminando: ${err.message}`, true);
  }
}

function goUp(): void {
  if (!currentDir.value) return;
  const parts = currentDir.value.split('/').filter(Boolean);
  parts.pop();
  loadDirectory(parts.join('/'));
}

watch(
  () => props.project.name,
  () => {
    selectedFile.value = null;
    editorContent.value = '';
    loadDirectory('');
  }
);

onMounted(() => {
  loadDirectory('');
});
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
    <!-- Panel Izquierdo: Árbol de Archivos -->
    <div
      class="lg:col-span-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col overflow-hidden min-h-[460px] max-h-[680px]"
    >
      <div
        class="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/60"
      >
        <div class="flex items-center gap-1.5 text-xs font-semibold text-white truncate">
          <i class="fa-solid fa-folder-tree text-amber-400"></i>
          <span>Explorador</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            @click="showNewEntry = !showNewEntry"
            class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold"
            title="Nuevo archivo o carpeta"
          >
            <i class="fa-solid fa-plus mr-1"></i>Nuevo
          </button>
          <button
            @click="loadDirectory(currentDir)"
            class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
            title="Refrescar"
          >
            <i class="fa-solid fa-rotate text-[10px]"></i>
          </button>
        </div>
      </div>

      <!-- Breadcrumb -->
      <div
        class="px-3 py-2 border-b border-slate-800/80 flex items-center gap-1 flex-wrap text-[11px] font-mono bg-slate-950"
      >
        <button
          @click="loadDirectory('')"
          class="text-indigo-400 hover:underline font-semibold"
        >
          /
        </button>
        <template v-for="b in breadcrumbs" :key="b.path">
          <span class="text-slate-600">/</span>
          <button
            @click="loadDirectory(b.path)"
            class="text-slate-300 hover:text-indigo-400 hover:underline truncate max-w-[120px]"
          >
            {{ b.label }}
          </button>
        </template>
      </div>

      <!-- Formulario Nuevo Archivo/Carpeta -->
      <div
        v-if="showNewEntry"
        class="p-2.5 border-b border-slate-800 bg-slate-900/80 space-y-2 text-xs"
      >
        <div class="flex gap-1.5">
          <select
            v-model="newEntryType"
            class="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white"
          >
            <option value="file">Archivo</option>
            <option value="directory">Carpeta</option>
          </select>
          <input
            v-model="newEntryName"
            @keydown.enter.prevent="createNewEntry"
            type="text"
            placeholder="nombre.go o carpeta"
            class="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white font-mono"
          />
          <button
            @click="createNewEntry"
            class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold"
          >
            Crear
          </button>
        </div>
      </div>

      <!-- Lista de Entradas -->
      <div class="flex-1 overflow-y-auto divide-y divide-slate-800/50 text-xs">
        <button
          v-if="currentDir"
          @click="goUp"
          class="w-full px-3 py-2 text-left hover:bg-slate-900/80 flex items-center gap-2 text-slate-400 font-mono"
        >
          <i class="fa-solid fa-level-up-alt text-[11px]"></i>
          <span>..</span>
        </button>

        <div v-if="loadingTree" class="p-4 text-center text-slate-500">
          <i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Cargando directorio...
        </div>

        <div
          v-else-if="entries.length === 0"
          class="p-4 text-center text-slate-500 text-[11px]"
        >
          Carpeta vacía.
        </div>

        <div
          v-else
          v-for="entry in entries"
          :key="entry.relativePath"
          @click="openEntry(entry)"
          class="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-900/90 transition group"
          :class="
            selectedFile?.relativePath === entry.relativePath
              ? 'bg-indigo-500/15 text-indigo-300'
              : 'text-slate-300'
          "
        >
          <div class="flex items-center gap-2 min-w-0">
            <i
              class="fa-solid text-xs shrink-0"
              :class="
                entry.kind === 'directory'
                  ? 'fa-folder text-amber-400'
                  : 'fa-file-code text-slate-400'
              "
            ></i>
            <span class="font-mono text-[11px] truncate">{{ entry.name }}</span>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <span
              v-if="entry.kind === 'file'"
              class="text-[10px] text-slate-500 font-mono"
            >
              {{ formatBytes(entry.sizeBytes) }}
            </span>
            <button
              @click.stop="deleteEntry(entry)"
              class="opacity-0 group-hover:opacity-100 w-6 h-6 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center transition"
              title="Eliminar"
            >
              <i class="fa-solid fa-trash text-[10px]"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel Derecho: Editor de Código -->
    <div
      class="lg:col-span-8 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col overflow-hidden min-h-[460px] max-h-[680px]"
    >
      <div
        class="px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900/60"
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="fa-solid fa-code text-indigo-400 text-xs"></i>
          <span class="font-mono text-xs font-semibold text-white truncate">
            {{ selectedFile ? selectedFile.relativePath : 'Selecciona un archivo para editar' }}
          </span>
          <span
            v-if="isDirty"
            class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
          >
            SIN GUARDAR
          </span>
        </div>

        <div v-if="selectedFile && !selectedFile.isBinary" class="flex items-center gap-1.5">
          <button
            v-if="selectedFile.hasBackup"
            @click="restoreBackup"
            class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold"
            title="Restaurar versión anterior al último guardado"
          >
            <i class="fa-solid fa-clock-rotate-left mr-1"></i>Restaurar .bak
          </button>
          <button
            @click="saveFile(false)"
            :disabled="savingFile || !isDirty"
            class="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1"
          >
            <i
              class="fa-solid"
              :class="savingFile ? 'fa-spinner fa-spin' : 'fa-floppy-disk'"
            ></i>
            <span>Guardar</span>
          </button>
          <button
            @click="saveFile(true)"
            :disabled="savingFile"
            class="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1"
            title="Guardar archivo y lanzar rebuild del proyecto"
          >
            <i class="fa-solid fa-hammer"></i>
            <span>Guardar y Rebuild</span>
          </button>
        </div>
      </div>

      <div
        v-if="yamlWarning"
        class="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-[11px] font-mono"
      >
        <i class="fa-solid fa-triangle-exclamation mr-1.5"></i>
        {{ yamlWarning }}
      </div>

      <div
        v-if="loadingFile"
        class="flex-1 flex items-center justify-center text-slate-400 text-xs"
      >
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Cargando contenido...
      </div>

      <div
        v-else-if="!selectedFile"
        class="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs p-8 text-center gap-2"
      >
        <i class="fa-regular fa-file-code text-3xl text-slate-700"></i>
        <div>
          Haz clic en cualquier archivo de configuración o código (ej. <code class="text-slate-300">docker-compose.yml</code>, <code class="text-slate-300">router.go</code>, <code class="text-slate-300">.env</code>) para editarlo en vivo.
        </div>
      </div>

      <div
        v-else-if="selectedFile.isBinary"
        class="flex-1 flex items-center justify-center text-slate-400 text-xs p-6"
      >
        Archivo binario ({{ formatBytes(selectedFile.sizeBytes) }}) — no editable como texto.
      </div>

      <textarea
        v-else
        v-model="editorContent"
        spellcheck="false"
        class="flex-1 w-full bg-slate-950 p-4 font-mono text-xs text-emerald-200 leading-relaxed focus:outline-none resize-none"
      ></textarea>
    </div>
  </div>
</template>
