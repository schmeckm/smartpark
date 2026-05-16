import type { RouteRecordRaw } from 'vue-router'
import { ROLE_CODES } from '@/constants/rbac'

/**
 * F2-MVP · Admin domain.
 *
 * The MVP demotes Integrations · Governance · Platform · Audit · Help ·
 * Settings · Diagnostics into a single `Admin` bucket. The legacy URLs keep
 * resolving (operators sometimes follow saved bookmarks); the `/admin/*`
 * MVP namespace is added on top.
 */
export const adminRoutes: RouteRecordRaw[] = [
  // ── Legacy URLs (kept verbatim) ────────────────────────────────────────
  {
    path: 'audit',
    name: 'audit',
    component: () => import('@/views/AuditLogsView.vue'),
    meta: {
      title: 'Audit log',
      domain: 'admin',
      permission: { resource: 'audit', action: 'read' },
    },
  },
  {
    path: 'import',
    name: 'import',
    component: () => import('@/views/ImportView.vue'),
    meta: { title: 'Import', domain: 'admin', permission: { resource: 'import', action: 'create' } },
  },
  {
    path: 'simulator',
    name: 'simulator',
    component: () => import('@/views/SimulatorView.vue'),
    meta: {
      title: 'Simulator',
      domain: 'admin',
      permissionsAny: [
        { resource: 'iotOt', action: 'settings.read' },
        { resource: 'simulator', action: 'run' },
      ],
    },
  },
  {
    path: 'help',
    name: 'help',
    component: () => import('@/views/help/HelpHubView.vue'),
    meta: { title: 'Help', titleKey: 'help.title' },
  },
  {
    path: 'settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: 'Settings', titleKey: 'settings.title' },
  },
  {
    path: 'admin/platform-settings',
    name: 'platform-settings',
    component: () => import('@/views/admin/PlatformSettingsView.vue'),
    meta: {
      title: 'Platform settings',
      domain: 'admin',
      roles: [ROLE_CODES.SYSTEM_ADMIN],
    },
  },
  {
    path: 'admin/users',
    name: 'user-management',
    component: () => import('@/views/admin/UserManagementView.vue'),
    meta: {
      title: 'User management',
      titleKey: 'userManagement.title',
      domain: 'admin',
      roles: [ROLE_CODES.SYSTEM_ADMIN],
    },
  },
  {
    path: 'admin/integration-flow-studio',
    name: 'integration-flow-studio',
    component: () => import('@/views/admin/IntegrationFlowStudioView.vue'),
    meta: {
      title: 'Integration Flow Studio',
      titleKey: 'integrationFlowStudio.title',
      domain: 'admin',
      permission: { resource: 'integrations', action: 'read' },
    },
  },
  {
    path: 'admin/widget-runtime-studio',
    name: 'widget-runtime-studio',
    component: () => import('@/views/admin/WidgetRuntimeStudioView.vue'),
    meta: {
      title: 'Widget Runtime Studio',
      titleKey: 'widgetRuntimeStudio.title',
      domain: 'admin',
      permission: { resource: 'integrations', action: 'read' },
    },
  },
  {
    path: 'integrations',
    name: 'integrations',
    component: () => import('@/views/IntegrationSettingsView.vue'),
    meta: { title: 'Integrations', domain: 'admin', permission: { resource: 'integrations', action: 'read' } },
  },
  {
    path: 'integrations/adapters',
    redirect: '/settings/devices-services',
  },
  {
    path: 'settings/devices-services',
    name: 'devices-services',
    component: () => import('@/views/settings/DevicesServicesView.vue'),
    meta: {
      title: 'Adapter',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
    },
  },
  {
    path: 'settings/devices-services/integrations/:id',
    name: 'integration-detail',
    component: () => import('@/views/settings/IntegrationDetailView.vue'),
    meta: {
      title: 'Integration',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
    },
  },
  {
    path: 'settings/adapter-pipeline-log',
    name: 'adapter-pipeline-log',
    component: () => import('@/views/settings/AdapterPipelineLogView.vue'),
    meta: {
      title: 'Adapter operations center',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
    },
  },

  // ── F2-MVP namespace (`/admin/*`) ──────────────────────────────────────
  { path: 'admin', name: 'mvp-admin', redirect: { name: 'platform-settings' }, meta: { domain: 'admin' } },
  { path: 'admin/users/audit', name: 'mvp-admin-audit', redirect: { name: 'audit' }, meta: { domain: 'admin' } },
  { path: 'admin/integrations', name: 'mvp-admin-integrations', redirect: { name: 'integrations' }, meta: { domain: 'admin' } },
  { path: 'admin/integrations/installed', name: 'mvp-admin-integrations-installed', redirect: { name: 'devices-services' }, meta: { domain: 'admin' } },
  { path: 'admin/integrations/pipeline', name: 'mvp-admin-integrations-pipeline', redirect: { name: 'adapter-pipeline-log' }, meta: { domain: 'admin' } },
  { path: 'admin/governance', name: 'mvp-admin-governance', redirect: { name: 'diagnostics-governance' }, meta: { domain: 'admin' } },
  { path: 'admin/platform', name: 'mvp-admin-platform', redirect: { name: 'platform-settings' }, meta: { domain: 'admin' } },
  { path: 'admin/platform/import', name: 'mvp-admin-import', redirect: { name: 'import' }, meta: { domain: 'admin' } },
  { path: 'admin/diagnostics', name: 'mvp-admin-diagnostics', redirect: '/diagnostics/sparkplug', meta: { domain: 'admin' } },
  { path: 'admin/diagnostics/registry', name: 'mvp-admin-diagnostics-registry', redirect: { name: 'diagnostics-registry-mirror' }, meta: { domain: 'admin' } },
  { path: 'admin/diagnostics/sparkplug', name: 'mvp-admin-diagnostics-sparkplug', redirect: { name: 'diagnostics-sparkplug' }, meta: { domain: 'admin' } },
  { path: 'admin/diagnostics/wave2', name: 'mvp-admin-diagnostics-wave2', redirect: { name: 'diagnostics-sparkplug' }, meta: { domain: 'admin' } },
  { path: 'admin/diagnostics/simulator', name: 'mvp-admin-diagnostics-simulator', redirect: { name: 'simulator' }, meta: { domain: 'admin' } },
]
