<script setup lang="ts">
import { ref } from 'vue';
import {
  apiFetch,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import {
  generateCryptoHex,
  injectDbPasswordInEnvText,
  injectSecretInEnvText,
} from '../../services/api';

const repoUrl = ref('');
const projectName = ref('');
const branch = ref('');
const envContent = ref('');
const autoStart = ref(true);

function close(): void {
  panelStore.modals.clone.open = false;
}

function onRepoUrlInput(): void {
  if (projectName.value.trim()) return;
  const match = /\/([^\/]+?)(?:\.git)?\/?$/.exec(repoUrl.value.trim());
  if (match && match[1]) {
    projectName.value = match[1].replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

function generateSecret(keyName: string): void {
  envContent.value = injectSecretInEnvText(envContent.value, keyName, 32);
  showToast(`🔑 ${keyName} criptográfico generado y aplicado`);
}

function generateDbPassword(): void {
  const res = injectDbPasswordInEnvText(envContent.value);
  envContent.value = res.text;
  showToast(`🎲 ${res.keyUpdated} actualizado con contraseña segura`);
}

async function autoFetchRepoEnvExample(): Promise<void> {
  const url = repoUrl.value.trim();
  const targetBranch = branch.value.trim() || 'main';
  if (!url) {
    showToast('Primero pega la URL del repositorio Git', true);
    return;
  }

  const ghMatch = /github\.com[:/]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/i.exec(url);
  if (!ghMatch) {
    generateSecret('JWT_SECRET');
    return;
  }

  const [, owner, repo] = ghMatch;
  const branchesToTry = [targetBranch, 'main', 'master', 'develop'];
  for (const b of branchesToTry) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/.env.example`;
      const resp = await fetch(rawUrl);
      if (resp.ok) {
        let text = (await resp.text()).trim();
        text = text.replace(/^NODE_ENV\s*=\s*development\s*$/m, 'NODE_ENV=production');
        const jwtSecret = generateCryptoHex(32);
        if (/^JWT_SECRET\s*=.*$/m.test(text)) {
          text = text.replace(/^JWT_SECRET\s*=.*$/m, `JWT_SECRET=${jwtSecret}`);
        } else {
          text += `\nJWT_SECRET=${jwtSecret}`;
        }
        envContent.value = text;
        showToast('✨ .env.example cargado del repositorio + JWT_SECRET generado automáticamente');
        return;
      }
    } catch {
      // Intentar siguiente rama
    }
  }

  generateSecret('JWT_SECRET');
}

async function handleSubmit(): Promise<void> {
  const payload = {
    name: projectName.value.trim(),
    repoUrl: repoUrl.value.trim(),
    branch: branch.value.trim(),
    envContent: envContent.value,
    autoStart: autoStart.value,
  };
  close();

  panelStore.modals.console.title = `Clonando y Desplegando ${payload.name}`;
  panelStore.modals.console.showContainerSelect = false;
  panelStore.modals.console.output = `⏳ Clonando ${payload.repoUrl}...\n`;
  panelStore.modals.console.open = true;

  try {
    const res = await apiFetch<{ output: string }>('/api/projects/clone', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    panelStore.modals.console.output = res.output || 'Proceso finalizado.';
    repoUrl.value = '';
    projectName.value = '';
    branch.value = '';
    envContent.value = '';
    await refreshAll();
  } catch (err: any) {
    panelStore.modals.console.output = `❌ Error: ${err.message}`;
  }
}
</script>

<template>
  <div
    v-if="panelStore.modals.clone.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <h3 class="text-sm font-bold text-white">
          <i class="fa-brands fa-git-alt text-indigo-400 mr-2"></i>Clonar y Desplegar Nuevo Proyecto
        </h3>
        <button @click="close" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">URL del Repositorio Git (HTTPS o SSH)</label>
          <input
            v-model="repoUrl"
            @input="onRepoUrlInput"
            type="text"
            placeholder="https://github.com/usuario/proyecto.git"
            required
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div class="sm:col-span-2">
            <label class="block text-slate-400 mb-1">Nombre de la Carpeta del Proyecto</label>
            <input
              v-model="projectName"
              type="text"
              placeholder="ej. Servidor_Zapatoqueando"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
            />
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Rama (Opcional)</label>
            <input
              v-model="branch"
              type="text"
              placeholder="main"
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white"
            />
          </div>
        </div>

        <div>
          <div class="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
            <label class="text-slate-400">Variables .env iniciales (Opcional)</label>
            <div class="flex flex-wrap items-center gap-1">
              <button
                type="button"
                @click="autoFetchRepoEnvExample"
                class="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Carga el .env.example del repositorio de GitHub y genera JWT_SECRET automáticamente"
              >
                <i class="fa-solid fa-wand-magic-sparkles"></i> Cargar .env.example
              </button>
              <button
                type="button"
                @click="generateSecret('JWT_SECRET')"
                class="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Genera un JWT_SECRET criptográfico de 256 bits"
              >
                <i class="fa-solid fa-key"></i> + JWT_SECRET
              </button>
              <button
                type="button"
                @click="generateDbPassword"
                class="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1"
                title="Genera una contraseña aleatoria segura para la base de datos"
              >
                <i class="fa-solid fa-dice"></i> + Password DB
              </button>
            </div>
          </div>
          <textarea
            v-model="envContent"
            rows="6"
            placeholder="Si lo dejas vacío y el repositorio tiene .env.example, ALpanel lo copiará y generará JWT_SECRET automáticamente."
            class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-emerald-300"
          ></textarea>
          <p class="text-[10px] text-slate-500 mt-1">
            <i class="fa-solid fa-circle-info text-indigo-400 mr-1"></i>Si no escribes un
            <code class="text-slate-300">JWT_SECRET</code>, ALpanel generará uno criptográfico de
            256 bits automáticamente al clonar.
          </p>
        </div>

        <label class="flex items-center gap-2 text-slate-300 pt-1">
          <input
            v-model="autoStart"
            type="checkbox"
            class="rounded bg-slate-950 border-slate-700 text-indigo-600"
          />
          Ejecutar <code class="text-indigo-400">docker compose up -d --build</code> automáticamente
          al terminar
        </label>

        <div class="pt-3 flex justify-end gap-2">
          <button
            type="button"
            @click="close"
            class="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
          >
            <i class="fa-solid fa-rocket mr-1"></i> Clonar y Desplegar
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
