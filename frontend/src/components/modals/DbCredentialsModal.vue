<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  apiFetch,
  copyText,
  hasPerm,
  openErdModal,
  panelStore,
  showToast,
} from '../../composables/usePanelStore';

const revealedSecrets = reactive<Record<number, boolean>>({});
const availableDatabases = ref<string[]>([]);
const selectedDatabase = ref<string>('');
const loadingDatabases = ref<boolean>(false);

const project = computed(() =>
  panelStore.projects.find((p) => p.name === panelStore.modals.db.projectName)
);

const db = computed(() => project.value?.database);

const activeDatabaseName = computed(
  () => selectedDatabase.value || db.value?.database || ''
);

async function fetchContainerDatabases(): Promise<void> {
  const projName = panelStore.modals.db.projectName;
  const d = db.value;
  if (!projName || !d || !d.hasDatabase) return;
  loadingDatabases.value = true;
  try {
    const res = await apiFetch<{
      defaultDatabase: string;
      availableDatabases: string[];
    }>(`/api/projects/${encodeURIComponent(projName)}/db-databases`);
    const list =
      Array.isArray(res.availableDatabases) && res.availableDatabases.length > 0
        ? res.availableDatabases
        : [d.database];
    availableDatabases.value = list;
    if (!selectedDatabase.value || !list.includes(selectedDatabase.value)) {
      selectedDatabase.value = res.defaultDatabase || d.database;
    }
  } catch {
    availableDatabases.value = d.database ? [d.database] : [];
    selectedDatabase.value = d.database || '';
  } finally {
    loadingDatabases.value = false;
  }
}

watch(
  () => panelStore.modals.db.open,
  (isOpen) => {
    if (isOpen) {
      Object.keys(revealedSecrets).forEach((k) => delete revealedSecrets[Number(k)]);
      selectedDatabase.value = db.value?.database || '';
      availableDatabases.value = db.value?.database ? [db.value.database] : [];
      fetchContainerDatabases();
    }
  }
);

const activeConnectionUrl = computed(() => {
  const d = db.value;
  if (!d || !d.hasDatabase) return '';
  const targetDb = activeDatabaseName.value || d.database;
  const isPg = d.engine.toLowerCase().includes('postgres');
  const protocol = isPg ? 'postgresql' : 'mysql';
  return `${protocol}://${encodeURIComponent(d.username)}:${encodeURIComponent(
    d.password
  )}@${d.host}:${d.port}/${targetDb}`;
});

const activeCliCommand = computed(() => {
  const d = db.value;
  if (!d || !d.hasDatabase) return '';
  const targetDb = activeDatabaseName.value || d.database;
  const isPg = d.engine.toLowerCase().includes('postgres');
  return isPg
    ? `PGPASSWORD='${d.password}' psql -h ${d.host} -p ${d.port} -U ${d.username} -d ${targetDb}`
    : `mysql -h ${d.host} -P ${d.port} -u ${d.username} -p'${d.password}' ${targetDb}`;
});

const dbFields = computed(() => {
  const d = db.value;
  if (!d || !d.hasDatabase) return [];
  const targetDb = activeDatabaseName.value || d.database;
  return [
    {
      label: 'Host / IP Pública (DBeaver, TablePlus, Navicat)',
      value: d.host,
      copyVal: d.host,
      secret: false,
    },
    {
      label: 'Puerto Externo (Host -> Contenedor)',
      value: `${d.port} (interno: ${d.internalPort})`,
      copyVal: d.port,
      secret: false,
    },
    {
      label: 'Nombre de la Base de Datos Seleccionada (Database)',
      value: targetDb,
      copyVal: targetDb,
      secret: false,
    },
    {
      label: 'Usuario (Username)',
      value: d.username,
      copyVal: d.username,
      secret: false,
    },
    {
      label: 'Contraseña (Password)',
      value: d.password,
      copyVal: d.password,
      secret: true,
    },
    {
      label: `Contraseña Root (${d.rootUsername})`,
      value: d.rootPassword,
      copyVal: d.rootPassword,
      secret: true,
    },
    {
      label: 'Host Interno Docker (Entre contenedores)',
      value: d.internalHost,
      copyVal: d.internalHost,
      secret: false,
    },
  ];
});

function close(): void {
  panelStore.modals.db.open = false;
}

function switchToErd(): void {
  const projName = panelStore.modals.db.projectName;
  const containerName = db.value?.containerName || '';
  const targetDb = activeDatabaseName.value;
  panelStore.modals.db.open = false;
  if (projName) {
    openErdModal(projName, containerName, targetDb);
  }
}

async function downloadSqlBackup(): Promise<void> {
  const projName = panelStore.modals.db.projectName;
  const targetDb = activeDatabaseName.value;
  if (!projName) return;
  showToast(`Generando backup SQL de ${targetDb || projName}...`);
  try {
    const query = targetDb ? `?db=${encodeURIComponent(targetDb)}` : '';
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projName)}/db-dump${query}`,
      {
        headers: { Authorization: `Bearer ${panelStore.authToken}` },
      }
    );
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error generando backup');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projName}_${targetDb || 'db'}_backup.sql`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast(`Backup SQL de "${targetDb}" descargado exitosamente`);
  } catch (e: any) {
    showToast(`Error: ${e.message}`, true);
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.db.open && project"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center text-lg"
          >
            <i class="fa-solid fa-database"></i>
          </div>
          <div>
            <h3 class="text-base font-bold text-white">Credenciales de Base de Datos</h3>
            <p class="text-xs text-slate-400">
              Proyecto: {{ project.name }} ({{ db?.engine || 'N/A' }})
            </p>
          </div>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div v-if="!db || !db.hasDatabase" class="space-y-3 text-xs">
        <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 text-slate-400">
          Este proyecto no tiene un contenedor o configuración de Base de Datos detectada en su
          <code>.env</code> o <code>docker-compose.yml</code>.
        </div>
      </div>

      <div v-else class="space-y-2.5 text-xs">
        <!-- Selector Multi-Base de Datos (Control Plane + Demo + Bases de Clientes) -->
        <div
          class="bg-indigo-950/30 border border-indigo-500/30 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2"
        >
          <div class="flex-1 min-w-0">
            <label
              class="block text-[10px] uppercase tracking-wider font-bold text-indigo-300 mb-1"
            >
              <i class="fa-solid fa-layer-group mr-1"></i>Base de Datos Activa en Contenedor ({{
                availableDatabases.length
              }}
              detectadas)
            </label>
            <select
              v-model="selectedDatabase"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
            >
              <option
                v-for="dbItem in availableDatabases"
                :key="dbItem"
                :value="dbItem"
              >
                {{ dbItem }}
              </option>
            </select>
          </div>
          <button
            @click="fetchContainerDatabases"
            class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 shrink-0 mt-4"
            title="Refrescar lista de bases de datos creadas en el contenedor"
          >
            <i
              class="fa-solid fa-rotate"
              :class="{ 'fa-spin': loadingDatabases }"
            ></i>
          </button>
        </div>

        <div
          v-for="(f, idx) in dbFields"
          :key="idx"
          class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5"
        >
          <div class="min-w-0 pr-2">
            <div class="text-[10px] uppercase tracking-wider text-slate-400">{{ f.label }}</div>
            <div class="font-mono text-sm text-white truncate">
              {{ f.secret && !revealedSecrets[idx] ? '••••••••••••' : f.value }}
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="f.secret"
              @click="revealedSecrets[idx] = !revealedSecrets[idx]"
              class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              title="Mostrar/Ocultar"
            >
              <i class="fa-regular fa-eye"></i>
            </button>
            <button
              @click="copyText(f.copyVal, `${f.label} copiado`)"
              class="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-semibold"
            >
              <i class="fa-regular fa-copy mr-1"></i>Copiar
            </button>
          </div>
        </div>

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">
              URL de Conexión Directa ({{ activeDatabaseName }})
            </span>
            <button
              @click="copyText(activeConnectionUrl, 'URL de conexión copiada')"
              class="text-indigo-400 hover:underline"
            >
              Copiar URL
            </button>
          </div>
          <code class="block text-[11px] text-emerald-400 font-mono break-all">
            {{ activeConnectionUrl }}
          </code>
        </div>

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">
              Comando Terminal ({{ activeDatabaseName }})
            </span>
            <button
              @click="copyText(activeCliCommand, 'Comando copiado')"
              class="text-indigo-400 hover:underline"
            >
              Copiar Comando
            </button>
          </div>
          <code class="block text-[11px] text-amber-300 font-mono break-all">
            {{ activeCliCommand }}
          </code>
        </div>
      </div>

      <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="db?.hasDatabase && hasPerm('project_db', 'deploy')"
            @click="downloadSqlBackup"
            class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-download"></i> Backup .SQL ({{ activeDatabaseName }})
          </button>
          <button
            v-if="db?.hasDatabase"
            @click="switchToErd"
            class="px-3.5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-fuchsia-600/20"
          >
            <i class="fa-solid fa-diagram-project"></i> Ver Modelo DER / ERD ({{ activeDatabaseName }})
          </button>
        </div>
        <button
          @click="close"
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
        >
          Cerrar
        </button>
      </div>
    </div>
  </div>
</template>
