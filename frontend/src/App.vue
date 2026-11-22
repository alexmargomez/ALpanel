<script setup lang="ts">
import { onMounted } from 'vue';
import {
  apiFetch,
  applyTheme,
  hasPerm,
  loadAuditLogs,
  loadDomains,
  panelStore,
  refreshAll,
  registerUnauthorizedHandler,
  switchTab,
} from './composables/usePanelStore';
import { connectRealtime, disconnectRealtime } from './composables/useSocket';
import type { PanelTab, UserItem } from './types/panel';

import LoginView from './components/layout/LoginView.vue';
import SidebarNav from './components/layout/SidebarNav.vue';
import TopHeader from './components/layout/TopHeader.vue';
import ToastNotification from './components/layout/ToastNotification.vue';

import OverviewView from './views/OverviewView.vue';
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
import CronjobsModal from './components/modals/CronjobsModal.vue';
import TerminalModal from './components/modals/TerminalModal.vue';
import DbErdModal from './components/modals/DbErdModal.vue';
import MicroservicesModal from './components/modals/MicroservicesModal.vue';

function logout(): void {
  panelStore.authToken = '';
  panelStore.currentUser = null;
  localStorage.removeItem('alpanel_token');
  localStorage.removeItem('sm_panel_token');
  localStorage.removeItem('alpanel_cached_user');
  disconnectRealtime();
}

async function bootstrapSession(): Promise<void> {
  if (!panelStore.authToken) {
    logout();
    return;
  }
  panelStore.loadingProjects = true;
  connectRealtime();

  try {
    const mePromise = apiFetch<{ user: UserItem }>('/api/auth/me');
    const projectsPromise = apiFetch<{
      host: any;
      projectsRoot: string;
      projects: any[];
    }>('/api/projects').catch(() => null);

    const [meRes, projRes] = await Promise.all([mePromise, projectsPromise]);
    panelStore.currentUser = meRes.user;
    try {
      localStorage.setItem('alpanel_cached_user', JSON.stringify(meRes.user));
    } catch {
      // Ignore storage quota errors
    }

    if (hasPerm('projects', 'view')) {
      panelStore.activeTab = 'overview';
      if (projRes) {
        if (projRes.host) panelStore.host = projRes.host;
        if (projRes.projectsRoot) panelStore.projectsRoot = projRes.projectsRoot;
        panelStore.projects = projRes.projects || [];
        panelStore.loadingProjects = false;
      } else {
        await refreshAll();
      }
      if (hasPerm('domains', 'view')) {
        loadDomains().catch(() => {});
      }
      if (hasPerm('security', 'view')) {
        loadAuditLogs().catch(() => {});
      }
    } else {
      panelStore.loadingProjects = false;
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
  } catch {
    logout();
  }
}

onMounted(() => {
  applyTheme();
  registerUnauthorizedHandler(logout);
  bootstrapSession();
});
</script>

<template>
  <LoginView v-if="!panelStore.currentUser" @login-success="bootstrapSession" />

  <div
    v-else
    class="min-h-screen w-full flex gap-3.5 p-2.5 sm:p-3 max-w-[1640px] mx-auto"
  >
    <!-- Barra Lateral Colapsable / Rail Izquierdo (Estilo Sylva) -->
    <SidebarNav @logout="logout" />

    <!-- Área Principal de Contenido -->
    <div class="flex-1 min-w-0 flex flex-col gap-4 px-1 sm:px-2">
      <TopHeader @logout="logout" />

      <main class="flex-1 space-y-5">
        <OverviewView v-if="panelStore.activeTab === 'overview'" />
        <ProjectsView v-else-if="panelStore.activeTab === 'projects'" />
        <DomainsView v-else-if="panelStore.activeTab === 'domains'" />
        <GitGuideView v-else-if="panelStore.activeTab === 'guide'" />
        <UsersRolesView v-else-if="panelStore.activeTab === 'users'" />
        <PermissionsView v-else-if="panelStore.activeTab === 'permissions'" />
        <SecurityAuditView v-else-if="panelStore.activeTab === 'audit'" />
      </main>
    </div>

    <!-- Modales Reactivos del Sistema -->
    <DbCredentialsModal />
    <ConsoleLogsModal />
    <EnvEditorModal />
    <CloneProjectModal />
    <UserModal />
    <RoleModal />
    <AppUsersModal />
    <CronjobsModal />
    <TerminalModal />
    <DbErdModal />
    <MicroservicesModal />
  </div>

  <ToastNotification />
</template>
