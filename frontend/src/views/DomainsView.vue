<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  apiFetch,
  copyText,
  hasPerm,
  loadDomains,
  panelStore,
  refreshAll,
  showToast,
} from '../composables/usePanelStore';
import { extractContainerInternalTarget } from '../services/api';
import type { ContainerStatInfo, DomainRouteItem, ProjectInfo } from '../types/panel';

const selectedProject = ref('');
const domainInput = ref('');
const frontInput = ref('');
const backInput = ref('');
const saving = ref(false);

const canCreate = computed(() => hasPerm('domains', 'create'));
const canEdit = computed(() => hasPerm('domains', 'edit'));
const canDelete = computed(() => hasPerm('domains', 'delete'));

const projectOptions = computed(() => {
  return panelStore.projects.map((p) => {
    const appContainers = (p.containers || []).filter(
      (c) => c.role !== 'database' && c.role !== 'proxy'
    );
    const targetsLabel =
      appContainers.length > 0
        ? appContainers.map((c) => extractContainerInternalTarget(c)).join(', ')
        : 'Sin contenedores activos';
    return {
      name: p.name,
      label: `${p.name} (${targetsLabel})`,
    };
  });
});

const selectedProjectInfo = computed<ProjectInfo | undefined>(() => {
  if (!selectedProject.value) return undefined;
  return panelStore.projects.find(
    (p) => p.name.toLowerCase() === selectedProject.value.toLowerCase()
  );
});

const detectedAppContainers = computed<
  Array<ContainerStatInfo & { resolvedTarget: string }>
>(() => {
  const proj = selectedProjectInfo.value;
  if (!proj) return [];
  return (proj.containers || [])
    .filter((c) => c.role !== 'database' && c.role !== 'proxy')
    .map((c) => ({
      ...c,
      resolvedTarget: extractContainerInternalTarget(c),
    }));
});

function onProjectSelectChange(): void {
  const containers = detectedAppContainers.value;
  if (containers.length === 0) return;

  const front = containers.find((c) => c.role === 'frontend') || containers[0];
  const back =
    containers.length > 1
      ? containers.find((c) => c.role === 'backend' && c !== front) || null
      : null;

  if (front) {
    frontInput.value = front.resolvedTarget;
  }
  backInput.value = back ? back.resolvedTarget : '';
}

function prefillRoute(r: DomainRouteItem): void {
  selectedProject.value = r.projectName;
  domainInput.value = r.domain;
  frontInput.value = r.frontendTarget;
  backInput.value = r.backendTarget || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleSubmit(): Promise<void> {
  saving.value = true;
  try {
    await apiFetch('/api/domains', {
      method: 'POST',
      body: JSON.stringify({
        domain: domainInput.value.trim(),
        projectName: selectedProject.value.trim(),
        frontendTarget: frontInput.value.trim(),
        apiPathPrefix: '/api/*',
        backendTarget: backInput.value.trim(),
        sslEnabled: true,
      }),
    });
    selectedProject.value = '';
    domainInput.value = '';
    frontInput.value = '';
    backInput.value = '';
    showToast('Ruta de dominio guardada y aplicada en Caddy SSL');
    await loadDomains();
    await refreshAll();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  } finally {
    saving.value = false;
  }
}

async function deleteDomain(id: string): Promise<void> {
  try {
    await apiFetch(`/api/domains/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Dominio eliminado');
    await loadDomains();
    await refreshAll();
  } catch (err: any) {
    showToast(`Error: ${err.message}`, true);
  }
}
</script>

<template>
  <section class="space-y-6">
    <div v-if="canCreate" class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <h3 class="text-base font-bold text-white mb-1">
        <i class="fa-solid fa-shield-halved text-emerald-400 mr-2"></i>Enrutador de Dominios y
        Subdominios (Caddy HTTPS + Prisma ORM)
      </h3>
      <p class="text-xs text-slate-400 mb-4">
        Conecta un dominio o subdominio al contenedor Frontend de tu proyecto, y opcionalmente
        enruta <code class="text-indigo-400">/api/*</code> hacia su contenedor Backend sin
        conflictos de CORS ni puertos.
      </p>

      <form @submit.prevent="handleSubmit" class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Proyecto Relacionado</label>
            <select
              v-model="selectedProject"
              @change="onProjectSelectChange"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">Selecciona un proyecto...</option>
              <option v-for="opt in projectOptions" :key="opt.name" :value="opt.name">
                {{ opt.label }}
              </option>
              <option
                v-if="
                  selectedProject &&
                  !projectOptions.some(
                    (o) => o.name.toLowerCase() === selectedProject.toLowerCase()
                  )
                "
                :value="selectedProject"
              >
                {{ selectedProject }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Dominio / Subdominio</label>
            <input
              v-model="domainInput"
              type="text"
              placeholder="ej. zapatoqueando.tudominio.com"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">
              Contenedor Principal / Front (host:puerto)
            </label>
            <input
              v-model="frontInput"
              type="text"
              placeholder="zapatoqueando-server:3000"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-emerald-300 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">
              Backend Opcional en /api/* (host:puerto)
            </label>
            <input
              v-model="backInput"
              type="text"
              placeholder="mi_backend:8080 (opcional)"
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            type="submit"
            :disabled="saving"
            class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-2 px-4 rounded-xl text-xs transition shadow-lg shadow-indigo-600/20"
          >
            <i class="fa-solid fa-plus mr-1"></i> Guardar Ruta SSL
          </button>
        </div>

        <!-- Contenedores detectados automáticamente del proyecto seleccionado -->
        <div
          v-if="selectedProjectInfo"
          class="bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-xs flex flex-wrap items-center gap-2"
        >
          <template v-if="detectedAppContainers.length > 0">
            <span class="text-slate-400 text-[11px] font-semibold">
              <i class="fa-solid fa-wand-magic-sparkles text-indigo-400 mr-1"></i>Contenedores de
              {{ selectedProjectInfo.name }}:
            </span>
            <div
              v-for="c in detectedAppContainers"
              :key="c.name"
              class="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1"
            >
              <span
                class="w-2 h-2 rounded-full"
                :class="c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'"
              ></span>
              <code class="text-emerald-300 font-mono text-[11px]">{{ c.resolvedTarget }}</code>
              <span class="text-[10px] text-slate-400">({{ c.role }})</span>
              <button
                type="button"
                @click="frontInput = c.resolvedTarget"
                class="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-semibold"
              >
                Usar en Front
              </button>
              <button
                type="button"
                @click="backInput = c.resolvedTarget"
                class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
              >
                Usar en /api/*
              </button>
            </div>
          </template>
          <span v-else class="text-amber-300 text-[11px]">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i>El proyecto
            <strong>{{ selectedProjectInfo.name }}</strong> aún no tiene contenedores activos;
            escribe el nombre del contenedor y puerto manualmente.
          </span>
        </div>
      </form>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h4 class="text-sm font-bold text-white mb-3">Dominios Configurados en MariaDB</h4>
        <div v-if="panelStore.domainRoutes.length === 0" class="text-xs text-slate-500">
          No hay rutas personalizadas guardadas aún.
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="r in panelStore.domainRoutes"
            :key="r.id"
            class="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs"
          >
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <a
                  :href="`https://${r.domain}`"
                  target="_blank"
                  class="font-bold text-indigo-400 hover:underline text-sm"
                >
                  {{ r.domain }}
                </a>
                <span
                  class="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-semibold"
                >
                  <i class="fa-solid fa-layer-group mr-1"></i>{{ r.projectName }}
                </span>
              </div>
              <div class="text-slate-400 font-mono text-[11px]">
                Front: <strong class="text-emerald-300">{{ r.frontendTarget }}</strong>
                <template v-if="r.backendTarget">
                  | Ruta <code>{{ r.apiPathPrefix || '/api/*' }}</code> &rarr;
                  <strong class="text-indigo-300">{{ r.backendTarget }}</strong>
                </template>
              </div>
            </div>

            <div class="flex items-center gap-1.5">
              <button
                v-if="canEdit"
                @click="prefillRoute(r)"
                class="px-2.5 py-1.5 text-amber-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[11px] font-semibold"
                title="Editar ruta de dominio"
              >
                <i class="fa-solid fa-pen"></i>
              </button>
              <button
                v-if="canDelete"
                @click="deleteDomain(r.id)"
                class="px-2.5 py-1.5 text-rose-400 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 rounded-lg text-[11px] font-semibold"
                title="Eliminar dominio"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-bold text-white">Caddyfile Generado</h4>
          <button
            @click="copyText(panelStore.caddyfilePreview, 'Caddyfile copiado')"
            class="text-xs text-indigo-400 hover:underline"
          >
            <i class="fa-regular fa-copy mr-1"></i>Copiar
          </button>
        </div>
        <pre
          class="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-emerald-300 font-mono overflow-x-auto max-h-80"
        >{{ panelStore.caddyfilePreview }}</pre>
      </div>
    </div>
  </section>
</template>
