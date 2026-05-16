import type { RouteRecordRaw } from 'vue-router'
import { TRAFFIC_CORRIDORS_SURFACE_ADAPTER_KEYS } from '@/stores/installedAdapters'

/**
 * F2-MVP · Operations domain.
 *
 * Hosts the operator-facing surfaces: Control Tower, Incidents, Agent inbox,
 * Staffing, Add-on board, Predictive Maintenance, SQDC boards, Live Queue,
 * OEE board, Shift Handover, Visitor Flow.
 *
 * The legacy URLs (`/`, `/incidents`, `/agent/inbox`, `/staff-allocation`, …)
 * keep working unchanged. The new MVP-shape `/ops/*` routes are aliases that
 * render the same components — they exist so the upcoming Sidebar v2 can link
 * to a consistent operations namespace.
 */
export const opsRoutes: RouteRecordRaw[] = [
  // ── Legacy URLs (kept verbatim from the previous monolithic router) ────
  {
    path: '',
    name: 'operations',
    component: () => import('@/views/OperationsDashboard.vue'),
    meta: {
      title: 'Operations',
      domain: 'operations',
      permission: { resource: 'dashboard', action: 'read' },
    },
  },
  {
    path: 'incidents',
    name: 'incidents',
    component: () => import('@/views/incidents/IncidentsListView.vue'),
    meta: {
      titleKey: 'incidents.listTitle',
      domain: 'operations',
      permission: { resource: 'incidents', action: 'read' },
    },
  },
  {
    path: 'incidents/new',
    name: 'incident-new',
    component: () => import('@/views/incidents/IncidentNewView.vue'),
    meta: {
      titleKey: 'incidents.newTitle',
      domain: 'operations',
      permission: { resource: 'incidents', action: 'create' },
    },
  },
  {
    path: 'incidents/:id',
    name: 'incident-detail',
    component: () => import('@/views/incidents/IncidentDetailView.vue'),
    meta: {
      titleKey: 'incidents.detailTitle',
      domain: 'operations',
      permission: { resource: 'incidents', action: 'read' },
    },
  },
  {
    path: 'agent/inbox',
    name: 'agent-inbox',
    component: () => import('@/views/agent/AgentInboxView.vue'),
    meta: {
      titleKey: 'agentPage.inboxTitle',
      domain: 'operations',
      permissionsAny: [
        { resource: 'agent', action: 'review' },
        { resource: 'agent', action: 'approve' },
      ],
    },
  },
  {
    path: 'agent/runs',
    name: 'agent-runs',
    component: () => import('@/views/agent/AgentRunsView.vue'),
    meta: {
      titleKey: 'agentPage.runsTitle',
      domain: 'operations',
      permission: { resource: 'agent', action: 'read' },
    },
  },
  {
    path: 'agent/runs/:id',
    name: 'agent-run-detail',
    component: () => import('@/views/agent/AgentRunDetailView.vue'),
    meta: {
      titleKey: 'agentPage.runDetailTitle',
      domain: 'operations',
      permission: { resource: 'agent', action: 'read' },
    },
  },
  {
    path: 'staff-allocation',
    name: 'staff-allocation',
    component: () => import('@/views/StaffAllocationView.vue'),
    meta: {
      titleKey: 'menu.staffAllocation',
      domain: 'operations',
      permission: { resource: 'staff', action: 'read' },
    },
  },
  {
    path: 'operations/addon-board',
    name: 'addon-board',
    component: () => import('@/views/operations/AddonBoardView.vue'),
    meta: {
      titleKey: 'addonBoard.title',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'operations/predictive-maintenance',
    name: 'predictive-maintenance',
    component: () => import('@/views/operations/PredictiveMaintenanceView.vue'),
    meta: {
      titleKey: 'pdmPage.title',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
      requiresInstalledAdapter: 'predictive_maintenance',
    },
  },
  {
    path: 'operations/pdm-operations-board',
    name: 'pdm-operations-board',
    component: () => import('@/views/operations/PdmOperationsBoardView.vue'),
    meta: {
      titleKey: 'pdmOperationsBoardPage.title',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
      requiresInstalledAdapter: 'predictive_maintenance',
    },
  },
  {
    path: 'operations/traffic-corridors',
    name: 'traffic-corridors',
    component: () => import('@/views/operations/TrafficCorridorsView.vue'),
    meta: {
      title: 'Traffic corridors',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
      requiresAnyInstalledAdapters: [...TRAFFIC_CORRIDORS_SURFACE_ADAPTER_KEYS],
    },
  },
  /** Legacy path — menu + RBAC use `/operations/traffic-corridors`. */
  {
    path: 'operations/demand/corridors',
    redirect: { name: 'traffic-corridors' },
  },
  {
    path: 'planning/hotel-guests',
    name: 'hotel-guest-planning',
    component: () => import('@/views/HotelGuestPlanningView.vue'),
    meta: {
      titleKey: 'hotelPlanning.title',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'analytics/sqdc',
    name: 'sqdc-board',
    component: () => import('@/views/analytics/SqdcBoardView.vue'),
    meta: {
      titleKey: 'sqdc.title',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'sqdc',
    name: 'sqdc-redirect',
    component: () => import('@/views/sqdc/SqdcParkRedirect.vue'),
    meta: {
      titleKey: 'sqdc.hierarchicalParkTitle',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'sqdc/parks/:parkId/assets/:assetId',
    name: 'sqdc-asset-board',
    component: () => import('@/views/sqdc/AssetSqdcBoard.vue'),
    meta: {
      titleKey: 'sqdc.hierarchicalAssetTitle',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'sqdc/parks/:parkId',
    name: 'sqdc-park-board',
    component: () => import('@/views/sqdc/ParkSqdcBoard.vue'),
    meta: {
      titleKey: 'sqdc.hierarchicalParkTitle',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'platform/oee',
    name: 'platform-oee',
    component: () => import('@/views/platform/PlatformOeeView.vue'),
    meta: {
      titleKey: 'menu.oeeDowntime',
      domain: 'operations',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'platform/shift-handover',
    name: 'platform-shift-handover',
    component: () => import('@/views/platform/PlatformShiftHandoverView.vue'),
    meta: { title: 'Schichtübergabe', domain: 'operations', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/shift-handover/logbook',
    name: 'platform-shift-handover-logbook',
    component: () => import('@/views/platform/PlatformShiftHandoverLogbookView.vue'),
    meta: { title: 'Schicht-Logbuch', domain: 'operations', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/live-queue',
    name: 'platform-live-queue',
    component: () => import('@/views/platform/PlatformLiveQueueView.vue'),
    meta: { title: 'Live queue', domain: 'operations', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/visitor-flow',
    name: 'platform-visitor-flow',
    component: () => import('@/views/platform/PlatformVisitorFlowView.vue'),
    meta: { title: 'Visitor flow (sim)', domain: 'operations', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/map',
    name: 'platform-map',
    component: () => import('@/views/platform/PlatformAssetMapView.vue'),
    meta: { title: 'Asset map', domain: 'operations', permission: { resource: 'rides', action: 'read' } },
  },

  // ── F2-MVP namespace aliases (`/ops/*`) ───────────────────────────────
  // Each MVP route renders the same component as its legacy sibling so the
  // upcoming Sidebar v2 can link consistently into one operations namespace
  // without breaking external bookmarks to the legacy URLs.
  {
    path: 'ops',
    name: 'mvp-ops',
    redirect: { name: 'operations' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/control-tower',
    name: 'mvp-ops-control-tower',
    redirect: { name: 'operations' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/map',
    name: 'mvp-ops-map',
    redirect: { name: 'platform-map' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/incidents',
    name: 'mvp-ops-incidents',
    redirect: { name: 'incidents' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/staffing',
    name: 'mvp-ops-staffing',
    redirect: { name: 'staff-allocation' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/sqdc',
    name: 'mvp-ops-sqdc',
    redirect: { name: 'sqdc-redirect' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/handover',
    name: 'mvp-ops-handover',
    redirect: { name: 'platform-shift-handover' },
    meta: { domain: 'operations' },
  },
  {
    path: 'ops/queue',
    name: 'mvp-ops-queue',
    redirect: { name: 'platform-live-queue' },
    meta: { domain: 'operations' },
  },
]
