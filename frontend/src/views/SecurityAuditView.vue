<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  apiFetch,
  hasPerm,
  loadAuditLogs,
  panelStore,
  showToast,
} from '../composables/usePanelStore';
import type {
  BatchIngestSimulationResult,
  DdosSimulationResult,
} from '../types/panel';

const showConfigPanel = ref(false);
const savingConfig = ref(false);
const runningDdosSim = ref(false);
const runningBatchSim = ref(false);
const flushingBuffer = ref(false);
const auditSearch = ref('');

const ddosSimForm = reactive({
  requestsCount: 350,
  attackerIp: '203.0.113.77',
  cpuScenario: 'real' as 'real' | 'warning' | 'critical',
});

const lastDdosResult = ref<DdosSimulationResult | null>(null);
const lastBatchResult = ref<BatchIngestSimulationResult | null>(null);

const shieldConfigForm = reactive({
  enabled: true,
  baseCapacity: 120,
  refillRatePerSec: 30,
  cpuWarningThreshold: 70,
  cpuCriticalThreshold: 80,
  blockDurationSec: 180,
  strikeThreshold: 25,
});

function syncConfigFromStore(): void {
  const cfg = panelStore.securityShield?.config;
  if (!cfg) return;
  shieldConfigForm.enabled = cfg.enabled;
  shieldConfigForm.baseCapacity = cfg.baseCapacity;
  shieldConfigForm.refillRatePerSec = cfg.refillRatePerSec;
  shieldConfigForm.cpuWarningThreshold = cfg.cpuWarningThreshold;
  shieldConfigForm.cpuCriticalThreshold = cfg.cpuCriticalThreshold;
  shieldConfigForm.blockDurationSec = cfg.blockDurationSec;
  shieldConfigForm.strikeThreshold = cfg.strikeThreshold;
}

watch(
  () => panelStore.securityShield?.config,
  () => syncConfigFromStore(),
  { immediate: true }
);

onMounted(async () => {
  await loadAuditLogs();
  syncConfigFromStore();
});

const canManageSecurity = computed(() => hasPerm('security', 'deploy'));

const filteredLogs = computed(() => {
  const q = auditSearch.value.trim().toLowerCase();
  if (!q) return panelStore.auditLogs;
  return panelStore.auditLogs.filter(
    (l) =>
      l.action.toLowerCase().includes(q) ||
      l.target.toLowerCase().includes(q) ||
      l.ip.toLowerCase().includes(q)
  );
});

const bufferPercent = computed(() => {
  const ingest = panelStore.securityIngest;
  if (!ingest || !ingest.maxBufferCapacity) return 0;
  return Math.min(100, Math.round((ingest.bufferSize / ingest.maxBufferCapacity) * 100));
});

async function saveShieldConfig(): Promise<void> {
  savingConfig.value = true;
  try {
    const res = await apiFetch<{ shield: typeof panelStore.securityShield }>(
      '/api/security/shield/config',
      {
        method: 'POST',
        body: JSON.stringify(shieldConfigForm),
      }
    );
    if (res.shield) panelStore.securityShield = res.shield;
    showToast('Configuración del Motor Rate-Limiter actualizada en RAM');
    await loadAuditLogs();
  } catch (err: any) {
    showToast(err.message || 'Error guardando configuración', true);
  } finally {
    savingConfig.value = false;
  }
}

async function toggleShieldEnabled(): Promise<void> {
  shieldConfigForm.enabled = !shieldConfigForm.enabled;
  await saveShieldConfig();
}

async function unblockIp(ip: string): Promise<void> {
  try {
    const res = await apiFetch<{ shield: typeof panelStore.securityShield }>(
      '/api/security/shield/unblock',
      {
        method: 'POST',
        body: JSON.stringify({ ip }),
      }
    );
    if (res.shield) panelStore.securityShield = res.shield;
    showToast(`IP ${ip} desbloqueada de la memoria volátil`);
    await loadAuditLogs();
  } catch (err: any) {
    showToast(err.message || 'Error al desbloquear IP', true);
  }
}

async function runDdosSimulation(): Promise<void> {
  runningDdosSim.value = true;
  try {
    const simulatedCpuPercent =
      ddosSimForm.cpuScenario === 'critical'
        ? 88
        : ddosSimForm.cpuScenario === 'warning'
        ? 75
        : undefined;

    const res = await apiFetch<{
      result: DdosSimulationResult;
      shield: typeof panelStore.securityShield;
      ingest: typeof panelStore.securityIngest;
    }>('/api/security/shield/simulate', {
      method: 'POST',
      body: JSON.stringify({
        requestsCount: ddosSimForm.requestsCount,
        attackerIp: ddosSimForm.attackerIp,
        simulatedCpuPercent,
      }),
    });

    lastDdosResult.value = res.result;
    if (res.shield) panelStore.securityShield = res.shield;
    if (res.ingest) panelStore.securityIngest = res.ingest;
    showToast(
      `Ráfaga DDoS mitigada en ${res.result.totalDurationMs}ms (${res.result.avgLatencyPerDecisionMs}ms/req)`
    );
    await loadAuditLogs();
  } catch (err: any) {
    showToast(err.message || 'Error ejecutando simulación DDoS', true);
  } finally {
    runningDdosSim.value = false;
  }
}

async function runBatchIngestBenchmark(eventsCount: number, forceFlushImmediately: boolean): Promise<void> {
  runningBatchSim.value = true;
  try {
    const res = await apiFetch<{
      result: BatchIngestSimulationResult;
      ingest: typeof panelStore.securityIngest;
    }>('/api/security/ingest/batch', {
      method: 'POST',
      body: JSON.stringify({
        eventsCount,
        forceFlushImmediately,
        category: 'BENCHMARK_BURST',
      }),
    });

    lastBatchResult.value = res.result;
    if (res.ingest) panelStore.securityIngest = res.ingest;
    showToast(res.result.message);
    await loadAuditLogs();
  } catch (err: any) {
    showToast(err.message || 'Error en ingesta masiva', true);
  } finally {
    runningBatchSim.value = false;
  }
}

async function forceFlushBuffer(): Promise<void> {
  flushingBuffer.value = true;
  try {
    const res = await apiFetch<{
      flushedCount: number;
      durationMs: number;
      ingest: typeof panelStore.securityIngest;
    }>('/api/security/ingest/flush', {
      method: 'POST',
    });
    if (res.ingest) panelStore.securityIngest = res.ingest;
    showToast(
      res.flushedCount > 0
        ? `Flush completado: ${res.flushedCount} eventos volcados a MariaDB en ${res.durationMs}ms`
        : 'El Ring Buffer en memoria ya está vacío (0 eventos pendientes)'
    );
    await loadAuditLogs();
  } catch (err: any) {
    showToast(err.message || 'Error vaciando buffer', true);
  } finally {
    flushingBuffer.value = false;
  }
}
</script>

<template>
  <section class="space-y-6">
    <!-- ===================================================================== -->
    <!-- MOTOR 1: RATE-LIMITING DINÁMICO POR CPU & MITIGACIÓN DDoS (< 1ms RAM) -->
    <!-- ===================================================================== -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-2.5">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-bolt-lightning text-amber-400"></i>
              Motor de Rate-Limiting Dinámico &amp; Mitigación DDoS
            </h3>
            <span
              class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
              :class="
                panelStore.securityShield?.protectionMode === 'CRITICAL_DDOS_SHIELD'
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                  : panelStore.securityShield?.protectionMode === 'THROTTLING_CPU_HIGH'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              "
            >
              <i class="fa-solid fa-shield-virus mr-1"></i>
              {{
                panelStore.securityShield?.protectionMode === 'CRITICAL_DDOS_SHIELD'
                  ? 'ESCUDO CRÍTICO CPU ≥80% (Límite al 25%)'
                  : panelStore.securityShield?.protectionMode === 'THROTTLING_CPU_HIGH'
                  ? 'THROTTLING PREVENTIVO CPU ≥70% (Límite al 60%)'
                  : 'OPERACIÓN NORMAL (Capacidad 100%)'
              }}
            </span>
            <span
              class="px-2 py-0.5 rounded-md text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
            >
              Token Bucket O(1) • Memoria Volátil (&lt; 1ms)
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Intercepta peticiones entrantes en memoria RAM sin tocar disco duro. Ajusta
            automáticamente los tokens permitidos según la carga real de CPU del VPS.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="canManageSecurity"
            @click="showConfigPanel = !showConfigPanel"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition"
          >
            <i class="fa-solid fa-sliders mr-1.5 text-indigo-400"></i>Ajustar Límites
          </button>
          <button
            v-if="canManageSecurity"
            @click="toggleShieldEnabled"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition"
            :class="
              shieldConfigForm.enabled
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25'
            "
          >
            <i
              class="fa-solid mr-1"
              :class="shieldConfigForm.enabled ? 'fa-toggle-on' : 'fa-toggle-off'"
            ></i>
            {{ shieldConfigForm.enabled ? 'Escudo Activo' : 'Escudo Pausado' }}
          </button>
        </div>
      </div>

      <!-- KPI Cards del Rate-Limiter -->
      <div v-if="panelStore.securityShield" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Latencia de Decisión (RAM)</span>
            <i class="fa-solid fa-gauge-high text-emerald-400"></i>
          </div>
          <div class="text-xl font-black text-emerald-400 font-mono mt-1">
            {{ panelStore.securityShield.metrics.avgDecisionLatencyMs }} ms
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            Última: {{ panelStore.securityShield.metrics.lastDecisionLatencyMs }} ms • Meta &lt; 2.0 ms
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Capacidad Dinámica Actual</span>
            <i class="fa-solid fa-microchip text-indigo-400"></i>
          </div>
          <div class="text-xl font-black text-white font-mono mt-1">
            {{ panelStore.securityShield.effectiveCapacity }}
            <span class="text-xs font-normal text-slate-400">
              tokens (+{{ panelStore.securityShield.effectiveRefillPerSec }}/s)
            </span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            CPU VPS:
            <span class="text-slate-300 font-semibold">
              {{ panelStore.securityShield.currentCpuPercent.toFixed(1) }}%
            </span>
            • Factor:
            <span class="text-indigo-300 font-semibold">
              {{ (panelStore.securityShield.dynamicScaleFactor * 100).toFixed(0) }}%
            </span>
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Tráfico Evaluado / Mitigado</span>
            <i class="fa-solid fa-filter text-amber-400"></i>
          </div>
          <div class="text-xl font-black text-white font-mono mt-1">
            {{ panelStore.securityShield.metrics.totalEvaluated.toLocaleString() }}
            <span class="text-xs font-normal text-slate-400">reqs</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            <span class="text-emerald-400">
              {{ panelStore.securityShield.metrics.totalAllowed.toLocaleString() }} OK
            </span>
            •
            <span class="text-amber-400">
              {{ panelStore.securityShield.metrics.totalThrottled.toLocaleString() }} HTTP 429
            </span>
            •
            <span class="text-rose-400">
              {{ panelStore.securityShield.metrics.totalBlockedHits.toLocaleString() }} Drop
            </span>
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Bloqueos en Memoria Volátil</span>
            <i class="fa-solid fa-ban text-rose-400"></i>
          </div>
          <div class="text-xl font-black text-rose-400 font-mono mt-1">
            {{ panelStore.securityShield.blockedIps.length }}
            <span class="text-xs font-normal text-slate-400">IPs bloqueadas</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            {{ panelStore.securityShield.activeIpBuckets }} buckets activos en RAM (0 I/O disco)
          </div>
        </div>
      </div>

      <!-- Panel de Configuración del Escudo -->
      <div
        v-if="showConfigPanel && canManageSecurity"
        class="bg-slate-950 border border-indigo-500/30 rounded-xl p-4 space-y-3"
      >
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-indigo-300 uppercase tracking-wider">
            <i class="fa-solid fa-sliders mr-1.5"></i>Parámetros del Algoritmo Token Bucket &amp;
            Umbrales de CPU
          </h4>
          <button
            @click="saveShieldConfig"
            :disabled="savingConfig"
            class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition"
          >
            <i class="fa-solid fa-floppy-disk mr-1"></i>
            {{ savingConfig ? 'Aplicando...' : 'Guardar en Memoria' }}
          </button>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Capacidad Base (Tokens)</label>
            <input
              v-model.number="shieldConfigForm.baseCapacity"
              type="number"
              min="10"
              max="5000"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Recarga (Tokens/seg)</label>
            <input
              v-model.number="shieldConfigForm.refillRatePerSec"
              type="number"
              min="1"
              max="2000"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">CPU Alerta 0.6x (%)</label>
            <input
              v-model.number="shieldConfigForm.cpuWarningThreshold"
              type="number"
              min="30"
              max="95"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">CPU Crítica 0.25x (%)</label>
            <input
              v-model.number="shieldConfigForm.cpuCriticalThreshold"
              type="number"
              min="40"
              max="99"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Strikes para Bloqueo IP</label>
            <input
              v-model.number="shieldConfigForm.strikeThreshold"
              type="number"
              min="3"
              max="500"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Duración Bloqueo (seg)</label>
            <input
              v-model.number="shieldConfigForm.blockDurationSec"
              type="number"
              min="10"
              max="86400"
              class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
            />
          </div>
        </div>
      </div>

      <!-- Simulador de Ráfaga / Stress-Test DDoS -->
      <div
        v-if="canManageSecurity"
        class="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
              <i class="fa-solid fa-vial-circle-check text-amber-400"></i>
              Laboratorio Stress-Test: Simulador de Ataque de Ráfaga DDoS
            </h4>
            <p class="text-[11px] text-slate-400">
              Dispara cientos de peticiones contra el Token Bucket para verificar la reducción
              dinámica por CPU y la velocidad de bloqueo en RAM (&lt; 1ms).
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <input
              v-model="ddosSimForm.attackerIp"
              type="text"
              placeholder="IP Simulada"
              class="w-32 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs"
            />
            <select
              v-model.number="ddosSimForm.requestsCount"
              class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
            >
              <option :value="150">150 Peticiones</option>
              <option :value="350">350 Peticiones</option>
              <option :value="1000">1,000 Peticiones</option>
              <option :value="2500">2,500 Peticiones</option>
            </select>
            <select
              v-model="ddosSimForm.cpuScenario"
              class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
            >
              <option value="real">Usar CPU Real del VPS</option>
              <option value="warning">Simular CPU al 75% (Escala 0.6x)</option>
              <option value="critical">Simular CPU Crítica al 88% (Escala 0.25x)</option>
            </select>
            <button
              @click="runDdosSimulation"
              :disabled="runningDdosSim"
              class="px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-semibold text-xs transition disabled:opacity-50"
            >
              <i class="fa-solid fa-bolt mr-1"></i>
              {{ runningDdosSim ? 'Simulando...' : 'Lanzar Ráfaga DDoS' }}
            </button>
          </div>
        </div>

        <!-- Resultado del último Stress-Test DDoS -->
        <div
          v-if="lastDdosResult"
          class="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span class="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono font-bold">
              IP {{ lastDdosResult.simulatedIp }}
            </span>
            <span class="text-slate-300">
              CPU Evaluada:
              <strong class="text-white">{{ lastDdosResult.simulatedCpuPercent }}%</strong>
              (Capacidad ajustada a
              <strong class="text-indigo-300">{{ lastDdosResult.effectiveCapacity }} tokens</strong>)
            </span>
            <span class="text-emerald-400 font-mono">
              ✔ {{ lastDdosResult.allowedCount }} Permitidas
            </span>
            <span class="text-amber-400 font-mono">
              ⚠ {{ lastDdosResult.throttledCount }} Throttled (429)
            </span>
            <span class="text-rose-400 font-mono">
              ⛔ {{ lastDdosResult.blockedMemoryCount }} Rechazadas en RAM
            </span>
          </div>
          <div class="font-mono text-[11px] text-emerald-300">
            ⚡ {{ lastDdosResult.avgLatencyPerDecisionMs }} ms/decisión ({{
              lastDdosResult.totalDurationMs
            }}
            ms total)
          </div>
        </div>
      </div>

      <!-- Tabla de IPs Bloqueadas en Memoria Volátil -->
      <div
        v-if="panelStore.securityShield && panelStore.securityShield.blockedIps.length > 0"
        class="space-y-2"
      >
        <h4 class="text-xs font-bold text-rose-300 flex items-center gap-1.5">
          <i class="fa-solid fa-ban"></i>
          IPs Bloqueadas Activamente en Memoria Volátil ({{
            panelStore.securityShield.blockedIps.length
          }})
        </h4>
        <div class="space-y-1.5">
          <div
            v-for="b in panelStore.securityShield.blockedIps"
            :key="b.ip"
            class="flex flex-wrap items-center justify-between gap-2 bg-rose-950/20 border border-rose-500/30 rounded-xl px-3.5 py-2 text-xs"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span class="font-mono font-bold text-rose-300">{{ b.ip }}</span>
              <span class="text-slate-300">{{ b.reason }}</span>
              <span class="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono text-[11px]">
                {{ b.blockedHits }} intentos frenados en RAM • Expira en {{ b.remainingSec }}s
              </span>
            </div>
            <button
              v-if="canManageSecurity"
              @click="unblockIp(b.ip)"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 transition"
            >
              <i class="fa-solid fa-unlock mr-1 text-emerald-400"></i>Desbloquear IP
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- MOTOR 2: API DE INGESTA MASIVA (BATCH RING BUFFER + BACKPRESSURE)     -->
    <!-- ===================================================================== -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex flex-wrap items-center gap-2.5">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-layer-group text-cyan-400"></i>
              Motor de Ingesta Masiva de Logs &amp; Agregación por Lotes (Batching + Backpressure)
            </h3>
            <span
              class="px-2.5 py-0.5 rounded-full text-[11px] font-bold border"
              :class="
                panelStore.securityIngest?.backpressureState === 'BACKPRESSURE_429'
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                  : panelStore.securityIngest?.backpressureState === 'ELEVATED'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              "
            >
              <i class="fa-solid fa-wave-square mr-1"></i>
              {{
                panelStore.securityIngest?.backpressureState === 'BACKPRESSURE_429'
                  ? 'CONTRAPRESIÓN ACTIVA (HTTP 429)'
                  : panelStore.securityIngest?.backpressureState === 'ELEVATED'
                  ? 'CARGA DE BUFFER ELEVADA (>70%)'
                  : 'FLUJO SALUDABLE (HEALTHY)'
              }}
            </span>
            <span
              class="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
            >
              Ring Buffer • Flush cada 500 eventos o 2s
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Acumula ráfagas de telemetría y auditoría en un buffer circular en RAM y ejecuta
            inserciones masivas (<code class="text-cyan-300">createMany</code>) para proteger el
            disco duro y evitar bloqueos de MariaDB.
          </p>
        </div>

        <button
          v-if="canManageSecurity"
          @click="forceFlushBuffer"
          :disabled="flushingBuffer"
          class="px-3.5 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold transition disabled:opacity-50"
        >
          <i class="fa-solid fa-database mr-1.5"></i>
          {{ flushingBuffer ? 'Volcando...' : 'Forzar Flush a MariaDB Ahora' }}
        </button>
      </div>

      <!-- KPI Cards del Motor de Ingesta Masiva -->
      <div v-if="panelStore.securityIngest" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Cola actual en Ring Buffer (RAM)</span>
            <i class="fa-solid fa-memory text-cyan-400"></i>
          </div>
          <div class="text-xl font-black text-white font-mono mt-1">
            {{ panelStore.securityIngest.bufferSize.toLocaleString() }}
            <span class="text-xs font-normal text-slate-400">
              / {{ panelStore.securityIngest.maxBufferCapacity.toLocaleString() }}
            </span>
          </div>
          <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-2">
            <div
              class="bg-cyan-400 h-full transition-all duration-300"
              :style="{ width: `${bufferPercent}%` }"
            ></div>
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>IOPS / Queries SQL Ahorradas</span>
            <i class="fa-solid fa-hard-drive text-emerald-400"></i>
          </div>
          <div class="text-xl font-black text-emerald-400 font-mono mt-1">
            {{ panelStore.securityIngest.totalSqlOperationsSaved.toLocaleString() }}
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            Escrituras individuales evitadas en disco duro
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Eventos Ingestados vs Batches</span>
            <i class="fa-solid fa-boxes-stacked text-indigo-400"></i>
          </div>
          <div class="text-xl font-black text-white font-mono mt-1">
            {{ panelStore.securityIngest.totalEventsIngested.toLocaleString() }}
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            Compactados en
            <strong class="text-indigo-300">
              {{ panelStore.securityIngest.totalSqlBatchesFlushed }}
            </strong>
            transacciones batch
          </div>
        </div>

        <div class="bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5">
          <div class="flex items-center justify-between text-[11px] text-slate-400">
            <span>Velocidad de Ingesta / Flush DB</span>
            <i class="fa-solid fa-stopwatch text-amber-400"></i>
          </div>
          <div class="text-xl font-black text-cyan-300 font-mono mt-1">
            {{ panelStore.securityIngest.avgIngestMemoryLatencyMs }} ms
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">
            Último batch ({{ panelStore.securityIngest.lastFlushCount }} filas):
            {{ panelStore.securityIngest.lastFlushDurationMs }} ms
          </div>
        </div>
      </div>

      <!-- Simulador Benchmark de Ingesta Masiva -->
      <div
        v-if="canManageSecurity"
        class="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
              <i class="fa-solid fa-rocket text-cyan-400"></i>
              Benchmark de Ingesta Masiva JSON (Prueba de Rendimiento y Ahorro de IOPS)
            </h4>
            <p class="text-[11px] text-slate-400">
              Inyecta miles de eventos JSON de telemetría de un solo golpe para medir el throughput
              en RAM y la compactación por lotes en MariaDB.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <button
              @click="runBatchIngestBenchmark(300, false)"
              :disabled="runningBatchSim"
              class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold transition disabled:opacity-50"
            >
              +300 Eventos (Solo Buffer RAM)
            </button>
            <button
              @click="runBatchIngestBenchmark(1500, true)"
              :disabled="runningBatchSim"
              class="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold transition disabled:opacity-50"
            >
              <i class="fa-solid fa-bolt mr-1"></i>+1,500 Eventos (Batch Flush)
            </button>
            <button
              @click="runBatchIngestBenchmark(5000, true)"
              :disabled="runningBatchSim"
              class="px-3 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 font-semibold transition disabled:opacity-50"
            >
              <i class="fa-solid fa-fire mr-1"></i>+5,000 Eventos (Stress Benchmark)
            </button>
          </div>
        </div>

        <div
          v-if="lastBatchResult"
          class="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span class="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono font-bold">
              {{ lastBatchResult.ingestedCount.toLocaleString() }} eventos procesados
            </span>
            <span class="text-emerald-400 font-mono">
              ✔ {{ lastBatchResult.sqlWritesSaved.toLocaleString() }} escrituras SQL ahorradas
            </span>
            <span class="text-slate-300">
              Encolado RAM:
              <strong class="text-white">{{ lastBatchResult.memoryEnqueueDurationMs }} ms</strong>
              • Flush MariaDB:
              <strong class="text-white">{{ lastBatchResult.dbFlushDurationMs }} ms</strong>
            </span>
          </div>
          <div class="font-mono text-[11px] text-cyan-300 font-bold">
            🚀 {{ lastBatchResult.throughputEventsPerSec.toLocaleString() }} eventos/seg
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- HISTORIAL DE AUDITORÍA Y SEGURIDAD (PRISMA ORM)                       -->
    <!-- ===================================================================== -->
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 class="text-base font-bold text-white">
            <i class="fa-solid fa-shield-halved text-indigo-400 mr-2"></i>Registro de Auditoría y
            Seguridad (Prisma ORM)
          </h3>
          <p class="text-xs text-slate-400">
            Historial de acciones ejecutadas en el servidor y eventos consolidados por el motor de
            ingesta (sin almacenar contraseñas ni secretos).
          </p>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model="auditSearch"
            type="text"
            placeholder="Filtrar acción, proyecto o IP..."
            class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <button
            @click="loadAuditLogs"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
          >
            <i class="fa-solid fa-rotate mr-1"></i>Actualizar
          </button>
        </div>
      </div>

      <div v-if="filteredLogs.length === 0" class="text-slate-500 text-xs">
        Sin eventos registrados para el criterio actual.
      </div>

      <div v-else class="space-y-2 text-xs max-h-[480px] overflow-y-auto pr-1">
        <div
          v-for="(l, idx) in filteredLogs"
          :key="l.id || idx"
          class="flex flex-wrap items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5"
        >
          <div class="flex items-center gap-3">
            <span
              class="px-2 py-0.5 rounded text-[10px] font-bold"
              :class="
                l.status === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-rose-500/10 text-rose-400'
              "
            >
              {{ l.action }}
            </span>
            <span class="font-mono text-white">{{ l.target }}</span>
          </div>
          <div class="text-slate-400 font-mono text-[11px]">
            IP: {{ l.ip }} • {{ new Date(l.timestamp).toLocaleString() }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
