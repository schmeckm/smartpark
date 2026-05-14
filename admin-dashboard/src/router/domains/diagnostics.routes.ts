import type { RouteRecordRaw } from 'vue-router'
import { ROLE_CODES } from '@/constants/rbac'

/**
 * Engineering diagnostics hub (`/diagnostics/*`).
 *
 * Mirrors `navigationGroups` entries in `shared/rbac.json`. Restricted to the
 * same roles as the manifest sidebar (`requiredRoles`).
 */
export const diagnosticsRoutes: RouteRecordRaw[] = [
  {
    path: 'diagnostics',
    redirect: '/diagnostics/sparkplug',
    meta: { domain: 'admin' },
  },
  {
    path: 'diagnostics/mqtt',
    name: 'diagnostics-mqtt',
    component: () => import('@/views/diagnostics/MqttInfrastructureView.vue'),
    meta: {
      titleKey: 'diagnostics.mqtt.title',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
      roles: [ROLE_CODES.SYSTEM_ADMIN, ROLE_CODES.ADMIN, ROLE_CODES.OPERATIONS_MANAGER],
    },
  },
  {
    path: 'diagnostics/sparkplug',
    name: 'diagnostics-sparkplug',
    component: () => import('@/views/diagnostics/SparkplugDiagnosticsView.vue'),
    meta: {
      titleKey: 'diagnostics.sparkplug.title',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
      roles: [ROLE_CODES.SYSTEM_ADMIN, ROLE_CODES.ADMIN, ROLE_CODES.OPERATIONS_MANAGER],
    },
  },
  {
    path: 'diagnostics/registry-mirror',
    name: 'diagnostics-registry-mirror',
    component: () => import('@/views/diagnostics/RegistryMirrorView.vue'),
    meta: {
      titleKey: 'diagnostics.registry.title',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
      roles: [ROLE_CODES.SYSTEM_ADMIN, ROLE_CODES.ADMIN, ROLE_CODES.OPERATIONS_MANAGER],
    },
  },
  {
    path: 'diagnostics/governance',
    name: 'diagnostics-governance',
    component: () => import('@/views/diagnostics/GovernanceRulesView.vue'),
    meta: {
      titleKey: 'diagnostics.governance.title',
      domain: 'admin',
      permission: { resource: 'iotOt', action: 'settings.read' },
      roles: [ROLE_CODES.SYSTEM_ADMIN, ROLE_CODES.ADMIN, ROLE_CODES.OPERATIONS_MANAGER],
    },
  },
]
