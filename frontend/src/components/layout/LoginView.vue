<script setup lang="ts">
import { ref } from 'vue';
import { panelStore, toggleTheme } from '../../composables/usePanelStore';

const emit = defineEmits<{
  (e: 'login-success'): void;
}>();

const username = ref('superadmin');
const password = ref('');
const errorMsg = ref('');
const loading = ref(false);

async function handleSubmit(): Promise<void> {
  errorMsg.value = '';
  loading.value = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value.trim(),
        password: password.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error de autenticación');
    }
    panelStore.authToken = data.token;
    localStorage.setItem('alpanel_token', data.token);
    localStorage.removeItem('sm_panel_token');
    password.value = '';
    emit('login-success');
  } catch (err: any) {
    errorMsg.value = err.message || 'Credenciales inválidas';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div
      class="w-full max-w-md sylva-sidebar rounded-3xl p-8 backdrop-blur-xl space-y-6"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-2">
          <div class="flex items-center gap-2.5">
            <div
              class="w-10 h-10 rounded-xl bg-[#B9F249] text-[#11150D] flex items-center justify-center text-lg font-extrabold shadow-lg shadow-[#B9F249]/25"
            >
              <i class="fa-solid fa-bolt"></i>
            </div>
            <div>
              <span class="font-bold text-base text-white tracking-tight">
                ALpanel
              </span>
              <span class="ml-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                CLOUD
              </span>
            </div>
          </div>

          <div>
            <h1 class="font-editorial text-3xl text-white leading-tight">
              Acceso al Clúster
            </h1>
            <div class="h-[3px] w-28 rounded-full bg-[#B9F249] mt-1"></div>
          </div>
        </div>

        <button
          type="button"
          @click="toggleTheme"
          class="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold transition flex items-center gap-1.5 shrink-0"
          :class="panelStore.theme === 'light' ? 'text-amber-500' : 'text-[#B9F249]'"
        >
          <i class="fa-solid" :class="panelStore.theme === 'light' ? 'fa-sun' : 'fa-moon'"></i>
          <span>{{ panelStore.theme === 'light' ? 'Día' : 'Noche' }}</span>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            Usuario
          </label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#B9F249]"
          />
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            Contraseña
          </label>
          <input
            v-model="password"
            type="password"
            placeholder="••••••••••••"
            required
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#B9F249]"
          />
        </div>
        <div
          v-if="errorMsg"
          class="text-xs text-rose-400 bg-rose-950/50 border border-rose-800 rounded-xl p-3"
        >
          {{ errorMsg }}
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full sylva-lime-btn py-3 rounded-full text-sm disabled:opacity-60"
        >
          <i class="fa-solid fa-arrow-right-to-bracket mr-2"></i>
          {{ loading ? 'Autenticando...' : 'Ingresar a ALpanel' }}
        </button>
      </form>
    </div>
  </div>
</template>
