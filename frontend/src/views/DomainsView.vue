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
import type {
  ContainerStatInfo,
  DomainMicroserviceRoute,
  DomainRouteItem,
  ProjectInfo,
} from '../types/panel';

const editingRouteId = ref<string | undefined>(undefined);
const selectedProject = ref('');
const domainInput = ref('');
const frontInput = ref('');
const apiPrefixInput = ref('/api/*');
const backInput = ref('');
const extraRoutes = ref<DomainMicroserviceRoute[]>([]);
const saving = ref(false);

const canCreate = computed(() => hasPerm('domains', 'create'));
const canEdit = computed(() => hasPerm('domains', 'edit'));
const canDelete = computed(() => hasPerm('domains', 'delete'));

const projectOptions = computed(() => {
  return panelStore.projects.map((p) => {
    const appContainers = (p.containers || []).filter(
      (c) => c.role !== 'database' && c.role !== 'proxy'
    );
    const gateway = appContainers.find((c) => c.isGateway || c.role === 'gateway');
    let targetsLabel = 'Sin contenedores activos';
    if (gateway && p.microservices?.isMicroservicesArchitecture) {
      const msCount = Math.max(0, appContainers.length - 1);
      targetsLabel = `Gateway: ${extractContainerInternalTarget(gateway)}${
        msCount > 0 ? ` + ${msCount} microservicios` : ''
      }`;
    } else if (appContainers.length > 0) {
      targetsLabel = appContainers
        .slice(0, 3)
        .map((c) => extractContainerInternalTarget(c))
        .join(', ');
      if (appContainers.length > 3) {
        targetsLabel += ` +${appContainers.length - 3}`;
      }
    }
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

const detectedGatewayContainer = computed(() =>
  detectedAppContainers.value.find((c) => c.isGateway || c.role === 'gateway')
);

const isMicroservicesProject = computed(() =>
  Boolean(selectedProjectInfo.value?.microservices?.isMicroservicesArchitecture)
);

function buildDefaultPrefixForContainer(
  c: ContainerStatInfo & { resolvedTarget: string }
): string {
  if (c.suggestedPathPrefix) return c.suggestedPathPrefix;
  const rawName = (c.serviceName || c.name || 'service')
    .toLowerCase()
    .replace(/^[a-z0-9]+-(?=ms-|srv-|svc-)/, '')
    .replace(/-\d+$/, '')
    .replace(/^(ms|srv|svc|micro)[_-]/, '');
  return `/api/${rawName || 'service'}/*`;
}

function onProjectSelectChange(): void {
  extraRoutes.value = [];
  const containers = detectedAppContainers.value;
  if (containers.length === 0) return;

  const gateway = detectedGatewayContainer.value;
  if (gateway) {
    frontInput.value = gateway.resolvedTarget;
    backInput.value = '';
    return;
  }

  const front = containers.find((c) => c.role === 'frontend') || containers[0];
  const back =
    containers.length > 1 && !isMicroservicesProject.value
      ? containers.find((c) => c.role === 'backend' && c !== front) || null
      : null;

  if (front) {
    frontInput.value = front.resolvedTarget;
  }
  backInput.value = back ? back.resolvedTarget : '';
}

function addEmptyMicroserviceRoute(): void {
  extraRoutes.value.push({
    pathPrefix: '/api/servicio/*',
    target: '',
    stripPrefix: false,
  });
}

function addContainerAsMicroserviceRoute(
  c: ContainerStatInfo & { resolvedTarget: string }
): void {
  const prefix = buildDefaultPrefixForContainer(c);
  const existingIdx = extraRoutes.value.findIndex(
    (r) => r.target === c.resolvedTarget || r.pathPrefix === prefix
  );
  if (existingIdx >= 0) {
    extraRoutes.value[existingIdx].target = c.resolvedTarget;
    return;
  }
  extraRoutes.value.push({
    pathPrefix: prefix,
    target: c.resolvedTarget,
    stripPrefix: false,
    serviceName: c.serviceName || c.name,
  });
}

function autofillAllMicroserviceRoutes(): void {
  const gateway = detectedGatewayContainer.value;
  const candidates = detectedAppContainers.value.filter(
    (c) => c !== gateway && c.resolvedTarget !== frontInput.value.trim()
  );
  for (const c of candidates) {
    addContainerAsMicroserviceRoute(c);
  }
}

function removeExtraRoute(idx: number): void {
  extraRoutes.value.splice(idx, 1);
}

function resetForm(): void {
  editingRouteId.value = undefined;
  selectedProject.value = '';
  domainInput.value = '';
  frontInput.value = '';
  apiPrefixInput.value = '/api/*';
  backInput.value = '';
  extraRoutes.value = [];
}

function prefillRoute(r: DomainRouteItem): void {
  editingRouteId.value = r.id;
  selectedProject.value = r.projectName;
  domainInput.value = r.domain;
  frontInput.value = r.frontendTarget;
  apiPrefixInput.value = r.apiPathPrefix || '/api/*';
  backInput.value = r.backendTarget || '';
  extraRoutes.value = Array.isArray(r.extraRoutes)
    ? r.extraRoutes.map((er) => ({
        pathPrefix: er.pathPrefix,
        target: er.target,
        stripPrefix: Boolean(er.stripPrefix),
        serviceName: er.serviceName,
      }))
    : [];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleSubmit(): Promise<void> {
  saving.value = true;
  try {
    const cleanedExtraRoutes = extraRoutes.value
      .map((er) => ({
        pathPrefix: er.pathPrefix.trim(),
        target: er.target.trim(),
        stripPrefix: Boolean(er.stripPrefix),
        serviceName: er.serviceName,
      }))
      .filter((er) => er.pathPrefix && er.target);

    await apiFetch('/api/domains', {
      method: 'POST',
      body: JSON.stringify({
        id: editingRouteId.value,
        domain: domainInput.value.trim(),
        projectName: selectedProject.value.trim(),
        frontendTarget: frontInput.value.trim(),
        apiPathPrefix: apiPrefixInput.value.trim() || '/api/*',
        backendTarget: backInput.value.trim(),
        extraRoutes: cleanedExtraRoutes,
        sslEnabled: true,
      }),
    });
    resetForm();
    showToast('Ruta de dominio y microservicios guardada en Caddy SSL');
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
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 class="text-base font-bold text-white">
          <i class="fa-solid fa-shield-halved text-emerald-400 mr-2"></i>Enrutador de Dominios,
          Subdominios y Microservicios (Caddy HTTPS + Prisma ORM)
        </h3>
        <button
          v-if="editingRouteId"
          type="button"
          @click="resetForm"
          class="text-xs px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
        >
          Cancelar edición
        </button>
      </div>
      <p class="text-xs text-slate-400 mb-4">
        Conecta un dominio o subdominio al contenedor Gateway / Frontend de tu proyecto, y
        opcionalmente mapea <code class="text-indigo-400">/api/*</code> o múltiples prefijos de
        microservicios (<code class="text-violet-300">/api/servicio/*</code>) sin conflictos de
        CORS ni puertos expuestos.
      </p>

      <form @submit.prevent="handleSubmit" class="space-y-3.5">
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
              placeholder="ej. proveko.tudominio.com"
              required
              class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">
              Contenedor Principal / Gateway (host:puerto)
            </label>
            <input
              v-model="frontInput"
              type="text"
              placeholder="proveko_core:4000"
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
            <i class="fa-solid fa-plus mr-1"></i>
            {{ editingRouteId ? 'Actualizar Ruta SSL' : 'Guardar Ruta SSL' }}
          </button>
        </div>

        <!-- Aviso inteligente cuando el proyecto tiene API Gateway propio (ej. Proveko) -->
        <div
          v-if="detectedGatewayContainer && isMicroservicesProject"
          class="bg-emerald-950/25 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 flex flex-wrap items-center justify-between gap-2"
        >
          <div class="flex items-start gap-2">
            <i class="fa-solid fa-network-wired text-emerald-400 mt-0.5"></i>
            <div>
              <span class="font-bold text-emerald-300">
                API Gateway Central detectado ({{ detectedGatewayContainer.resolvedTarget }}):
              </span>
              <span class="text-slate-300 ml-1">
                Este contenedor ya recibe todo el tráfico HTTPS y enruta internamente los
                microservicios en su red privada con autenticación S2S. Solo necesitas
                <code class="text-emerald-300 font-mono">
                  {{ detectedGatewayContainer.resolvedTarget }}
                </code>
                como contenedor principal (usa las rutas extra solo si deseas exponer un
                microservicio directo sin pasar por el Gateway).
              </span>
            </div>
          </div>
        </div>

        <!-- Constructor de Rutas Adicionales de Microservicios por Prefijo -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs">
              <i class="fa-solid fa-route text-violet-400"></i>
              <span class="font-bold text-slate-200">
                Rutas de Microservicios por Prefijo en Caddy
              </span>
              <span
                v-if="extraRoutes.length > 0"
                class="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 text-[10px] font-bold"
              >
                {{ extraRoutes.length }} ruta(s)
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-if="isMicroservicesProject && !detectedGatewayContainer && detectedAppContainers.length > 1"
                type="button"
                @click="autofillAllMicroserviceRoutes"
                class="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 border border-violet-500/30 text-[11px] font-semibold transition"
              >
                <i class="fa-solid fa-bolt mr-1"></i>Autocompletar Microservicios
              </button>
              <button
                type="button"
                @click="addEmptyMicroserviceRoute"
                class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition"
              >
                <i class="fa-solid fa-plus mr-1 text-violet-400"></i>Agregar Ruta Microservicio
              </button>
            </div>
          </div>

          <p v-if="extraRoutes.length === 0" class="text-[11px] text-slate-400">
            Para arquitecturas sin API Gateway propio, agrega reglas como
            <code class="text-violet-300 font-mono">/api/pagos/*</code> &rarr;
            <code class="text-emerald-300 font-mono">ms-pagos:4101</code> o pulsa
            <strong>+ Ruta MS</strong> sobre cualquier contenedor abajo.
          </p>

          <div v-else class="space-y-2">
            <div
              v-for="(er, idx) in extraRoutes"
              :key="idx"
              class="grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-slate-900 border border-slate-800 rounded-xl p-2.5"
            >
              <div class="md:col-span-4">
                <label class="block text-[10px] text-slate-400 mb-0.5">
                  Prefijo URL en el Dominio
                </label>
                <input
                  v-model="er.pathPrefix"
                  type="text"
                  placeholder="/api/facturacion/*"
                  class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-violet-300 font-mono focus:outline-none focus:border-violet-500"
                />
              </div>

              <div class="md:col-span-5">
                <label class="block text-[10px] text-slate-400 mb-0.5">
                  Contenedor Microservicio (host:puerto interno)
                </label>
                <input
                  v-model="er.target"
                  type="text"
                  placeholder="proveko-ms-facturacion-1:4101"
                  class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-emerald-300 font-mono focus:outline-none focus:border-violet-500"
                />
              </div>

              <div class="md:col-span-2 flex items-center pt-3">
                <label
                  class="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none"
                  title="Si se marca, Caddy usa handle_path y recorta el prefijo antes de enviarlo al microservicio"
                >
                  <input
                    v-model="er.stripPrefix"
                    type="checkbox"
                    class="rounded bg-slate-950 border-slate-700 text-violet-500"
                  />
                  <span>Strip prefix</span>
                </label>
              </div>

              <div class="md:col-span-1 flex justify-end pt-3">
                <button
                  type="button"
                  @click="removeExtraRoute(idx)"
                  class="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-800/40 text-xs"
                  title="Quitar esta ruta de microservicio"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Contenedores detectados automáticamente del proyecto seleccionado con su puerto interno real -->
        <div
          v-if="selectedProjectInfo"
          class="bg-slate-950/80 border border-slate-800/80 rounded-xl px-3.5 py-2.5 text-xs flex flex-wrap items-center gap-2"
        >
          <template v-if="detectedAppContainers.length > 0">
            <span class="text-slate-400 text-[11px] font-semibold">
              <i class="fa-solid fa-wand-magic-sparkles text-indigo-400 mr-1"></i>Contenedores de
              {{ selectedProjectInfo.name }} (puertos reales):
            </span>
            <div
              v-for="c in detectedAppContainers"
              :key="c.name"
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 border"
              :class="
                c.isGateway || c.role === 'gateway'
                  ? 'bg-emerald-950/30 border-emerald-500/40'
                  : 'bg-slate-900 border-slate-800'
              "
            >
              <span
                class="w-2 h-2 rounded-full"
                :class="c.state === 'running' ? 'bg-emerald-400' : 'bg-rose-500'"
              ></span>
              <code class="text-emerald-300 font-mono text-[11px]">{{ c.resolvedTarget }}</code>
              <span
                v-if="c.isGateway || c.role === 'gateway'"
                class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase"
              >
                Gateway / Core
              </span>
              <span v-else class="text-[10px] text-slate-400">({{ c.role }})</span>

              <button
                type="button"
                @click="frontInput = c.resolvedTarget"
                class="ml-1 px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-[10px] font-semibold"
              >
                Usar Principal
              </button>
              <button
                v-if="!c.isGateway && c.role !== 'gateway'"
                type="button"
                @click="addContainerAsMicroserviceRoute(c)"
                class="px-1.5 py-0.5 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 text-[10px] font-semibold"
                :title="`Agregar ruta ${buildDefaultPrefixForContainer(c)} -> ${c.resolvedTarget}`"
              >
                + Ruta MS
              </button>
              <button
                v-if="!isMicroservicesProject"
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
            class="flex items-start justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs"
          >
            <div class="space-y-1.5 min-w-0">
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
                Principal / Gateway:
                <strong class="text-emerald-300">{{ r.frontendTarget }}</strong>
                <template v-if="r.backendTarget">
                  | Ruta <code>{{ r.apiPathPrefix || '/api/*' }}</code> &rarr;
                  <strong class="text-indigo-300">{{ r.backendTarget }}</strong>
                </template>
              </div>
              <div
                v-if="r.extraRoutes && r.extraRoutes.length > 0"
                class="flex flex-wrap gap-1.5 pt-0.5"
              >
                <span
                  v-for="(er, idx) in r.extraRoutes"
                  :key="idx"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-950/40 border border-violet-500/30 text-[10px] font-mono text-violet-200"
                >
                  <span class="text-violet-300">{{ er.pathPrefix }}</span>
                  <span class="text-slate-400">&rarr;</span>
                  <span class="text-emerald-300">{{ er.target }}</span>
                </span>
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
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
