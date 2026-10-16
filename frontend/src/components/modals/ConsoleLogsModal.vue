<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  copyText,
  loadSelectedContainerLogs,
  panelStore,
} from '../../composables/usePanelStore';

const outputPre = ref<HTMLElement | null>(null);

const projectContainers = computed(() => {
  const proj = panelStore.projects.find(
    (p) => p.name === panelStore.modals.console.projectName
  );
  return proj?.containers || [];
});

watch(
  () => panelStore.modals.console.output,
  async () => {
    await nextTick();
    if (outputPre.value) {
      outputPre.value.scrollTop = outputPre.value.scrollHeight;
    }
  }
);

function close(): void {
  panelStore.modals.console.open = false;
}
</script>

<template>
  <div
    v-if="panelStore.modals.console.open"
    class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
  >
    <div
      class="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl flex flex-col max-h-[85vh]"
    >
      <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-terminal text-emerald-400"></i>
          <h3 class="text-sm font-bold text-white">{{ panelStore.modals.console.title }}</h3>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-if="panelStore.modals.console.showContainerSelect"
            v-model="panelStore.modals.console.selectedContainer"
            @change="loadSelectedContainerLogs"
            class="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white"
          >
            <option
              v-for="c in projectContainers"
              :key="c.name"
              :value="c.name"
            >
              {{ c.name }} ({{ c.role }})
            </option>
          </select>
          <button @click="close" class="text-slate-400 hover:text-white">
            <i class="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>
      </div>

      <pre
        ref="outputPre"
        class="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 overflow-auto scrollbar-thin whitespace-pre-wrap"
      >{{ panelStore.modals.console.output }}</pre>

      <div class="mt-4 flex justify-between items-center">
        <button
          @click="copyText(panelStore.modals.console.output, 'Salida copiada')"
          class="text-xs text-indigo-400 hover:underline"
        >
          <i class="fa-regular fa-copy mr-1"></i>Copiar salida
        </button>
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
