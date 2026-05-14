import type { RouteRecordRaw } from 'vue-router'

/**
 * F2-MVP · Assets domain.
 *
 * Hosts the master-data surfaces (parks, rides, shows, restaurants,
 * shops, zones, templates) and the new ride-centric drilldown
 * (`/assets/rides/:rideId/{overview,live,queue,oee,maintenance,ai,diagnostics}`)
 * — see `views/assets/ride/*` and `layouts/RideLayout.vue`.
 */
export const assetsRoutes: RouteRecordRaw[] = [
  // ── Legacy URLs (kept verbatim) ────────────────────────────────────────
  { path: 'park-entities', redirect: '/integrations' },
  { path: 'admin/master-data', redirect: { name: 'master-data', params: { entityType: 'parks' } } },
  { path: 'admin/master-data/attractions', redirect: { name: 'master-data', params: { entityType: 'rides' } } },
  {
    path: 'admin/master-data/signal-catalog',
    name: 'master-data-signal-catalog',
    component: () => import('@/views/master-data/SignalCatalogAdminView.vue'),
    meta: {
      title: 'Signal catalog',
      domain: 'assets',
      permission: { resource: 'rides', action: 'read' },
    },
  },
  {
    path: 'admin/master-data/:entityType',
    name: 'master-data',
    component: () => import('@/views/master-data/MasterDataEntityView.vue'),
    meta: { titleKey: 'menu.masterData', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'mdm/rides',
    name: 'mdm-rides',
    component: () => import('@/views/mdm/MdmRidesListView.vue'),
    meta: { title: 'Ride master data', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'mdm/rides/new',
    name: 'mdm-ride-new',
    component: () => import('@/views/mdm/MdmRideWizardView.vue'),
    meta: { title: 'New MDM ride', domain: 'assets', permission: { resource: 'rides', action: 'create' } },
  },
  {
    path: 'mdm/rides/:id',
    name: 'mdm-ride-detail',
    component: () => import('@/views/mdm/MdmRideDetailView.vue'),
    meta: { title: 'MDM ride', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'mdm/templates',
    redirect: { name: 'master-data', params: { entityType: 'rides' } },
  },
  {
    path: 'mdm/zones',
    redirect: { name: 'master-data', params: { entityType: 'rides' } },
  },
  {
    path: 'platform',
    name: 'platform-hub',
    component: () => import('@/views/platform/PlatformHubView.vue'),
    meta: { title: 'Platform MDM', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/parks',
    name: 'platform-parks',
    component: () => import('@/views/platform/PlatformParkExplorerView.vue'),
    meta: { title: 'Park explorer', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/assets',
    name: 'platform-assets',
    redirect: { name: 'master-data', params: { entityType: 'rides' } },
    meta: { titleKey: 'menu.masterData', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/rides/:assetId',
    name: 'platform-ride-master',
    component: () => import('@/views/platform/PlatformRideMasterEditorView.vue'),
    meta: { title: 'Ride master data', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },
  {
    path: 'platform/templates',
    name: 'platform-templates',
    component: () => import('@/views/platform/PlatformTemplateManagementView.vue'),
    meta: { title: 'Templates', domain: 'assets', permission: { resource: 'rides', action: 'read' } },
  },

  // ── F2-MVP namespace (`/assets/*`) — list aliases ──────────────────────
  { path: 'assets', name: 'mvp-assets', redirect: { name: 'master-data', params: { entityType: 'rides' } }, meta: { domain: 'assets' } },
  { path: 'assets/parks', name: 'mvp-assets-parks', redirect: { name: 'master-data', params: { entityType: 'parks' } }, meta: { domain: 'assets' } },
  { path: 'assets/rides', name: 'mvp-assets-rides', redirect: { name: 'master-data', params: { entityType: 'rides' } }, meta: { domain: 'assets' } },
  { path: 'assets/zones', name: 'mvp-assets-zones', redirect: { name: 'master-data', params: { entityType: 'zones' } }, meta: { domain: 'assets' } },
  { path: 'assets/restaurants', name: 'mvp-assets-restaurants', redirect: { name: 'master-data', params: { entityType: 'restaurants' } }, meta: { domain: 'assets' } },
  { path: 'assets/shows', name: 'mvp-assets-shows', redirect: { name: 'master-data', params: { entityType: 'shows' } }, meta: { domain: 'assets' } },

  // ── F2-MVP ride-centric drilldown (`/assets/rides/:rideId/*`) ──────────
  // Single canonical URL for any ride. Every ride list (Operations · Rides,
  // Assets · Rides, Map pin, ⌘K) deep-links into one of these tabs.
  {
    path: 'assets/rides/:rideId',
    component: () => import('@/layouts/RideLayout.vue'),
    redirect: (to) => ({ name: 'mvp-ride-overview', params: to.params }),
    meta: {
      titleKey: 'ride.detailTitle',
      domain: 'assets',
      enforcePersonaDomain: true,
      permission: { resource: 'rides', action: 'read' },
    },
    children: [
      {
        path: 'overview',
        name: 'mvp-ride-overview',
        component: () => import('@/views/assets/ride/RideOverviewView.vue'),
        meta: { titleKey: 'ride.tab.overview', domain: 'assets' },
      },
      {
        path: 'live',
        name: 'mvp-ride-live',
        component: () => import('@/views/assets/ride/RideLiveView.vue'),
        meta: { titleKey: 'ride.tab.live', domain: 'assets' },
      },
      {
        path: 'queue',
        name: 'mvp-ride-queue',
        component: () => import('@/views/assets/ride/RideQueueView.vue'),
        meta: { titleKey: 'ride.tab.queue', domain: 'assets' },
      },
      {
        path: 'oee',
        name: 'mvp-ride-oee',
        component: () => import('@/views/assets/ride/RideOeeView.vue'),
        meta: { titleKey: 'ride.tab.oee', domain: 'assets' },
      },
      {
        path: 'maintenance',
        name: 'mvp-ride-maintenance',
        component: () => import('@/views/assets/ride/RideMaintenanceView.vue'),
        meta: { titleKey: 'ride.tab.maintenance', domain: 'assets' },
      },
      {
        path: 'ai',
        name: 'mvp-ride-ai',
        component: () => import('@/views/assets/ride/RideAiView.vue'),
        meta: {
          titleKey: 'ride.tab.ai',
          domain: 'assets',
          permission: { resource: 'ai', action: 'read' },
        },
      },
      {
        path: 'diagnostics',
        name: 'mvp-ride-diagnostics',
        component: () => import('@/views/assets/ride/RideDiagnosticsView.vue'),
        meta: {
          titleKey: 'ride.tab.diagnostics',
          domain: 'assets',
          permission: { resource: 'iotOt', action: 'settings.read' },
        },
      },
    ],
  },
]
