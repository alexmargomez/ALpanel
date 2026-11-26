<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  apiFetch,
  hasPerm,
  loadDomains,
  loadServers,
  panelStore,
  refreshAll,
  showToast,
} from '../../composables/usePanelStore';
import type {
  DomainExtraRoute,
  DomainRouteItem,
  ProjectInfo,
} from '../../types/panel';
import SearchableSelect from '../common/SearchableSelect.vue';

const props = defineProps<{
  project: ProjectInfo;
}>();

const saving = ref(false);
const editingDomain = ref('');

const form = reactive({
  domain: '',
  serverId: 'local',
  frontendTarget: '',
  backendTarget: '',
  backendPathPrefix: '/api/*',
  extraRoutes: [] as DomainExtraRoute[],
});

const projectRoutes = computed(() =>
  panelStore.domainRoutes.filter(
    (r) => (r.projectName || '').toLowerCase() === props.project.name.toLowerCase()
  )
);

const serverOptions = computed(() =>
  panelStore.servers
    .filter((s) => s.isLocal || s.hasCaddy)
    .map((s) => ({
      value: s.id,
      label: s.name,
      sublabel: s.isLocal
        ? 'Gateway Central (Caddy Local)'
        : `Caddy Independiente (${s.host})`,
      badge: s.isLocal ? 'CENTRAL' : 'REMOTO',
    }))
);

const targetOptions = computed(() => {
  const opts: Array<{ value: string; label: string; sublabel?: string; badge?: string }> = [];

  for (const c of props.project.containers) {
    const port = c.internalPort || (c.role === 'frontend' ? 80 : 3000);
    opts.push({
      value: `${c.name}:${port}`,
      label: `${c.name}:${port}`,
      sublabel: `${c.role}${c.isGateway ? ' · Gateway / Core' : ''}`,
      badge: c.state === 'running' ? 'LOCAL UP' : 'LOCAL',
    });
  }

  for (const u of props.project.linkedUpstreams || []) {
    opts.push({
      value: `${u.host}:${u.port}`,
      label: `${u.serviceName} (${u.host}:${u.port})`,
      sublabel: `Servidor: ${u.serverName}`,
      badge: 'REMOTO',
    });
  }

  return opts;
});

function addExtraRoute(): void {
  form.extraRoutes.push({
    pathPrefix: '/api/v1/servicio/*',
    target: '',
    serviceName: '',
    stripPrefix: false,
  });
}

function removeExtraRoute(idx: number): void {
  form.extraRoutes.splice(idx, 1);
}

function editRoute(r: DomainRouteItem): void {
  editingDomain.value = r.domain;
  form.domain = r.domain;
  form.serverId = r.serverId || 'local';
  form.frontendTarget = r.frontendTarget || '';
  form.backendTarget = r.backendTarget || '';
  form.backendPathPrefix = r.backendPathPrefix || '/api/*';
  form.extraRoutes = (r.extraRoutes || []).map((er) => ({ ...er }));
}

function resetForm(): void {
  editingDomain.value = '';
  form.domain = '';
  form.serverId = props.project.serverId || 'local';
  form.frontendTarget = '';
  form.backendTarget = '';
  form.backendPathPrefix = '/api/*';
  form.extraRoutes = [];
}

async function saveRoute(): Promise<void> {
  if (!form.domain.trim()) {
    showToast('Ingresa el dominio (ej. app.tudominio.com).', true);
    return;
  }
  if (!form.frontendTarget.trim() && !form.backendTarget.trim()) {
    showToast('Selecciona al menos un destino Frontend o Backend.', true);
    return;
  }

  saving.value = true;
  try {
    await apiFetch('/api/domains', {
      method: 'POST',
      body: JSON.stringify({
        domain: form.domain.trim().toLowerCase(),
        projectName: props.project.name,
        serverId: form.serverId || 'local',
        frontendTarget: form.frontendTarget.trim(),
        backendTarget: form.backendTarget.trim(),
        backendPathPrefix: form.backendPathPrefix.trim() || '/api/*',
        extraRoutes: form.extraRoutes.filter(
          (er) => er.pathPrefix.trim() && er.target.trim()
        ),
      }),
    });
    showToast(`Dominio ${form.domain.trim()} guardado y SSL sincronizado.`);
    resetForm();
    await Promise.all([loadDomains(), refreshAll()]);
  } catch (err: any) {
    showToast(`Error guardando dominio: ${err.message}`, true);
  } finally {
    saving.value = false;
  }
}

async function deleteRoute(domain: string): Promise<void> {
  if (!confirm(`¿Eliminar el dominio "${domain}" de este proyecto?`)) return;
  try {
    await apiFetch(`/api/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    });
    showToast(`Dominio ${domain} eliminado.`);
    await Promise.all([loadDomains(), refreshAll()]);
  } catch (err: any) {
    showToast(`Error eliminando dominio: ${err.message}`, true);
  }
}

function getServerName(serverId?: string): string {
  const srv = panelStore.servers.find((s) => s.id === (serverId || 'local'));
  return srv ? srv.name : 'Nodo Central (Local)';
}

onMounted(() => {
  loadDomains().catch(() => {});
  if (panelStore.servers.length === 0) {
    loadServers().catch(() => {});
  }
});
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <i class="fa-solid fa-globe text-emerald-400"></i>
          <span>Dominios, SSL &amp; Rutas Gateway — {{ project.name }}</span>
        </h3>
        <p class="text-[11px] text-slate-400">
          Administra dominios exclusivos de este proyecto. Soporta Gateway Central (enrutando a contenedores locales o remotos) y Caddy independiente en otro VPS.
        </p>
      </div>
    </div>

    <!-- Formulario de Dominio y Rutas Gateway -->
    <form
      v-if="hasPerm('domains', 'manage')"
      @submit.prevent="saveRoute"
      class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-4 text-xs"
    >
      <div class="flex items-center justify-between">
        <h4 class="font-bold text-white text-xs">
          {{ editingDomain ? `Editando ${editingDomain}` : 'Vincular Nuevo Dominio / Subdominio' }}
        </h4>
        <button
          v-if="editingDomain"
          type="button"
          @click="resetForm"
          class="text-[11px] text-slate-400 hover:text-white"
        >
          Cancelar edición
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div>
          <label class="block text-slate-300 font-semibold mb-1">
            Dominio o Subdominio *
          </label>
          <input
            v-model="form.domain"
            type="text"
            placeholder="Ej: app.proveko.co o api.midominio.com"
            required
            class="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
          />
        </div>

        <div>
          <label class="block text-slate-300 font-semibold mb-1">
            Servidor Caddy / SSL Destino
          </label>
          <SearchableSelect
            v-model="form.serverId"
            :options="serverOptions"
            placeholder="Seleccionar servidor Caddy..."
          />
        </div>

        <div>
          <label class="block text-slate-300 font-semibold mb-1">
            Destino Frontend (Raíz /)
          </label>
          <SearchableSelect
            v-model="form.frontendTarget"
            :options="targetOptions"
            placeholder="Seleccionar contenedor o IP:puerto..."
            allow-custom
          />
        </div>

        <div>
          <label class="block text-slate-300 font-semibold mb-1">
            Destino Backend / API Principal
          </label>
          <SearchableSelect
            v-model="form.backendTarget"
            :options="targetOptions"
            placeholder="Seleccionar contenedor o IP:puerto..."
            allow-custom
          />
        </div>
      </div>

      <!-- Rutas Adicionales de Microservicios / Cross-Server -->
      <div class="space-y-2 pt-2 border-t border-slate-800/80">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-semibold text-slate-200 text-xs">
              Rutas Gateway Adicionales (Microservicios / Multi-Servidor)
            </div>
            <div class="text-[10px] text-slate-400">
              Enruta prefijos específicos (ej. <code>/api/v1/facturacion/*</code>) hacia contenedores locales o hacia una <code>IP:Puerto</code> de otro servidor conectado.
            </div>
          </div>
          <button
            type="button"
            @click="addExtraRoute"
            class="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-[11px] font-semibold"
          >
            <i class="fa-solid fa-plus mr-1"></i>Agregar Ruta
          </button>
        </div>

        <div
          v-for="(er, idx) in form.extraRoutes"
          :key="idx"
          class="grid grid-cols-1 sm:grid-cols-12 gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 items-center"
        >
          <input
            v-model="er.pathPrefix"
            type="text"
            placeholder="/api/v1/modulo/*"
            class="sm:col-span-4 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-[11px]"
          />
          <div class="sm:col-span-6">
            <SearchableSelect
              v-model="er.target"
              :options="targetOptions"
              placeholder="contenedor:puerto o IP:puerto..."
              allow-custom
            />
          </div>
          <div class="sm:col-span-2 flex items-center justify-end gap-1.5">
            <label class="text-[10px] text-slate-400 flex items-center gap-1 cursor-pointer">
              <input v-model="er.stripPrefix" type="checkbox" class="rounded" />
              Strip
            </label>
            <button
              type="button"
              @click="removeExtraRoute(idx)"
              class="w-7 h-7 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 flex items-center justify-center"
            >
              <i class="fa-solid fa-trash text-[10px]"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="submit"
          :disabled="saving"
          class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5"
        >
          <i
            class="fa-solid"
            :class="saving ? 'fa-spinner fa-spin' : 'fa-shield-halved'"
          ></i>
          <span>{{ editingDomain ? 'Actualizar Dominio & SSL' : 'Guardar Dominio & Emitir SSL' }}</span>
        </button>
      </div>
    </form>

    <!-- Lista de Dominios del Proyecto -->
    <div class="space-y-2.5">
      <div
        v-if="projectRoutes.length === 0"
        class="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 text-xs"
      >
        Este proyecto aún no tiene dominios vinculados.
      </div>

      <div
        v-else
        v-for="r in projectRoutes"
        :key="r.domain"
        class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <a
              :href="`https://${r.domain}`"
              target="_blank"
              rel="noopener"
              class="text-sm font-bold text-indigo-400 hover:underline font-mono flex items-center gap-1.5"
            >
              <i class="fa-solid fa-lock text-emerald-400 text-[11px]"></i>
              <span>{{ r.domain }}</span>
            </a>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-900 border border-slate-700 text-slate-300"
            >
              <i class="fa-solid fa-server text-[9px] text-indigo-400 mr-1"></i>
              {{ getServerName(r.serverId) }}
            </span>
          </div>

          <div class="flex flex-wrap gap-2 text-[11px] font-mono text-slate-400">
            <span v-if="r.frontendTarget">
              FE: <code class="text-slate-200">{{ r.frontendTarget }}</code>
            </span>
            <span v-if="r.backendTarget">
              API ({{ r.backendPathPrefix || '/api/*' }}):
              <code class="text-emerald-300">{{ r.backendTarget }}</code>
            </span>
            <span
              v-if="r.extraRoutes && r.extraRoutes.length > 0"
              class="text-violet-300"
            >
              +{{ r.extraRoutes.length }} ruta(s) extra
            </span>
          </div>
        </div>

        <div v-if="hasPerm('domains', 'manage')" class="flex items-center gap-1.5">
          <button
            @click="editRoute(r)"
            class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold"
          >
            <i class="fa-solid fa-pen mr-1"></i>Editar
          </button>
          <button
            @click="deleteRoute(r.domain)"
            class="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] font-semibold"
          >
            <i class="fa-solid fa-trash mr-1"></i>Eliminar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
