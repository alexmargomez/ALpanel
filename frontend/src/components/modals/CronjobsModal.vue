<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { apiFetch, panelStore, showToast } from '../../composables/usePanelStore';
import type { ProjectCronjob } from '../../types/panel';

const loading = ref(false);
const saving = ref(false);
const runningId = ref('');
const cronjobs = ref<ProjectCronjob[]>([]);
const selectedOutputJob = ref<ProjectCronjob | null>(null);

const form = reactive({
  id: '',
  name: '',
  schedule: '*/5 * * * *',
  targetType: 'container' as 'container' | 'host',
  containerName: '',
  command: '',
  enabled: true,
});

const project = computed(() =>
  panelStore.projects.find((p) => p.name === panelStore.modals.cronjobs.projectName)
);

const containers = computed(() => project.value?.containers || []);

const schedulePresets = [
  { label: 'Cada minuto', expr: '* * * * *' },
  { label: 'Cada 5 min', expr: '*/5 * * * *' },
  { label: 'Cada 15 min', expr: '*/15 * * * *' },
  { label: 'Cada hora', expr: '0 * * * *' },
  { label: 'Diario 02:00 AM', expr: '0 2 * * *' },
  { label: 'Domingos 03:00 AM', expr: '0 3 * * 0' },
];

const commandPresets = [
  {
    label: 'Laravel Scheduler',
    name: 'Laravel Schedule Run',
    schedule: '* * * * *',
    command: 'php artisan schedule:run',
  },
  {
    label: 'Django Clear Sessions',
    name: 'Limpiar Sesiones Expiradas Django',
    schedule: '0 3 * * *',
    command: 'python manage.py clearsessions',
  },
  {
    label: 'Symfony 1.4 Clear Cache',
    name: 'Limpiar Caché Symfony Legacy',
    schedule: '0 4 * * *',
    command: 'php symfony cc',
  },
  {
    label: 'Node / NPM Script',
    name: 'Tarea Programada Node.js',
    schedule: '*/15 * * * *',
    command: 'npm run cron',
  },
];

function resetForm(): void {
  form.id = '';
  form.name = '';
  form.schedule = '*/5 * * * *';
  form.targetType = containers.value.length > 0 ? 'container' : 'host';
  const backendCont =
    containers.value.find((c) => c.role === 'backend') || containers.value[0];
  form.containerName = backendCont?.name || '';
  form.command = '';
  form.enabled = true;
}

async function loadCronjobs(): Promise<void> {
  const projName = panelStore.modals.cronjobs.projectName;
  if (!projName) return;
  loading.value = true;
  try {
    const res = await apiFetch<{ cronjobs: ProjectCronjob[] }>(
      `/api/projects/${encodeURIComponent(projName)}/cronjobs`
    );
    cronjobs.value = res.cronjobs || [];
  } catch (err: any) {
    showToast(`Error cargando cronjobs: ${err.message}`, true);
  } finally {
    loading.value = false;
  }
}

watch(
  () => panelStore.modals.cronjobs.open,
  (isOpen) => {
    if (isOpen) {
      selectedOutputJob.value = null;
      resetForm();
      loadCronjobs();
    }
  }
);

function applyCommandPreset(preset: (typeof commandPresets)[number]): void {
  form.name = preset.name;
  form.schedule = preset.schedule;
  form.command = preset.command;
}

function editCronjob(job: ProjectCronjob): void {
  form.id = job.id;
  form.name = job.name;
  form.schedule = job.schedule;
  form.targetType = job.targetType;
  form.containerName = job.containerName;
  form.command = job.command;
  form.enabled = job.enabled;
}

async function handleSave(): Promise<void> {
  const projName = panelStore.modals.cronjobs.projectName;
  if (!projName) return;
  saving.value = true;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(projName)}/cronjobs`, {
      method: 'POST',
      body: JSON.stringify({
        id: form.id || undefined,
        name: form.name,
        schedule: form.schedule,
        targetType: form.targetType,
        containerName: form.containerName,
        command: form.command,
        enabled: form.enabled,
      }),
    });
    showToast(form.id ? 'Cronjob actualizado' : 'Cronjob creado exitosamente');
    resetForm();
    await loadCronjobs();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(job: ProjectCronjob): Promise<void> {
  const projName = panelStore.modals.cronjobs.projectName;
  if (!projName) return;
  try {
    await apiFetch(`/api/projects/${encodeURIComponent(projName)}/cronjobs`, {
      method: 'POST',
      body: JSON.stringify({
        ...job,
        enabled: !job.enabled,
      }),
    });
    await loadCronjobs();
    showToast(
      !job.enabled ? `Cronjob "${job.name}" activado` : `Cronjob "${job.name}" pausado`
    );
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}

async function runNow(job: ProjectCronjob): Promise<void> {
  const projName = panelStore.modals.cronjobs.projectName;
  if (!projName) return;
  runningId.value = job.id;
  showToast(`Ejecutando "${job.name}" en ${projName}...`);
  try {
    const res = await apiFetch<{ cronjob: ProjectCronjob }>(
      `/api/projects/${encodeURIComponent(projName)}/cronjobs/${encodeURIComponent(job.id)}/run`,
      { method: 'POST' }
    );
    selectedOutputJob.value = res.cronjob;
    await loadCronjobs();
    showToast(
      res.cronjob.lastStatus === 'ok'
        ? `Cronjob "${job.name}" ejecutado con éxito`
        : `El cronjob "${job.name}" finalizó con errores`,
      res.cronjob.lastStatus !== 'ok'
    );
  } catch (err: any) {
    showToast(`Error ejecutando cronjob: ${err.message}`, true);
  } finally {
    runningId.value = '';
  }
}

async function removeCronjob(job: ProjectCronjob): Promise<void> {
  const projName = panelStore.modals.cronjobs.projectName;
  if (!projName) return;
  try {
    await apiFetch(
      `/api/projects/${encodeURIComponent(projName)}/cronjobs/${encodeURIComponent(job.id)}`,
      { method: 'DELETE' }
    );
    if (selectedOutputJob.value?.id === job.id) {
      selectedOutputJob.value = null;
    }
    await loadCronjobs();
    showToast(`Cronjob "${job.name}" eliminado`);
  } catch (err: any) {
    showToast(`Error eliminando cronjob: ${err.message}`, true);
  }
}

function close(): void {
  panelStore.modals.cronjobs.open = false;
}
</script>

<template>
  <div
    v-if="panelStore.modals.cronjobs.open"
    class="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center text-lg"
          >
            <i class="fa-solid fa-clock"></i>
          </div>
          <div>
            <h3 class="text-base font-bold text-white">
              Cronjobs y Tareas Programadas — {{ panelStore.modals.cronjobs.projectName }}
            </h3>
            <p class="text-xs text-slate-400">
              Programa comandos automáticos o ejecútalos en caliente dentro del contenedor del proyecto
            </p>
          </div>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white px-2 py-1">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <!-- Body -->
      <div class="p-6 overflow-y-auto space-y-6 scrollbar-thin">
        <!-- Formulario Crear / Editar Cronjob -->
        <form
          @submit.prevent="handleSave"
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3.5"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-teal-400">
              <i class="fa-solid fa-plus-circle mr-1"></i>
              {{ form.id ? 'Editar Cronjob' : 'Nuevo Cronjob del Proyecto' }}
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-slate-400 mr-1">Plantillas rápidas:</span>
              <button
                v-for="preset in commandPresets"
                :key="preset.label"
                type="button"
                @click="applyCommandPreset(preset)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] font-medium transition"
              >
                {{ preset.label }}
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-[11px] font-semibold text-slate-400 mb-1">
                Nombre de la Tarea
              </label>
              <input
                v-model="form.name"
                type="text"
                required
                placeholder="Ej. Laravel Scheduler / Backup Diario"
                class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label class="block text-[11px] font-semibold text-slate-400 mb-1">
                Expresión Cron (5 campos)
              </label>
              <input
                v-model="form.schedule"
                type="text"
                required
                placeholder="*/5 * * * *"
                class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none focus:border-teal-500"
              />
              <div class="flex flex-wrap gap-1 mt-1.5">
                <button
                  v-for="sp in schedulePresets"
                  :key="sp.expr"
                  type="button"
                  @click="form.schedule = sp.expr"
                  class="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-[10px] text-slate-400 border border-slate-800"
                >
                  {{ sp.label }}
                </button>
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-semibold text-slate-400 mb-1">
                Destino de Ejecución
              </label>
              <div class="flex gap-2">
                <select
                  v-model="form.targetType"
                  class="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="container">Contenedor Docker</option>
                  <option value="host">Carpeta Host</option>
                </select>
                <select
                  v-if="form.targetType === 'container'"
                  v-model="form.containerName"
                  class="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-teal-500"
                >
                  <option v-for="c in containers" :key="c.name" :value="c.name">
                    {{ c.name }} ({{ c.role }})
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div class="flex-1">
              <label class="block text-[11px] font-semibold text-slate-400 mb-1">
                Comando a Ejecutar
              </label>
              <input
                v-model="form.command"
                type="text"
                required
                placeholder="Ej. php artisan schedule:run"
                class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div class="flex items-center gap-2">
              <button
                v-if="form.id"
                type="button"
                @click="resetForm"
                class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                :disabled="saving"
                class="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-teal-600/20"
              >
                <i class="fa-solid fa-floppy-disk"></i>
                {{ form.id ? 'Actualizar Cronjob' : 'Guardar Cronjob' }}
              </button>
            </div>
          </div>
        </form>

        <!-- Lista de Cronjobs del Proyecto -->
        <div class="space-y-2.5">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400">
              Tareas Configuradas ({{ cronjobs.length }})
            </span>
            <button
              @click="loadCronjobs"
              class="text-xs text-indigo-400 hover:underline flex items-center gap-1"
            >
              <i class="fa-solid fa-rotate"></i> Refrescar
            </button>
          </div>

          <div
            v-if="loading"
            class="p-6 text-center text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl"
          >
            Cargando tareas programadas...
          </div>

          <div
            v-else-if="cronjobs.length === 0"
            class="p-6 text-center text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-xl"
          >
            No hay cronjobs configurados para este proyecto todavía. Usa el formulario superior para crear el primero.
          </div>

          <div
            v-for="job in cronjobs"
            :key="job.id"
            class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3"
          >
            <div class="space-y-1 min-w-[240px] flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-sm text-white">{{ job.name }}</span>
                <code
                  class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300 font-mono text-[11px]"
                >
                  {{ job.schedule }}
                </code>
                <span
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  :class="
                    job.enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400'
                  "
                >
                  {{ job.enabled ? 'ACTIVO' : 'PAUSADO' }}
                </span>
                <span
                  v-if="job.lastStatus === 'ok'"
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                >
                  ÚLTIMA: OK ({{ job.lastDurationMs }}ms)
                </span>
                <span
                  v-else-if="job.lastStatus === 'error'"
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30"
                >
                  ÚLTIMA: ERROR
                </span>
              </div>

              <div class="text-xs font-mono text-emerald-400 break-all">
                $ {{ job.command }}
              </div>

              <div class="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                <span>
                  <i class="fa-solid fa-cube mr-1 text-indigo-400"></i>
                  Destino:
                  <strong class="text-slate-200">
                    {{
                      job.targetType === 'container'
                        ? `Contenedor (${job.containerName || 'auto'})`
                        : 'Carpeta Host'
                    }}
                  </strong>
                </span>
                <span v-if="job.lastRunAt">
                  • Última ejecución: {{ new Date(job.lastRunAt).toLocaleString() }}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                @click="runNow(job)"
                :disabled="runningId === job.id"
                class="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                title="Ejecutar este cronjob inmediatamente"
              >
                <i
                  class="fa-solid"
                  :class="runningId === job.id ? 'fa-spinner fa-spin' : 'fa-play'"
                ></i>
                Ejecutar Ahora
              </button>
              <button
                v-if="job.lastOutput"
                @click="selectedOutputJob = job"
                class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs"
                title="Ver salida de la última ejecución"
              >
                <i class="fa-solid fa-terminal"></i> Salida
              </button>
              <button
                @click="toggleEnabled(job)"
                class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs"
                :title="job.enabled ? 'Pausar programación' : 'Activar programación'"
              >
                <i class="fa-solid" :class="job.enabled ? 'fa-pause' : 'fa-check'"></i>
              </button>
              <button
                @click="editCronjob(job)"
                class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs"
                title="Editar cronjob"
              >
                <i class="fa-solid fa-pen"></i>
              </button>
              <button
                @click="removeCronjob(job)"
                class="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 text-xs"
                title="Eliminar cronjob"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Visor de Salida del Cronjob -->
        <div
          v-if="selectedOutputJob"
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-teal-400">
              <i class="fa-solid fa-terminal mr-1.5"></i>
              Salida de Consola — {{ selectedOutputJob.name }}
            </span>
            <button
              @click="selectedOutputJob = null"
              class="text-xs text-slate-400 hover:text-white"
            >
              Cerrar salida
            </button>
          </div>
          <pre
            class="text-xs font-mono text-slate-200 bg-slate-900 border border-slate-800 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap"
          >{{ selectedOutputJob.lastOutput }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
