<script setup lang="ts">
import { ref } from 'vue';
import { panelStore } from '../../composables/usePanelStore';

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
  <div
    class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950"
  >
    <div
      class="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl p-8 backdrop-blur"
    >
      <div class="flex items-center gap-3 mb-6">
        <div
          class="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-2xl"
        >
          <i class="fa-solid fa-bolt"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold text-white">ALpanel</h1>
          <p class="text-xs text-slate-400">Orquestador Modular • Vue 3 + TypeScript + Prisma ORM</p>
        </div>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Usuario
          </label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Contraseña
          </label>
          <input
            v-model="password"
            type="password"
            placeholder="••••••••••••"
            required
            class="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div
          v-if="errorMsg"
          class="text-xs text-rose-400 bg-rose-950/50 border border-rose-800 rounded-lg p-3"
        >
          {{ errorMsg }}
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-indigo-600/25"
        >
          <i class="fa-solid fa-right-to-bracket mr-2"></i>
          {{ loading ? 'Autenticando...' : 'Ingresar a ALpanel' }}
        </button>
      </form>
    </div>
  </div>
</template>
