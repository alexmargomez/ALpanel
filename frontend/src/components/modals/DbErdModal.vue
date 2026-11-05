<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  apiFetch,
  copyText,
  panelStore,
  showToast,
} from '../../composables/usePanelStore';
import type {
  ErdRelationInfo,
  ErdTableInfo,
  ProjectErdSchema,
} from '../../types/panel';

const CARD_WIDTH = 280;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 26;

const loading = ref(false);
const errorMsg = ref('');
const schema = ref<ProjectErdSchema | null>(null);
const searchQuery = ref('');
const selectedTable = ref<string | null>(null);
const hoveredTable = ref<string | null>(null);
const viewMode = ref<'canvas' | 'mermaid'>('canvas');

const zoom = ref(0.9);
const pan = reactive({ x: 40, y: 40 });
const positions = reactive<Record<string, { x: number; y: number }>>({});

const draggingState = reactive<{
  mode: 'none' | 'pan' | 'table';
  tableName: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}>({
  mode: 'none',
  tableName: '',
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
});

function getTableHeight(tbl: ErdTableInfo): number {
  return HEADER_HEIGHT + Math.max(1, tbl.columns.length) * ROW_HEIGHT + 12;
}

function autoLayoutTables(): void {
  const data = schema.value;
  if (!data || data.tables.length === 0) return;

  const degreeMap = new Map<string, number>();
  for (const t of data.tables) degreeMap.set(t.name, 0);
  for (const r of data.relations) {
    degreeMap.set(r.sourceTable, (degreeMap.get(r.sourceTable) || 0) + 1);
    degreeMap.set(r.targetTable, (degreeMap.get(r.targetTable) || 0) + 1);
  }

  const sorted = [...data.tables].sort(
    (a, b) => (degreeMap.get(b.name) || 0) - (degreeMap.get(a.name) || 0)
  );

  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(sorted.length))));
  const colWidths = CARD_WIDTH + 110;
  const colYOffsets = new Array(cols).fill(40);

  sorted.forEach((tbl, idx) => {
    const colIdx = idx % cols;
    const x = 40 + colIdx * colWidths;
    const y = colYOffsets[colIdx];
    positions[tbl.name] = { x, y };
    colYOffsets[colIdx] += getTableHeight(tbl) + 56;
  });

  pan.x = 30;
  pan.y = 30;
  zoom.value = sorted.length > 8 ? 0.78 : 0.92;
}

async function loadErd(): Promise<void> {
  const projName = panelStore.modals.erd.projectName;
  const containerName = panelStore.modals.erd.containerName || '';
  const dbName = panelStore.modals.erd.databaseName || '';
  if (!projName) return;
  loading.value = true;
  errorMsg.value = '';
  selectedTable.value = null;
  try {
    const params = new URLSearchParams();
    if (containerName) params.set('container', containerName);
    if (dbName) params.set('db', dbName);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<ProjectErdSchema>(
      `/api/projects/${encodeURIComponent(projName)}/db-erd${query}`
    );
    schema.value = res;
    if (res.databaseName) {
      panelStore.modals.erd.databaseName = res.databaseName;
    }
    autoLayoutTables();
  } catch (err: any) {
    errorMsg.value =
      err.message || 'No se pudo cargar el diagrama DER / ERD de este contenedor.';
  } finally {
    loading.value = false;
  }
}

function onSelectDatabase(e: Event): void {
  const target = e.target as HTMLSelectElement;
  if (!target?.value) return;
  panelStore.modals.erd.databaseName = target.value;
  loadErd();
}

watch(
  () => panelStore.modals.erd.open,
  (isOpen) => {
    if (isOpen) {
      viewMode.value = 'canvas';
      searchQuery.value = '';
      loadErd();
    }
  }
);

const activeFocusTable = computed(
  () => hoveredTable.value || selectedTable.value
);

const connectedTablesSet = computed(() => {
  const focus = activeFocusTable.value;
  const set = new Set<string>();
  if (!focus || !schema.value) return set;
  set.add(focus);
  for (const r of schema.value.relations) {
    if (r.sourceTable === focus) set.add(r.targetTable);
    if (r.targetTable === focus) set.add(r.sourceTable);
  }
  return set;
});

function matchesSearch(tbl: ErdTableInfo): boolean {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  if (tbl.name.toLowerCase().includes(q)) return true;
  return tbl.columns.some((c) => c.name.toLowerCase().includes(q));
}

interface ComputedConnector {
  id: string;
  rel: ErdRelationInfo;
  path: string;
  midX: number;
  midY: number;
  srcX: number;
  srcY: number;
  tgtX: number;
  tgtY: number;
  srcLeftSide: boolean;
  tgtLeftSide: boolean;
  isHighlighted: boolean;
}

const connectors = computed<ComputedConnector[]>(() => {
  const data = schema.value;
  if (!data) return [];

  const tblMap = new Map<string, ErdTableInfo>();
  for (const t of data.tables) tblMap.set(t.name, t);

  const focus = activeFocusTable.value;

  return data.relations
    .map((rel) => {
      const srcTbl = tblMap.get(rel.sourceTable);
      const tgtTbl = tblMap.get(rel.targetTable);
      const srcPos = positions[rel.sourceTable];
      const tgtPos = positions[rel.targetTable];
      if (!srcTbl || !tgtTbl || !srcPos || !tgtPos) return null;

      const srcColIdx = Math.max(
        0,
        srcTbl.columns.findIndex((c) => c.name === rel.sourceColumn)
      );
      const tgtColIdx = Math.max(
        0,
        tgtTbl.columns.findIndex((c) => c.name === rel.targetColumn)
      );

      const srcY =
        srcPos.y + HEADER_HEIGHT + srcColIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const tgtY =
        tgtPos.y + HEADER_HEIGHT + tgtColIdx * ROW_HEIGHT + ROW_HEIGHT / 2;

      const srcCenterX = srcPos.x + CARD_WIDTH / 2;
      const tgtCenterX = tgtPos.x + CARD_WIDTH / 2;

      let srcX = srcPos.x + CARD_WIDTH;
      let tgtX = tgtPos.x;
      let srcLeftSide = false;
      let tgtLeftSide = true;

      if (srcCenterX > tgtCenterX + CARD_WIDTH * 0.4) {
        srcX = srcPos.x;
        tgtX = tgtPos.x + CARD_WIDTH;
        srcLeftSide = true;
        tgtLeftSide = false;
      } else if (Math.abs(srcCenterX - tgtCenterX) <= CARD_WIDTH * 0.4) {
        srcX = srcPos.x + CARD_WIDTH;
        tgtX = tgtPos.x + CARD_WIDTH;
        srcLeftSide = false;
        tgtLeftSide = false;
      }

      const dx = Math.max(60, Math.abs(tgtX - srcX) * 0.5);
      const c1X = srcLeftSide ? srcX - dx : srcX + dx;
      const c2X = tgtLeftSide ? tgtX - dx : tgtX + dx;

      const path = `M ${srcX} ${srcY} C ${c1X} ${srcY}, ${c2X} ${tgtY}, ${tgtX} ${tgtY}`;
      const midX = (srcX + tgtX) / 2;
      const midY = (srcY + tgtY) / 2;
      const isHighlighted = Boolean(
        focus && (rel.sourceTable === focus || rel.targetTable === focus)
      );

      return {
        id: rel.id,
        rel,
        path,
        midX,
        midY,
        srcX,
        srcY,
        tgtX,
        tgtY,
        srcLeftSide,
        tgtLeftSide,
        isHighlighted,
      };
    })
    .filter((x): x is ComputedConnector => x !== null);
});

const selectedTableRelations = computed(() => {
  const focus = selectedTable.value;
  if (!focus || !schema.value) return [];
  return schema.value.relations.filter(
    (r) => r.sourceTable === focus || r.targetTable === focus
  );
});

function startPanCanvas(e: MouseEvent): void {
  if (e.button !== 0) return;
  draggingState.mode = 'pan';
  draggingState.startX = e.clientX;
  draggingState.startY = e.clientY;
  draggingState.originX = pan.x;
  draggingState.originY = pan.y;
}

function startDragTable(tableName: string, e: MouseEvent): void {
  e.stopPropagation();
  selectedTable.value = tableName;
  const pos = positions[tableName] || { x: 40, y: 40 };
  draggingState.mode = 'table';
  draggingState.tableName = tableName;
  draggingState.startX = e.clientX;
  draggingState.startY = e.clientY;
  draggingState.originX = pos.x;
  draggingState.originY = pos.y;
}

function onMouseMove(e: MouseEvent): void {
  if (draggingState.mode === 'none') return;
  if (draggingState.mode === 'pan') {
    pan.x = draggingState.originX + (e.clientX - draggingState.startX);
    pan.y = draggingState.originY + (e.clientY - draggingState.startY);
  } else if (draggingState.mode === 'table') {
    const dx = (e.clientX - draggingState.startX) / zoom.value;
    const dy = (e.clientY - draggingState.startY) / zoom.value;
    positions[draggingState.tableName] = {
      x: Math.max(0, Math.round(draggingState.originX + dx)),
      y: Math.max(0, Math.round(draggingState.originY + dy)),
    };
  }
}

function stopDrag(): void {
  draggingState.mode = 'none';
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.08 : -0.08;
  zoom.value = Math.min(1.6, Math.max(0.35, Number((zoom.value + delta).toFixed(2))));
}

function zoomIn(): void {
  zoom.value = Math.min(1.6, Number((zoom.value + 0.12).toFixed(2)));
}

function zoomOut(): void {
  zoom.value = Math.max(0.35, Number((zoom.value - 0.12).toFixed(2)));
}

function focusTableOnCanvas(tableName: string): void {
  selectedTable.value = tableName;
  const pos = positions[tableName];
  if (!pos) return;
  pan.x = Math.round(350 - pos.x * zoom.value);
  pan.y = Math.round(160 - pos.y * zoom.value);
}

function downloadErdJson(): void {
  if (!schema.value) return;
  const blob = new Blob([JSON.stringify(schema.value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${schema.value.projectName}_${schema.value.databaseName}_erd.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Esquema DER / ERD exportado en JSON');
}

function close(): void {
  panelStore.modals.erd.open = false;
}
</script>

<template>
  <div
    v-if="panelStore.modals.erd.open"
    class="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
    @mouseup="stopDrag"
    @mouseleave="stopDrag"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-[96vw] h-[92vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <!-- Top Toolbar -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-950"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-400 flex items-center justify-center text-lg"
          >
            <i class="fa-solid fa-diagram-project"></i>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-bold text-white">
                Modelo Gráfico DER / ERD — {{ panelStore.modals.erd.projectName }}
              </h3>
              <span
                v-if="panelStore.modals.erd.containerName || schema?.containerName"
                class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono"
              >
                <i class="fa-solid fa-database mr-1"></i>{{ panelStore.modals.erd.containerName || schema?.containerName }}
              </span>
              <select
                v-if="schema?.availableDatabases && schema.availableDatabases.length > 0"
                :value="schema.databaseName"
                @change="onSelectDatabase"
                class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 font-mono focus:outline-none focus:border-fuchsia-400 cursor-pointer"
                title="Cambiar de Base de Datos (Control Plane / Demo / Clientes)"
              >
                <option
                  v-for="dbItem in schema.availableDatabases"
                  :key="dbItem"
                  :value="dbItem"
                >
                  🗄️ {{ dbItem }} ({{ schema.engine }})
                </option>
              </select>
              <span
                v-else-if="schema"
                class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
              >
                {{ schema.databaseName }} ({{ schema.engine }})
              </span>
              <span
                v-if="schema"
                class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              >
                {{ schema.tables.length }} Tablas • {{ schema.relations.length }} Relaciones FK
              </span>
            </div>
            <p class="text-xs text-slate-400">
              Arrastra las tablas para organizar el diagrama, haz clic en una entidad para resaltar sus llaves foráneas (1:N) o usa la rueda del mouse para hacer zoom
            </p>
          </div>
        </div>

        <!-- Controles de Vista y Exportación -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative w-48 sm:w-56">
            <i class="fa-solid fa-search absolute left-3 top-2.5 text-slate-500 text-xs"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Buscar tabla o columna..."
              class="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-fuchsia-500"
            />
          </div>

          <div class="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-0.5 text-xs">
            <button
              @click="viewMode = 'canvas'"
              class="px-2.5 py-1 rounded-lg font-semibold transition"
              :class="
                viewMode === 'canvas'
                  ? 'bg-fuchsia-600 text-white'
                  : 'text-slate-400 hover:text-white'
              "
            >
              <i class="fa-solid fa-diagram-project mr-1"></i>Lienzo DER
            </button>
            <button
              @click="viewMode = 'mermaid'"
              class="px-2.5 py-1 rounded-lg font-semibold transition"
              :class="
                viewMode === 'mermaid'
                  ? 'bg-fuchsia-600 text-white'
                  : 'text-slate-400 hover:text-white'
              "
            >
              <i class="fa-solid fa-code mr-1"></i>Mermaid ERD
            </button>
          </div>

          <div
            v-if="viewMode === 'canvas'"
            class="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1 text-xs"
          >
            <button
              @click="zoomOut"
              class="px-1.5 py-0.5 hover:text-fuchsia-400 text-slate-300"
              title="Alejar"
            >
              <i class="fa-solid fa-minus"></i>
            </button>
            <span class="font-mono text-[11px] text-white w-11 text-center">
              {{ Math.round(zoom * 100) }}%
            </span>
            <button
              @click="zoomIn"
              class="px-1.5 py-0.5 hover:text-fuchsia-400 text-slate-300"
              title="Acercar"
            >
              <i class="fa-solid fa-plus"></i>
            </button>
            <button
              @click="autoLayoutTables"
              class="ml-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-semibold"
              title="Auto-organizar tablas"
            >
              <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Auto-Layout
            </button>
          </div>

          <button
            v-if="schema"
            @click="copyText(schema.mermaidCode, 'Código Mermaid erDiagram copiado')"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-regular fa-copy"></i> Copiar Mermaid
          </button>

          <button
            v-if="schema"
            @click="downloadErdJson"
            class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
          >
            <i class="fa-solid fa-download"></i> JSON
          </button>

          <button
            @click="close"
            class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs"
          >
            <i class="fa-solid fa-xmark text-base"></i>
          </button>
        </div>
      </div>

      <!-- Loading / Error States -->
      <div
        v-if="loading"
        class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300 text-sm"
      >
        <i class="fa-solid fa-circle-notch fa-spin text-3xl text-fuchsia-400"></i>
        <span>Inspeccionando tablas, columnas y llaves foráneas de la Base de Datos...</span>
      </div>

      <div
        v-else-if="errorMsg"
        class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <div
          class="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center text-2xl"
        >
          <i class="fa-solid fa-database"></i>
        </div>
        <div class="max-w-md space-y-1">
          <h4 class="font-bold text-white text-base">No se pudo generar el modelo DER / ERD</h4>
          <p class="text-xs text-slate-400">{{ errorMsg }}</p>
        </div>
        <button
          @click="loadErd"
          class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
        >
          <i class="fa-solid fa-rotate mr-1.5"></i>Reintentar Inspección
        </button>
      </div>

      <!-- Main Interactive Canvas Mode -->
      <div
        v-else-if="schema && viewMode === 'canvas'"
        class="flex-1 flex overflow-hidden relative"
      >
        <!-- Interactive Pan/Zoom Viewport -->
        <div
          class="flex-1 relative overflow-hidden select-none cursor-grab active:cursor-grabbing bg-[#070B14]"
          style="
            background-image: radial-gradient(rgba(99, 102, 241, 0.16) 1px, transparent 1px);
            background-size: 24px 24px;
          "
          @mousedown="startPanCanvas"
          @mousemove="onMouseMove"
          @wheel="onWheel"
          @click.self="selectedTable = null"
        >
          <!-- Transform Layer -->
          <div
            class="absolute top-0 left-0 origin-top-left"
            :style="{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              width: '4200px',
              height: '3200px',
            }"
          >
            <!-- SVG Connector Layer (Relaciones 1:N Crow's Foot) -->
            <svg
              class="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
            >
              <g v-for="conn in connectors" :key="conn.id">
                <path
                  :d="conn.path"
                  fill="none"
                  :stroke="
                    conn.isHighlighted
                      ? '#F43F5E'
                      : conn.rel.isImplicit
                      ? '#6366F1'
                      : '#38BDF8'
                  "
                  :stroke-width="conn.isHighlighted ? 2.8 : 1.7"
                  :stroke-dasharray="conn.rel.isImplicit ? '5,4' : 'none'"
                  :opacity="
                    activeFocusTable && !conn.isHighlighted ? 0.18 : 0.88
                  "
                />

                <!-- Crow's Foot Many (N) en la tabla origen (FK) -->
                <circle
                  :cx="conn.srcX + (conn.srcLeftSide ? -10 : 10)"
                  :cy="conn.srcY"
                  r="3.2"
                  :fill="conn.isHighlighted ? '#F43F5E' : '#38BDF8'"
                  :opacity="activeFocusTable && !conn.isHighlighted ? 0.18 : 0.95"
                />
                <path
                  :d="`M ${conn.srcX + (conn.srcLeftSide ? -6 : 6)} ${conn.srcY} L ${conn.srcX} ${conn.srcY - 5} M ${conn.srcX + (conn.srcLeftSide ? -6 : 6)} ${conn.srcY} L ${conn.srcX} ${conn.srcY + 5}`"
                  :stroke="conn.isHighlighted ? '#F43F5E' : '#38BDF8'"
                  stroke-width="1.8"
                  fill="none"
                  :opacity="activeFocusTable && !conn.isHighlighted ? 0.18 : 0.95"
                />

                <!-- One (1) Tick en la tabla destino (PK) -->
                <line
                  :x1="conn.tgtX + (conn.tgtLeftSide ? -6 : 6)"
                  :y1="conn.tgtY - 5"
                  :x2="conn.tgtX + (conn.tgtLeftSide ? -6 : 6)"
                  :y2="conn.tgtY + 5"
                  :stroke="conn.isHighlighted ? '#F43F5E' : '#F59E0B'"
                  stroke-width="2.2"
                  :opacity="activeFocusTable && !conn.isHighlighted ? 0.18 : 0.95"
                />

                <!-- Etiqueta en relaciones resaltadas -->
                <g v-if="conn.isHighlighted">
                  <rect
                    :x="conn.midX - 58"
                    :y="conn.midY - 10"
                    width="116"
                    height="19"
                    rx="5"
                    fill="#0F172A"
                    stroke="#F43F5E"
                    stroke-width="1"
                  />
                  <text
                    :x="conn.midX"
                    :y="conn.midY + 3"
                    text-anchor="middle"
                    fill="#FDA4AF"
                    font-size="9.5"
                    font-family="monospace"
                  >
                    {{ conn.rel.sourceColumn }} → {{ conn.rel.targetColumn }}
                  </text>
                </g>
              </g>
            </svg>

            <!-- Tarjetas de Tablas Draggable -->
            <div
              v-for="tbl in schema.tables"
              :key="tbl.name"
              class="absolute rounded-xl bg-slate-900/95 border shadow-2xl transition-opacity duration-150 overflow-hidden"
              :class="[
                selectedTable === tbl.name
                  ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40 z-30'
                  : activeFocusTable && connectedTablesSet.has(tbl.name)
                  ? 'border-indigo-400 z-20'
                  : 'border-slate-700/90 z-10',
                (!matchesSearch(tbl) ||
                  (activeFocusTable && !connectedTablesSet.has(tbl.name)))
                  ? 'opacity-30'
                  : 'opacity-100',
              ]"
              :style="{
                width: `${CARD_WIDTH}px`,
                left: `${positions[tbl.name]?.x || 0}px`,
                top: `${positions[tbl.name]?.y || 0}px`,
              }"
              @mousedown="startDragTable(tbl.name, $event)"
              @mouseenter="hoveredTable = tbl.name"
              @mouseleave="hoveredTable = null"
            >
              <!-- Cabecera de la Tabla -->
              <div
                class="px-3 border-b border-slate-800 flex items-center justify-between cursor-move"
                :class="
                  selectedTable === tbl.name
                    ? 'bg-fuchsia-950/60'
                    : 'bg-slate-950'
                "
                :style="{ height: `${HEADER_HEIGHT}px` }"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <i class="fa-solid fa-table text-fuchsia-400 text-xs shrink-0"></i>
                  <span class="font-bold text-xs text-white truncate" :title="tbl.name">
                    {{ tbl.name }}
                  </span>
                </div>
                <span
                  class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0"
                >
                  {{ tbl.rowCount }} filas
                </span>
              </div>

              <!-- Lista de Columnas -->
              <div class="py-1 divide-y divide-slate-800/50">
                <div
                  v-for="col in tbl.columns"
                  :key="col.name"
                  class="px-3 flex items-center justify-between gap-2 text-[11px] font-mono"
                  :class="
                    searchQuery &&
                    col.name.toLowerCase().includes(searchQuery.toLowerCase())
                      ? 'bg-fuchsia-500/20'
                      : 'hover:bg-slate-800/60'
                  "
                  :style="{ height: `${ROW_HEIGHT}px` }"
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <i
                      v-if="col.isPrimaryKey"
                      class="fa-solid fa-key text-[10px] text-amber-400 shrink-0"
                      title="Primary Key (PK)"
                    ></i>
                    <i
                      v-else-if="col.isForeignKey"
                      class="fa-solid fa-link text-[10px] text-sky-400 shrink-0"
                      title="Foreign Key (FK)"
                    ></i>
                    <span
                      v-else
                      class="w-2.5 inline-block text-center text-slate-600 shrink-0"
                    >•</span>

                    <span
                      class="truncate"
                      :class="
                        col.isPrimaryKey
                          ? 'font-bold text-amber-300'
                          : col.isForeignKey
                          ? 'font-semibold text-sky-300'
                          : 'text-slate-200'
                      "
                      :title="col.name"
                    >
                      {{ col.name }}
                    </span>
                  </div>

                  <div class="flex items-center gap-1 shrink-0">
                    <span class="text-[10px] text-slate-400 truncate max-w-[92px]" :title="col.type">
                      {{ col.type }}
                    </span>
                    <span
                      v-if="col.nullable"
                      class="text-[9px] px-1 rounded bg-slate-800 text-slate-500"
                      title="Permite NULL"
                    >
                      ?
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Leyenda Flotante Inferior Izquierda -->
          <div
            class="absolute bottom-3 left-3 bg-slate-900/95 border border-slate-800 rounded-xl px-3.5 py-2 text-[11px] flex flex-wrap items-center gap-3 shadow-lg"
          >
            <span class="flex items-center gap-1 text-amber-400">
              <i class="fa-solid fa-key"></i> PK (Llave Primaria)
            </span>
            <span class="flex items-center gap-1 text-sky-400">
              <i class="fa-solid fa-link"></i> FK (Llave Foránea 1:N)
            </span>
            <span class="flex items-center gap-1 text-indigo-400">
              <span class="w-4 border-b border-dashed border-indigo-400 inline-block"></span>
              Relación Inferida (`*_id`)
            </span>
          </div>
        </div>

        <!-- Panel Lateral Inspector de Entidades y Relaciones -->
        <aside
          class="w-72 sm:w-80 bg-slate-950 border-l border-slate-800 p-4 overflow-y-auto space-y-4 scrollbar-thin hidden lg:block"
        >
          <div v-if="selectedTable">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold uppercase tracking-wider text-fuchsia-400">
                Entidad Seleccionada
              </span>
              <button
                @click="selectedTable = null"
                class="text-[11px] text-slate-400 hover:text-white"
              >
                Ver todas
              </button>
            </div>
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div class="font-bold text-sm text-white font-mono">{{ selectedTable }}</div>
              <div class="text-[11px] text-slate-400">
                Relaciones conectadas ({{ selectedTableRelations.length }}):
              </div>
              <div v-if="selectedTableRelations.length === 0" class="text-xs text-slate-500 italic">
                Esta tabla no tiene llaves foráneas entrantes ni salientes registradas.
              </div>
              <div
                v-for="r in selectedTableRelations"
                :key="r.id"
                class="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono space-y-1"
              >
                <div class="text-sky-300">
                  {{ r.sourceTable }}.<strong>{{ r.sourceColumn }}</strong>
                </div>
                <div class="text-slate-400 flex items-center gap-1">
                  <i class="fa-solid fa-arrow-turn-up fa-rotate-90 text-fuchsia-400"></i>
                  referencia a
                </div>
                <button
                  @click="focusTableOnCanvas(r.targetTable === selectedTable ? r.sourceTable : r.targetTable)"
                  class="text-amber-300 hover:underline text-left"
                >
                  {{ r.targetTable }}.<strong>{{ r.targetColumn }}</strong>
                </button>
                <div class="text-[10px] text-slate-500">
                  ON DELETE {{ r.deleteRule }}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Índice de Tablas ({{ schema.tables.length }})
            </div>
            <div class="space-y-1.5">
              <button
                v-for="t in schema.tables"
                :key="t.name"
                @click="focusTableOnCanvas(t.name)"
                class="w-full text-left px-3 py-2 rounded-xl border text-xs flex items-center justify-between transition"
                :class="
                  selectedTable === t.name
                    ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-white font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                "
              >
                <span class="font-mono truncate">{{ t.name }}</span>
                <span class="text-[10px] text-slate-400 shrink-0">
                  {{ t.columns.length }} cols
                </span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      <!-- Mermaid ERD Code Mode -->
      <div
        v-else-if="schema && viewMode === 'mermaid'"
        class="flex-1 p-6 overflow-y-auto bg-slate-950 space-y-3"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold uppercase tracking-wider text-fuchsia-400">
            Código Mermaid `erDiagram` Generado Automáticamente
          </span>
          <button
            @click="copyText(schema.mermaidCode, 'Mermaid erDiagram copiado al portapapeles')"
            class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
          >
            <i class="fa-regular fa-copy mr-1"></i> Copiar Mermaid
          </button>
        </div>
        <pre
          class="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed"
        >{{ schema.mermaidCode }}</pre>
      </div>
    </div>
  </div>
</template>
