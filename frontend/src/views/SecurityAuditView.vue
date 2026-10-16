<script setup lang="ts">
import { loadAuditLogs, panelStore } from '../composables/usePanelStore';
</script>

<template>
  <section class="space-y-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-base font-bold text-white">
            <i class="fa-solid fa-shield-halved text-indigo-400 mr-2"></i>Registro de Auditoría y
            Seguridad (Prisma ORM)
          </h3>
          <p class="text-xs text-slate-400">
            Historial de acciones ejecutadas en el servidor (sin almacenar contraseñas ni secretos).
          </p>
        </div>
        <button
          @click="loadAuditLogs"
          class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
        >
          <i class="fa-solid fa-rotate mr-1"></i>Actualizar
        </button>
      </div>

      <div v-if="panelStore.auditLogs.length === 0" class="text-slate-500 text-xs">
        Sin eventos registrados todavía.
      </div>

      <div v-else class="space-y-2 text-xs">
        <div
          v-for="(l, idx) in panelStore.auditLogs"
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
