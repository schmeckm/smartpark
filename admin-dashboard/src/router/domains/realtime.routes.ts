import type { RouteRecordRaw } from 'vue-router'

/**
 * Operator realtime surfaces under `/realtime/*`.
 * Legacy UNS / IT-OT URLs redirect here or to `/diagnostics/*` (see `diagnostics.routes.ts`).
 */
export const realtimeRoutes: RouteRecordRaw[] = [
  { path: 'uns', redirect: '/realtime/live' },
  {
    path: 'uns/tree',
    redirect: { name: 'realtime-topic-explorer', query: { tab: 'assets' } },
  },
  { path: 'uns/live', redirect: '/realtime/live' },
  { path: 'uns/oee-cockpit', redirect: { path: '/realtime/live', query: { mode: 'oee' } } },
  { path: 'uns/topics', redirect: '/realtime/topics' },
  { path: 'uns/registry-mirror', redirect: '/diagnostics/registry-mirror' },
  { path: 'uns/spy-inbox', redirect: '/realtime/discovery' },
  { path: 'uns/governance', redirect: '/diagnostics/governance' },
  { path: 'uns/signal-view', redirect: '/realtime/topics' },

  { path: 'iot-ot', redirect: '/realtime/live' },
  { path: 'iot-ot/sparkplug-edges', redirect: '/diagnostics/sparkplug' },

  { path: 'admin/uns-registry/mirror', redirect: '/diagnostics/registry-mirror' },
  { path: 'admin/uns-spy/inbox', redirect: '/realtime/discovery' },
  { path: 'admin/uns-governance', redirect: '/diagnostics/governance' },

  {
    path: 'live',
    name: 'wave2-live',
    redirect: { name: 'realtime-live-signals' },
    meta: { domain: 'realtime' },
  },
  {
    path: 'data-quality',
    name: 'data-quality',
    redirect: '/realtime/topics',
    meta: { domain: 'realtime' },
  },

  {
    path: 'realtime',
    redirect: '/realtime/live',
    meta: { domain: 'realtime' },
  },
  {
    path: 'realtime/live',
    name: 'realtime-live-signals',
    component: () => import('@/views/realtime/LiveSignalsView.vue'),
    meta: {
      titleKey: 'menu.realtimeLiveSignals',
      domain: 'realtime',
      permission: { resource: 'iotOt', action: 'settings.read' },
    },
  },
  {
    path: 'realtime/topics',
    name: 'realtime-topic-explorer',
    component: () => import('@/views/realtime/TopicExplorerView.vue'),
    meta: {
      titleKey: 'menu.realtimeTopicExplorer',
      domain: 'realtime',
      permissionsAny: [
        { resource: 'iotOt', action: 'settings.read' },
        { resource: 'rides', action: 'read' },
      ],
    },
  },
  {
    path: 'realtime/uns-asset-hierarchy',
    name: 'realtime-uns-asset-hierarchy',
    redirect: { name: 'realtime-topic-explorer', query: { tab: 'assets' } },
    meta: {
      titleKey: 'menu.realtimeUnsAssetHierarchy',
      domain: 'realtime',
      permissionsAny: [
        { resource: 'iotOt', action: 'settings.read' },
        { resource: 'rides', action: 'read' },
      ],
    },
  },
  {
    path: 'realtime/discovery',
    name: 'realtime-discovery-inbox',
    component: () => import('@/views/realtime/DiscoveryInboxView.vue'),
    meta: {
      titleKey: 'menu.realtimeDiscoveryInbox',
      domain: 'realtime',
      permission: { resource: 'iotOt', action: 'settings.read' },
    },
  },
  {
    path: 'realtime/health',
    redirect: '/realtime/topics',
    meta: { domain: 'realtime' },
  },
]
