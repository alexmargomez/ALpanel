<script setup lang="ts">
import { onMounted } from 'vue';
import {
  apiFetch,
  hasPerm,
  panelStore,
  refreshAll,
  registerUnauthorizedHandler,
  switchTab,
} from './composables/usePanelStore';
import { connectRealtime, disconnectRealtime } from './composables/useSocket';
import type { PanelTab, UserItem } from './types/panel';

import LoginView from './components/layout/LoginView.vue';
import TopHeader from './components/layout/TopHeader.vue';
import ToastNotification from './components/layout/ToastNotification.vue';

import ProjectsView from './views/ProjectsView.vue';
import DomainsView from './views/DomainsView.vue';
import GitGuideView from './views/GitGuideView.vue';
import UsersRolesView from './views/UsersRolesView.vue';
import PermissionsView from './views/PermissionsView.vue';
import SecurityAuditView from './views/SecurityAuditView.vue';

import DbCredentialsModal from './components/modals/DbCredentialsModal.vue';
import ConsoleLogsModal from './components/modals/ConsoleLogsModal.vue';
import EnvEditorModal from './components/modals/EnvEditorModal.vue';
import CloneProjectModal from './components/modals/CloneProjectModal.vue';
import UserModal from './components/modals/UserModal.vue';
import RoleModal from './components/modals/RoleModal.vue';
import AppUsersModal from './components/modals/AppUsersModal.vue';

function logout(): void {
  panelStore.authToken = '';
  panelStore.currentUser = null;
  localStorage.removeItem('alpanel_token');
  localStorage.removeItem('sm_panel_token');
  disconnectRealtime();
}

async function bootstrapSession(): Promise<void> {
  if (!panelStore.authToken) {
    logout();
    return;
  }
  try {
    const meRes = await apiFetch<{ user: UserItem }>('/api/auth/me');
    panelStore.currentUser = meRes.user;

    if (hasPerm('projects', 'view')) {
      panelStore.activeTab = 'projects';
      await refreshAll();
    } else {
      const fallbackOrder: Array<{ tab: PanelTab; mod: string }> = [
        { tab: 'domains', mod: 'domains' },
        { tab: 'guide', mod: 'git' },
        { tab: 'users', mod: 'users' },
        { tab: 'audit', mod: 'security' },
      ];
      const firstAllowed = fallbackOrder.find((f) => hasPerm(f.mod, 'view'));
      if (firstAllowed) {
        await switchTab(firstAllowed.tab);
      }
    }
    connectRealtime();
  } catch {
    logout();
  }
}

onMounted(() => {
  registerUnauthorizedHandler(logout);
  bootstrapSession();
});
</script>

<template>
  <LoginView v-if="!panelStore.currentUser" @login-success="bootstrapSession" />

  <div v-else class="flex-1 flex flex-col min-h-screen">
    <TopHeader @logout="logout" />

    <main class="max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex-1 space-y-5">
      <ProjectsView v-if="panelStore.activeTab === 'projects'" />
      <DomainsView v-else-if="panelStore.activeTab === 'domains'" />
      <GitGuideView v-else-if="panelStore.activeTab === 'guide'" />
      <UsersRolesView v-else-if="panelStore.activeTab === 'users'" />
      <PermissionsView v-else-if="panelStore.activeTab === 'permissions'" />
      <SecurityAuditView v-else-if="panelStore.activeTab === 'audit'" />
    </main>

    <!-- Modales Reactivos del Sistema -->
    <DbCredentialsModal />
    <ConsoleLogsModal />
    <EnvEditorModal />
    <CloneProjectModal />
    <UserModal />
    <RoleModal />
    <AppUsersModal />
  </div>

  <ToastNotification />
</template>
