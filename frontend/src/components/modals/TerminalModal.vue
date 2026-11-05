<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { apiFetch, panelStore } from '../../composables/usePanelStore';
import type { TerminalExecResult } from '../../types/panel';

interface TerminalHistoryEntry {
  id: number;
  prompt: string;
  command: string;
  output: string;
  success: boolean;
  durationMs: number;
}

const targetType = ref<'container' | 'host' | 'sql'>('container');
const selectedContainer = ref('');
const selectedDatabase = ref('');
const currentCwd = ref('');
const commandInput = ref('');
const executing = ref(false);
const entries = ref<TerminalHistoryEntry[]>([]);
const commandHistory = ref<string[]>([]);
const historyCursor = ref(-1);
const terminalScrollRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

const project = computed(() =>
  panelStore.projects.find((p) => p.name === panelStore.modals.terminal.projectName)
);

const containers = computed(() => project.value?.containers || []);
const availableDatabases = computed(
  () => project.value?.database?.availableDatabases || []
);

function isSqlDbContainer(containerName: string): boolean {
  const c = containers.value.find((item) => item.name === containerName);
  if (!c) return false;
  return (
    c.role === 'database' &&
    !/redis/i.test(c.image) &&
    !/redis/i.test(c.name)
  );
}

const isPostgresTarget = computed(() => {
  const c = containers.value.find((item) => item.name === selectedContainer.value);
  if (c && /postgres/i.test(c.image)) return true;
  return Boolean(project.value?.database?.engine.toLowerCase().includes('postgres'));
});

const activeDbName = computed(
  () => selectedDatabase.value || project.value?.database?.database || 'app_db'
);

const activePrompt = computed(() => {
  if (targetType.value === 'sql') {
    const engineTag = isPostgresTarget.value ? 'postgres' : 'mariadb';
    return `${engineTag}@${selectedContainer.value || 'db'} [${activeDbName.value}]>`;
  }
  const target =
    targetType.value === 'container'
      ? selectedContainer.value || 'container'
      : `${panelStore.modals.terminal.projectName}@host`;
  const dir = currentCwd.value || (targetType.value === 'container' ? '/app' : '.');
  return `root@${target}:${dir}#`;
});

const quickCommands = computed(() => {
  if (targetType.value === 'sql') {
    if (isPostgresTarget.value) {
      return [
        { label: '\\dt (Tablas)', cmd: '\\dt' },
        {
          label: 'Esquema público',
          cmd: "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;",
        },
        { label: 'Versión & DB', cmd: 'SELECT current_database(), version();' },
        {
          label: 'Conexiones activas',
          cmd: 'SELECT pid, usename, state, query FROM pg_stat_activity;',
        },
        { label: 'Limpiar', cmd: 'clear' },
      ];
    }
    return [
      { label: 'SHOW TABLES;', cmd: 'SHOW TABLES;' },
      { label: 'SHOW TABLE STATUS;', cmd: 'SHOW TABLE STATUS;' },
      { label: 'SELECT DATABASE(), VERSION();', cmd: 'SELECT DATABASE(), VERSION();' },
      { label: 'SHOW PROCESSLIST;', cmd: 'SHOW FULL PROCESSLIST;' },
      { label: 'Limpiar', cmd: 'clear' },
    ];
  }
  return [
    { label: 'ls -la', cmd: 'ls -la' },
    { label: 'pwd', cmd: 'pwd' },
    { label: 'ps aux', cmd: 'ps aux' },
    { label: 'df -h', cmd: 'df -h' },
    { label: 'git status', cmd: 'git status -s' },
    { label: 'Limpiar', cmd: 'clear' },
  ];
});

function buildWelcomeEntry(): TerminalHistoryEntry {
  if (targetType.value === 'sql') {
    const engineLabel =
      project.value?.database?.engine ||
      (isPostgresTarget.value ? 'PostgreSQL' : 'MariaDB / MySQL');
    return {
      id: Date.now(),
      prompt: activePrompt.value,
      command: '-- Conexión SQL directa activa',
      output: `Consola SQL Interactiva conectada a "${selectedContainer.value}" (${engineLabel} • Base de datos: ${activeDbName.value}).\nEscribe cualquier sentencia SQL (ej. SHOW TABLES;, SELECT * FROM users LIMIT 10;, DESCRIBE tabla;) y presiona Enter.`,
      success: true,
      durationMs: 0,
    };
  }
  return {
    id: Date.now(),
    prompt: 'alpanel@terminal:~#',
    command: 'welcome',
    output: `Terminal Interactiva conectada al proyecto "${panelStore.modals.terminal.projectName}".\nEscribe cualquier comando (ej. ls -la, php -v, npm list, python3 --version) o usa las flechas ↑/↓ para navegar el historial.`,
    success: true,
    durationMs: 0,
  };
}

function scrollToBottom(): void {
  nextTick(() => {
    if (terminalScrollRef.value) {
      terminalScrollRef.value.scrollTop = terminalScrollRef.value.scrollHeight;
    }
  });
}

watch(
  () => panelStore.modals.terminal.open,
  (isOpen) => {
    if (isOpen) {
      const prefCont = panelStore.modals.terminal.containerName;
      const prefMode = panelStore.modals.terminal.mode;
      const prefDb = panelStore.modals.terminal.databaseName;
      const list = containers.value;

      selectedDatabase.value =
        prefDb || project.value?.database?.database || '';

      if (prefCont && list.some((c) => c.name === prefCont)) {
        selectedContainer.value = prefCont;
        if (prefMode === 'sql' || isSqlDbContainer(prefCont)) {
          targetType.value = 'sql';
        } else {
          targetType.value = 'container';
        }
      } else if (prefMode === 'sql') {
        const dbCont = list.find((c) => isSqlDbContainer(c.name));
        selectedContainer.value =
          dbCont?.name || project.value?.database?.containerName || '';
        targetType.value = 'sql';
      } else if (list.length > 0) {
        const backend =
          list.find((c) => c.role === 'backend') ||
          list.find((c) => c.role !== 'database') ||
          list[0];
        selectedContainer.value = backend.name;
        targetType.value = isSqlDbContainer(backend.name) ? 'sql' : 'container';
      } else {
        targetType.value = 'host';
        selectedContainer.value = '';
      }

      currentCwd.value = '';
      entries.value = [buildWelcomeEntry()];
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  }
);

function handleTargetChange(): void {
  currentCwd.value = '';
  if (targetType.value === 'sql' && !isSqlDbContainer(selectedContainer.value)) {
    const dbCont = containers.value.find((c) => isSqlDbContainer(c.name));
    if (dbCont) {
      selectedContainer.value = dbCont.name;
    }
  }
  entries.value = [buildWelcomeEntry()];
}

function handleContainerChange(): void {
  currentCwd.value = '';
  if (isSqlDbContainer(selectedContainer.value)) {
    targetType.value = 'sql';
  } else if (targetType.value === 'sql') {
    targetType.value = 'container';
  }
  entries.value = [buildWelcomeEntry()];
}

function handleDatabaseChange(): void {
  entries.value = [buildWelcomeEntry()];
}

async function runCommand(customCmd?: string): Promise<void> {
  const cmd = (customCmd !== undefined ? customCmd : commandInput.value).trim();
  if (!cmd || executing.value) return;

  if (cmd === 'clear' || cmd === 'cls') {
    entries.value = [];
    commandInput.value = '';
    return;
  }

  const projName = panelStore.modals.terminal.projectName;
  if (!projName) return;

  const promptSnapshot = activePrompt.value;
  commandHistory.value.push(cmd);
  historyCursor.value = commandHistory.value.length;
  if (customCmd === undefined) {
    commandInput.value = '';
  }

  executing.value = true;
  try {
    const res = await apiFetch<TerminalExecResult>(
      `/api/projects/${encodeURIComponent(projName)}/terminal`,
      {
        method: 'POST',
        body: JSON.stringify({
          targetType: targetType.value,
          containerName: selectedContainer.value,
          command: cmd,
          cwd:
            targetType.value === 'sql'
              ? activeDbName.value
              : currentCwd.value || undefined,
        }),
      }
    );

    if (res.cwd && targetType.value !== 'sql') {
      currentCwd.value = res.cwd;
    }

    entries.value.push({
      id: Date.now() + Math.random(),
      prompt: promptSnapshot,
      command: cmd,
      output: res.output || '(sin salida)',
      success: res.success,
      durationMs: res.durationMs,
    });
  } catch (err: any) {
    entries.value.push({
      id: Date.now() + Math.random(),
      prompt: promptSnapshot,
      command: cmd,
      output: `❌ Error: ${err.message}`,
      success: false,
      durationMs: 0,
    });
  } finally {
    executing.value = false;
    scrollToBottom();
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (commandHistory.value.length === 0) return;
    if (historyCursor.value > 0) {
      historyCursor.value--;
    }
    commandInput.value = commandHistory.value[historyCursor.value] || '';
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyCursor.value < commandHistory.value.length - 1) {
      historyCursor.value++;
    }
    commandInput.value = commandHistory.value[historyCursor.value] || '';
    if (historyCursor.value >= commandHistory.value.length) {
      commandInput.value = '';
    }
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    entries.value = [];
  }
}

function close(): void {
  panelStore.modals.terminal.open = false;
}
</script>

<template>
  <div
    v-if="panelStore.modals.terminal.open"
    class="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
    @click.self="close"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full h-[82vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <!-- Header -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-800 bg-slate-950"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center"
            :class="
              targetType === 'sql'
                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
            "
          >
            <i
              class="fa-solid"
              :class="targetType === 'sql' ? 'fa-database' : 'fa-terminal'"
            ></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <span>
                {{
                  targetType === 'sql'
                    ? `Terminal SQL Interactiva — ${panelStore.modals.terminal.projectName}`
                    : `Terminal Interactiva — ${panelStore.modals.terminal.projectName}`
                }}
              </span>
              <span
                v-if="targetType === 'sql'"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"
              >
                {{ project?.database?.engine || (isPostgresTarget ? 'PostgreSQL' : 'MariaDB / MySQL') }}
              </span>
            </h3>
            <p class="text-[11px] text-slate-400 font-mono">
              {{ activePrompt }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <select
            v-model="targetType"
            @change="handleTargetChange"
            class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
          >
            <option
              v-if="project?.database?.hasDatabase || containers.some((c) => isSqlDbContainer(c.name))"
              value="sql"
            >
              Consola SQL (Motor DB)
            </option>
            <option value="container" :disabled="containers.length === 0">
              Shell Contenedor Docker
            </option>
            <option value="host">Carpeta Host (/opt/projects)</option>
          </select>

          <select
            v-if="targetType === 'container' || targetType === 'sql'"
            v-model="selectedContainer"
            @change="handleContainerChange"
            class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none"
            :class="
              targetType === 'sql'
                ? 'text-amber-300 focus:border-amber-500'
                : 'text-emerald-300 focus:border-emerald-500'
            "
          >
            <option v-for="c in containers" :key="c.name" :value="c.name">
              {{ c.name }} ({{ c.role === 'database' ? 'DB SQL' : c.role }})
            </option>
          </select>

          <select
            v-if="targetType === 'sql' && availableDatabases.length > 0"
            v-model="selectedDatabase"
            @change="handleDatabaseChange"
            class="bg-slate-900 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 font-mono focus:outline-none focus:border-amber-400"
            title="Seleccionar base de datos activa para las consultas SQL"
          >
            <option v-for="db in availableDatabases" :key="db" :value="db">
              🗄️ {{ db }}
            </option>
          </select>

          <button
            @click="close"
            class="text-slate-400 hover:text-white px-2 py-1 rounded-lg"
          >
            <i class="fa-solid fa-xmark text-base"></i>
          </button>
        </div>
      </div>

      <!-- Quick Commands Strip -->
      <div
        class="px-5 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]"
      >
        <span class="text-slate-400 mr-1">
          {{ targetType === 'sql' ? 'Consultas SQL rápidas:' : 'Comandos rápidos:' }}
        </span>
        <button
          v-for="q in quickCommands"
          :key="q.label"
          type="button"
          @click="runCommand(q.cmd)"
          class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono transition"
        >
          {{ q.label }}
        </button>
      </div>

      <!-- Terminal Output Stream -->
      <div
        ref="terminalScrollRef"
        class="flex-1 p-5 overflow-y-auto font-mono text-xs space-y-3 bg-[#090D16] text-slate-200 scrollbar-thin"
        @click="inputRef?.focus()"
      >
        <div v-for="item in entries" :key="item.id" class="space-y-1">
          <div
            class="flex items-center gap-2"
            :class="targetType === 'sql' ? 'text-amber-400' : 'text-emerald-400'"
          >
            <span class="font-bold select-none">{{ item.prompt }}</span>
            <span class="text-white font-semibold">{{ item.command }}</span>
            <span v-if="item.durationMs > 0" class="text-[10px] text-slate-500 ml-auto">
              {{ item.durationMs }}ms
            </span>
          </div>
          <pre
            class="whitespace-pre-wrap break-words pl-2 border-l-2 leading-relaxed"
            :class="
              item.success
                ? 'border-slate-800 text-slate-300'
                : 'border-rose-500/60 text-rose-300'
            "
          >{{ item.output }}</pre>
        </div>

        <div v-if="executing" class="flex items-center gap-2 text-amber-400 animate-pulse">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>
            {{
              targetType === 'sql'
                ? `Ejecutando sentencia SQL en ${selectedContainer}...`
                : `Ejecutando comando en ${targetType === 'container' ? selectedContainer : 'host'}...`
            }}
          </span>
        </div>
      </div>

      <!-- Command Input Bar -->
      <form
        @submit.prevent="runCommand()"
        class="flex items-center gap-2 px-4 py-3 bg-slate-950 border-t border-slate-800 font-mono text-xs"
      >
        <span
          class="font-bold shrink-0 select-none"
          :class="targetType === 'sql' ? 'text-amber-400' : 'text-emerald-400'"
        >
          {{ activePrompt }}
        </span>
        <input
          ref="inputRef"
          v-model="commandInput"
          type="text"
          :disabled="executing"
          @keydown="handleKeyDown"
          :placeholder="
            targetType === 'sql'
              ? 'Escribe una sentencia SQL (ej. SHOW TABLES;, SELECT * FROM users LIMIT 10;) y presiona Enter...'
              : 'Escribe un comando (ej. ls -la, cd .., php artisan migrate) y presiona Enter...'
          "
          class="flex-1 bg-transparent text-white focus:outline-none"
        />
        <button
          type="submit"
          :disabled="executing || !commandInput.trim()"
          class="px-3.5 py-1.5 rounded-lg disabled:opacity-40 text-white font-sans font-semibold text-xs transition flex items-center gap-1.5"
          :class="
            targetType === 'sql'
              ? 'bg-amber-600 hover:bg-amber-500'
              : 'bg-emerald-600 hover:bg-emerald-500'
          "
        >
          <i class="fa-solid fa-paper-plane"></i>
          {{ targetType === 'sql' ? 'Ejecutar SQL' : 'Ejecutar' }}
        </button>
      </form>
    </div>
  </div>
</template>
