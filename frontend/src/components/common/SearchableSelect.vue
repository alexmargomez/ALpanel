<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

export interface Select2Option {
  value: string | number;
  label: string;
  sublabel?: string;
  badge?: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number;
    options: Select2Option[];
    placeholder?: string;
    searchPlaceholder?: string;
    disabled?: boolean;
    required?: boolean;
    allowCustom?: boolean;
    size?: 'xs' | 'sm' | 'md';
    mono?: boolean;
    accent?: 'indigo' | 'emerald' | 'amber' | 'teal' | 'fuchsia';
    minDropdownWidth?: number;
  }>(),
  {
    placeholder: 'Seleccionar...',
    searchPlaceholder: 'Escribir para filtrar...',
    disabled: false,
    required: false,
    allowCustom: false,
    size: 'sm',
    mono: false,
    accent: 'indigo',
    minDropdownWidth: 240,
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void;
  (e: 'change', value: any): void;
}>();

const isOpen = ref(false);
const searchQuery = ref('');
const activeIndex = ref(0);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const dropdownStyle = ref<Record<string, string>>({
  top: '0px',
  left: '0px',
  width: '240px',
});

const selectedOption = computed<Select2Option | undefined>(() =>
  props.options.find((o) => String(o.value) === String(props.modelValue))
);

const displayLabel = computed(() => {
  if (selectedOption.value) return selectedOption.value.label;
  if (
    props.modelValue !== '' &&
    props.modelValue !== null &&
    props.modelValue !== undefined
  ) {
    return String(props.modelValue);
  }
  return '';
});

const filteredOptions = computed<Select2Option[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const matched = !q
    ? props.options
    : props.options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          String(o.value).toLowerCase().includes(q) ||
          (o.sublabel && o.sublabel.toLowerCase().includes(q)) ||
          (o.badge && o.badge.toLowerCase().includes(q))
      );

  if (props.allowCustom && q) {
    const rawTrimmed = searchQuery.value.trim();
    const exactExists = props.options.some(
      (o) => String(o.value).toLowerCase() === q
    );
    if (!exactExists) {
      return [
        ...matched,
        {
          value: rawTrimmed,
          label: rawTrimmed,
          sublabel: 'Usar destino personalizado',
          badge: 'CUSTOM',
        },
      ];
    }
  }

  return matched;
});

const sizeClasses = computed(() => {
  if (props.size === 'xs') {
    return 'px-2.5 py-1 text-[11px] rounded-lg';
  }
  if (props.size === 'md') {
    return 'px-3.5 py-2.5 text-xs rounded-xl';
  }
  return 'px-3 py-2 text-xs rounded-xl';
});

const accentBorderClass = computed(() => {
  const map: Record<string, string> = {
    indigo: 'border-indigo-500 ring-1 ring-indigo-500/30',
    emerald: 'border-emerald-500 ring-1 ring-emerald-500/30',
    amber: 'border-amber-500 ring-1 ring-amber-500/30',
    teal: 'border-teal-500 ring-1 ring-teal-500/30',
    fuchsia: 'border-fuchsia-500 ring-1 ring-fuchsia-500/30',
  };
  return map[props.accent] || map.indigo;
});

function updateDropdownPosition(): void {
  if (!triggerRef.value || !isOpen.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const estimatedHeight = 280;
  const spaceBelow = viewportH - rect.bottom;
  const openUpward = spaceBelow < estimatedHeight && rect.top > spaceBelow;

  const width = Math.min(
    Math.max(rect.width, props.minDropdownWidth),
    viewportW - 16
  );
  const left = Math.max(8, Math.min(rect.left, viewportW - width - 8));

  if (openUpward) {
    dropdownStyle.value = {
      bottom: `${viewportH - rect.top + 6}px`,
      top: 'auto',
      left: `${left}px`,
      width: `${width}px`,
    };
  } else {
    dropdownStyle.value = {
      top: `${rect.bottom + 6}px`,
      bottom: 'auto',
      left: `${left}px`,
      width: `${width}px`,
    };
  }
}

async function openDropdown(): Promise<void> {
  if (props.disabled) return;
  isOpen.value = true;
  searchQuery.value = '';
  const idx = filteredOptions.value.findIndex(
    (o) => String(o.value) === String(props.modelValue)
  );
  activeIndex.value = idx >= 0 ? idx : 0;
  updateDropdownPosition();
  await nextTick();
  updateDropdownPosition();
  searchInputRef.value?.focus();
}

function closeDropdown(): void {
  isOpen.value = false;
  searchQuery.value = '';
}

function toggleDropdown(): void {
  if (isOpen.value) closeDropdown();
  else openDropdown();
}

function selectItem(opt: Select2Option): void {
  if (opt.disabled) return;
  const changed = String(opt.value) !== String(props.modelValue);
  emit('update:modelValue', opt.value);
  if (changed) {
    emit('change', opt.value);
  }
  closeDropdown();
}

function clearSelection(e: MouseEvent): void {
  e.stopPropagation();
  if (props.disabled) return;
  emit('update:modelValue', '');
  emit('change', '');
}

function onKeyDown(e: KeyboardEvent): void {
  if (!isOpen.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDropdown();
    }
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    closeDropdown();
    return;
  }

  const list = filteredOptions.value;
  if (list.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + list.length) % list.length;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const candidate = list[activeIndex.value];
    if (candidate) {
      selectItem(candidate);
    }
  }
}

function handleOutsideClick(e: MouseEvent): void {
  if (!isOpen.value) return;
  const target = e.target as Node;
  if (
    triggerRef.value?.contains(target) ||
    dropdownRef.value?.contains(target)
  ) {
    return;
  }
  closeDropdown();
}

watch(searchQuery, () => {
  activeIndex.value = 0;
});

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  window.addEventListener('resize', updateDropdownPosition);
  window.addEventListener('scroll', updateDropdownPosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
  window.removeEventListener('resize', updateDropdownPosition);
  window.removeEventListener('scroll', updateDropdownPosition, true);
});
</script>

<template>
  <div class="relative w-full min-w-[140px]">
    <!-- Input oculto para validación nativa required en formularios -->
    <input
      v-if="required"
      type="text"
      :value="displayLabel"
      required
      tabindex="-1"
      aria-hidden="true"
      class="sr-only pointer-events-none absolute inset-0 opacity-0"
    />

    <button
      ref="triggerRef"
      type="button"
      :disabled="disabled"
      @click="toggleDropdown"
      @keydown="onKeyDown"
      class="w-full bg-slate-950 border flex items-center justify-between gap-2 text-left transition focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
      :class="[
        sizeClasses,
        mono ? 'font-mono' : '',
        isOpen ? accentBorderClass : 'border-slate-800 hover:border-slate-700',
      ]"
    >
      <span
        class="truncate flex-1"
        :class="displayLabel ? 'text-white font-medium' : 'text-slate-400'"
      >
        {{ displayLabel || placeholder }}
      </span>
      <span class="flex items-center gap-1.5 shrink-0">
        <i
          v-if="allowCustom && displayLabel && !disabled"
          @click="clearSelection"
          class="fa-solid fa-xmark text-[10px] text-slate-500 hover:text-rose-400 px-0.5 transition"
          title="Limpiar selección"
        ></i>
        <i
          class="fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-150"
          :class="{ 'rotate-180 text-indigo-400': isOpen }"
        ></i>
      </span>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="dropdownRef"
        :style="dropdownStyle"
        class="fixed z-[9999] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        @keydown="onKeyDown"
      >
        <!-- Buscador integrado estilo Select2 -->
        <div class="p-2 border-b border-slate-800 bg-slate-950/90">
          <div class="relative flex items-center">
            <i
              class="fa-solid fa-magnifying-glass text-[10px] text-slate-400 absolute left-2.5 pointer-events-none"
            ></i>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              :placeholder="
                allowCustom
                  ? 'Filtrar o escribir IP:puerto personalizado...'
                  : searchPlaceholder
              "
              class="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              v-if="searchQuery"
              type="button"
              @click="searchQuery = ''"
              class="absolute right-2 text-slate-400 hover:text-white text-[10px]"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        <!-- Lista de opciones -->
        <div class="max-h-64 overflow-y-auto scrollbar-thin py-1">
          <div
            v-if="filteredOptions.length === 0"
            class="px-3 py-3 text-center text-xs text-slate-400"
          >
            Sin resultados para "{{ searchQuery }}"
          </div>

          <button
            v-for="(opt, idx) in filteredOptions"
            :key="String(opt.value)"
            type="button"
            :disabled="opt.disabled"
            @mouseenter="activeIndex = idx"
            @click="selectItem(opt)"
            class="w-full px-3 py-2 text-xs flex items-center justify-between gap-2 text-left transition disabled:opacity-40 disabled:cursor-not-allowed"
            :class="[
              mono ? 'font-mono' : '',
              String(opt.value) === String(modelValue)
                ? 'bg-indigo-600/20 text-indigo-300 font-semibold'
                : idx === activeIndex
                ? 'bg-slate-800 text-white'
                : 'text-slate-200 hover:bg-slate-800',
            ]"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ opt.label }}</div>
              <div
                v-if="opt.sublabel"
                class="text-[10px] text-slate-400 font-normal truncate mt-0.5"
              >
                {{ opt.sublabel }}
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                v-if="opt.badge"
                class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-sans text-slate-400"
              >
                {{ opt.badge }}
              </span>
              <i
                v-if="String(opt.value) === String(modelValue)"
                class="fa-solid fa-check text-[10px] text-emerald-400"
              ></i>
            </div>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
