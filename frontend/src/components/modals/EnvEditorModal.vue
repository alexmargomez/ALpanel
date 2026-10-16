<script setup lang="ts">
import {
  apiFetch,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import {
  injectDbPasswordInEnvText,
  injectSecretInEnvText,
} from '../../services/api';

function close(): void {
  panelStore.modals.env.open = false;
}

function generateSecret(keyName: string): void {
  panelStore.modals.env.content = injectSecretInEnvText(
    panelStore.modals.env.content,
    keyName,
    32
  );
  showToast(`🔑 ${keyName} criptográfico generado y aplicado`);
}

function generateDbPassword(): void {
  const res = injectDbPasswordInEnvText(panelStore.modals.env.content);
  panelStore.modals.env.content = res.text;
  showToast(`🎲 ${res.keyUpdated} actualizado con contraseña segura`);
}

async function saveEnvFile(restart = true): Promise<void> {
  const projectName = panelStore.modals.env.projectName;
  const content = panelStore.modals.env.content;
  close();

  panelStore.modals.console.title = `Guardando .env y Reiniciando — ${projectName}`;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = '⏳ Guardando archivo .env y reiniciando contenedores...';
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{ output: string }>(
      `/api/projects/${encodeURIComponent(projectName)}/env`,
      {
        method: 'POST',
        body: JSON.stringify({ content, restart }),
      }
    );
    panelStore.modals.console.output = res.output || 'Guardado correctamente.';
    await refreshAll();
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error: ${err.message}`;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.env.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]"
    >
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <div>
          <h3 class="text-sm font-bold text-white">
            <i class="fa-solid fa-key text-amber-400 mr-2"></i>Archivo .env —
            {{ panelStore.modals.env.projectName }}
          </h3>
          <p class="text-[11px] text-slate-400">
            Se guarda con permisos seguros (0600) y reinicia los contenedores del proyecto.
          </p>
        </div>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 mb-2">
        <button
          type="button"
          @click="generateSecret('JWT_SECRET')"
          class="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-semibold flex items-center gap-1"
        >
          <i class="fa-solid fa-key"></i> Generar JWT_SECRET
        </button>
        <button
          type="button"
          @click="generateSecret('SECRET_KEY')"
          class="px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold flex items-center gap-1"
        >
          <i class="fa-solid fa-shield-halved"></i> Generar SECRET_KEY
        </button>
        <button
          type="button"
          @click="generateDbPassword"
          class="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1"
        >
          <i class="fa-solid fa-dice"></i> Generar Password DB
        </button>
      </div>

      <textarea
        v-model="panelStore.modals.env.content"
        rows="14"
        spellcheck="false"
        class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-emerald-300 focus:outline-none focus:border-indigo-500"
      ></textarea>

      <div class="mt-4 flex justify-end gap-2">
        <button
          @click="close"
          class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
        >
          Cancelar
        </button>
        <button
          @click="saveEnvFile(true)"
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
        >
          <i class="fa-solid fa-floppy-disk mr-1"></i> Guardar y Reiniciar Docker
        </button>
      </div>
    </div>
  </div>
</template>
