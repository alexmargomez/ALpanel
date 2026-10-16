<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { copyText, hasPerm, panelStore, showToast } from '../../composables/usePanelStore';

const revealedSecrets = reactive<Record<number, boolean>>({});

const project = computed(() =>
  panelStore.projects.find((p) => p.name === panelStore.modals.db.projectName)
);

const db = computed(() => project.value?.database);

watch(
  () => panelStore.modals.db.open,
  (isOpen) => {
    if (isOpen) {
      Object.keys(revealedSecrets).forEach((k) => delete revealedSecrets[Number(k)]);
    }
  }
);

const dbFields = computed(() => {
  const d = db.value;
  if (!d || !d.hasDatabase) return [];
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
      label: 'Nombre de la Base de Datos (Database)',
      value: d.database,
      copyVal: d.database,
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

async function downloadSqlBackup(): Promise<void> {
  const projName = panelStore.modals.db.projectName;
  if (!projName) return;
  showToast(`Generando backup SQL de ${projName}...`);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projName)}/db-dump`, {
      headers: { Authorization: `Bearer ${panelStore.authToken}` },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error generando backup');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projName}_backup.sql`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Backup SQL descargado exitosamente');
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
              URL de Conexión Directa
            </span>
            <button
              @click="copyText(db.connectionUrl, 'URL de conexión copiada')"
              class="text-indigo-400 hover:underline"
            >
              Copiar URL
            </button>
          </div>
          <code class="block text-[11px] text-emerald-400 font-mono break-all">
            {{ db.connectionUrl }}
          </code>
        </div>

        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] uppercase tracking-wider text-slate-400">Comando Terminal</span>
            <button
              @click="copyText(db.cliCommand, 'Comando copiado')"
              class="text-indigo-400 hover:underline"
            >
              Copiar Comando
            </button>
          </div>
          <code class="block text-[11px] text-amber-300 font-mono break-all">
            {{ db.cliCommand }}
          </code>
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between">
        <button
          v-if="db?.hasDatabase && hasPerm('project_db', 'deploy')"
          @click="downloadSqlBackup"
          class="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-2"
        >
          <i class="fa-solid fa-download"></i> Descargar Backup .SQL
        </button>
        <div v-else></div>
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
