<script setup lang="ts">
import { panelStore } from '../../composables/usePanelStore';
</script>

<template>
  <div
    v-if="panelStore.toast.visible"
    class="fixed bottom-5 right-5 z-50 text-white px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 transition-all"
    :class="panelStore.toast.isError ? 'bg-rose-600' : 'bg-indigo-600'"
  >
    <i
      class="fa-solid"
      :class="panelStore.toast.isError ? 'fa-circle-exclamation' : 'fa-circle-check'"
    ></i>
    <span>{{ panelStore.toast.message }}</span>
  </div>
</template>
