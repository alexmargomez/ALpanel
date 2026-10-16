<script setup lang="ts">
import { computed } from 'vue';
import { getCatalog } from '../../composables/usePanelStore';

const props = defineProps<{
  modelValue: Record<string, boolean>;
  locked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, boolean>): void;
}>();

const catalog = computed(() => getCatalog());

function toggleModule(modCode: string, services: Array<{ code: string }>): void {
  if (props.locked) return;
  const nextMap = { ...props.modelValue };
  const nextState = !nextMap[modCode];
  nextMap[modCode] = nextState;

  if (!nextState) {
    for (const svc of services) {
      nextMap[svc.code] = false;
    }
  } else {
    const anyChecked = services.some((s) => Boolean(nextMap[s.code]));
    if (!anyChecked) {
      for (const svc of services) {
        nextMap[svc.code] = true;
      }
    }
  }
  emit('update:modelValue', nextMap);
}

function toggleService(svcCode: string, parentModCode?: string): void {
  if (props.locked) return;
  const nextMap = { ...props.modelValue };
  const nextState = !nextMap[svcCode];
  nextMap[svcCode] = nextState;

  if (nextState && parentModCode) {
    nextMap[parentModCode] = true;
  }
  emit('update:modelValue', nextMap);
}
</script>

<template>
  <div class="space-y-3">
    <!-- Módulos Principales y sus Sub-Servicios -->
    <div
      v-for="mod in catalog.modules"
      :key="mod.code"
      class="bg-slate-950/90 border rounded-xl p-3.5 space-y-2.5 transition"
      :class="modelValue[mod.code] ? 'border-indigo-500/40' : 'border-slate-800'"
    >
      <div
        class="flex flex-wrap items-center justify-between gap-2"
        :class="locked ? '' : 'cursor-pointer select-none'"
        @click="toggleModule(mod.code, mod.services)"
      >
        <div class="flex items-center gap-2.5">
          <input
            type="checkbox"
            :checked="Boolean(modelValue[mod.code])"
            :disabled="locked"
            @click.stop="toggleModule(mod.code, mod.services)"
            class="w-4 h-4 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
          />
          <div
            class="w-7 h-7 rounded-lg border flex items-center justify-center text-xs"
            :class="
              modelValue[mod.code]
                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            "
          >
            <i class="fa-solid" :class="mod.icon || 'fa-cube'"></i>
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-white text-xs sm:text-sm">{{ mod.name }}</span>
              <code
                class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-indigo-300 font-mono"
              >
                {{ mod.code }}
              </code>
              <span v-if="mod.services.length > 0" class="text-[10px] text-slate-400">
                ({{ mod.services.length }} sub-servicio{{ mod.services.length === 1 ? '' : 's' }})
              </span>
              <span
                v-else
                class="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px]"
              >
                Módulo Completo
              </span>
            </div>
            <p class="text-[11px] text-slate-400">{{ mod.description }}</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5"
            :class="
              modelValue[mod.code]
                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            "
          >
            <i
              class="fa-solid"
              :class="
                modelValue[mod.code] ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/70'
              "
            ></i>
            <span>{{ modelValue[mod.code] ? 'Módulo Activo' : 'Módulo Bloqueado' }}</span>
          </span>
        </div>
      </div>

      <!-- Sub-servicios del Módulo -->
      <div
        v-if="mod.services.length > 0"
        class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2.5 pl-2 sm:pl-6 border-t border-slate-800/70"
      >
        <div
          v-for="svc in mod.services"
          :key="svc.code"
          :title="svc.serviceFile || svc.code"
          @click="toggleService(svc.code, mod.code)"
          class="flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition"
          :class="[
            locked ? 'cursor-default' : 'cursor-pointer select-none hover:brightness-110',
            modelValue[mod.code] && modelValue[svc.code]
              ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-300 shadow-sm'
              : 'bg-slate-900/60 border-slate-800/90 text-slate-500',
          ]"
        >
          <span class="flex items-center gap-2 truncate pr-2">
            <i
              class="fa-solid w-4 text-center"
              :class="[
                svc.icon || 'fa-bolt',
                modelValue[mod.code] && modelValue[svc.code] ? 'text-emerald-400' : 'text-slate-600',
              ]"
            ></i>
            <span class="truncate font-medium">{{ svc.name }}</span>
          </span>
          <i
            class="fa-solid shrink-0 text-sm"
            :class="
              modelValue[mod.code] && modelValue[svc.code]
                ? 'fa-circle-check text-emerald-400'
                : 'fa-ban text-rose-500/60'
            "
          ></i>
        </div>
      </div>

      <div
        v-else
        class="pt-2 pl-2 sm:pl-6 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400"
      >
        <span>
          <i class="fa-solid fa-layer-group text-indigo-400 mr-1.5"></i>Sin sub-servicios en
          <code class="text-slate-300">src/services/{{ mod.code }}/</code> — El interruptor del
          módulo habilita el <strong>módulo completo</strong>.
        </span>
      </div>
    </div>

    <!-- Servicios Independientes (Fuera de Módulos) -->
    <div
      v-if="catalog.standaloneServices.length > 0"
      class="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <div
            class="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center text-xs"
          >
            <i class="fa-solid fa-puzzle-piece"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-white text-xs sm:text-sm">
                Servicios Independientes (Fuera de Módulos)
              </span>
              <code
                class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-amber-300 font-mono"
              >
                src/services/*.service.ts
              </code>
            </div>
            <p class="text-[11px] text-slate-400">
              Servicios transversales del servidor que no pertenecen a un módulo específico ni están
              en <code class="text-slate-300">permissions.ignore.json</code>.
            </p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/70">
        <div
          v-for="svc in catalog.standaloneServices"
          :key="svc.code"
          :title="svc.serviceFile || svc.code"
          @click="toggleService(svc.code)"
          class="flex items-center justify-between px-3 py-2 rounded-xl border text-xs transition"
          :class="[
            locked ? 'cursor-default' : 'cursor-pointer select-none hover:brightness-110',
            modelValue[svc.code]
              ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-300 shadow-sm'
              : 'bg-slate-900/60 border-slate-800/90 text-slate-500',
          ]"
        >
          <span class="flex items-center gap-2 truncate pr-2">
            <i
              class="fa-solid w-4 text-center"
              :class="[
                svc.icon || 'fa-bolt',
                modelValue[svc.code] ? 'text-emerald-400' : 'text-slate-600',
              ]"
            ></i>
            <span class="truncate font-medium">{{ svc.name }}</span>
          </span>
          <i
            class="fa-solid shrink-0 text-sm"
            :class="
              modelValue[svc.code] ? 'fa-circle-check text-emerald-400' : 'fa-ban text-rose-500/60'
            "
          ></i>
        </div>
      </div>
    </div>
  </div>
</template>
