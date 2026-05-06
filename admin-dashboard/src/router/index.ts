import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { i18n } from '@/i18n'
import { ROLE_CODES } from '@/constants/rbac'

declare module 'vue-router' {
  interface RouteMeta {
    /** If set, user must have at least one of these role codes (in addition to `permission` when present). */
    roles?: string[]
    /** i18n key for document title + header (e.g. `settings.title`). */
    titleKey?: string
    /** RBAC gate for this route. */
    permission?: { resource: string; action: string }
    public?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, title: 'Sign in' },
    },
    {
      path: '/unauthorized',
      name: 'unauthorized',
      component: () => import('@/views/UnauthorizedView.vue'),
      meta: { title: 'Unauthorized' },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      children: [
        {
          path: '',
          name: 'operations',
          component: () => import('@/views/OperationsDashboard.vue'),
          meta: {
            title: 'Operations',
            permission: { resource: 'dashboard', action: 'read' },
          },
        },
        {
          path: 'incidents',
          name: 'incidents',
          component: () => import('@/views/incidents/IncidentsListView.vue'),
          meta: {
            titleKey: 'incidents.listTitle',
            permission: { resource: 'incidents', action: 'read' },
          },
        },
        {
          path: 'incidents/new',
          name: 'incident-new',
          component: () => import('@/views/incidents/IncidentNewView.vue'),
          meta: {
            titleKey: 'incidents.newTitle',
            permission: { resource: 'incidents', action: 'create' },
          },
        },
        {
          path: 'incidents/:id',
          name: 'incident-detail',
          component: () => import('@/views/incidents/IncidentDetailView.vue'),
          meta: {
            titleKey: 'incidents.detailTitle',
            permission: { resource: 'incidents', action: 'read' },
          },
        },
        {
          path: 'staff-allocation',
          name: 'staff-allocation',
          component: () => import('@/views/StaffAllocationView.vue'),
          meta: { title: 'Staff allocation', permission: { resource: 'staff', action: 'read' } },
        },
        {
          path: 'operations/addon-board',
          name: 'addon-board',
          component: () => import('@/views/operations/AddonBoardView.vue'),
          meta: {
            titleKey: 'addonBoard.title',
            permission: { resource: 'rides', action: 'read' },
          },
        },
        {
          path: 'planning/hotel-guests',
          name: 'hotel-guest-planning',
          component: () => import('@/views/HotelGuestPlanningView.vue'),
          meta: {
            titleKey: 'hotelPlanning.title',
            permission: { resource: 'rides', action: 'read' },
          },
        },
        {
          path: 'ai-insights',
          name: 'ai-insights',
          component: () => import('@/views/AiInsightsView.vue'),
          meta: { title: 'AI insights', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/accuracy',
          name: 'ai-forecast-accuracy',
          component: () => import('@/views/AiForecastAccuracyView.vue'),
          meta: { titleKey: 'aiAccuracy.title', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/timeseries',
          name: 'ai-ride-timeseries',
          component: () => import('@/views/AiRideTimeseriesView.vue'),
          meta: { titleKey: 'aiTimeseries.title', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/ride-waits',
          name: 'ai-ride-wait-grid',
          component: () => import('@/views/AiRideWaitGridView.vue'),
          meta: { titleKey: 'aiRideGrid.title', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/ml-global-factors',
          name: 'ai-ml-global-factors',
          component: () => import('@/views/AiMlGlobalFactorsView.vue'),
          meta: { titleKey: 'aiMl.globalTitle', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/ml-park-factors',
          name: 'ai-ml-park-factors',
          component: () => import('@/views/AiMlParkFactorsView.vue'),
          meta: { titleKey: 'aiMl.parkTitle', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/ml-profiles',
          name: 'ai-ml-profiles',
          component: () => import('@/views/AiMlProfilesView.vue'),
          meta: { titleKey: 'aiMl.profilesTitle', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/feature-store-monitor',
          name: 'ai-feature-store-monitor',
          component: () => import('@/views/AiFeatureStoreMonitorView.vue'),
          meta: { titleKey: 'aiMl.monitorTitle', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/data-quality',
          name: 'ai-feature-data-quality',
          component: () => import('@/views/AiFeatureDataQualityView.vue'),
          meta: { titleKey: 'aiDq.title', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'ai-insights/studio',
          name: 'ai-studio',
          component: () => import('@/views/AiStudioView.vue'),
          meta: { titleKey: 'aiStudio.title', permission: { resource: 'ai', action: 'read' } },
        },
        {
          path: 'analytics/sqdc',
          name: 'sqdc-board',
          component: () => import('@/views/analytics/SqdcBoardView.vue'),
          meta: { titleKey: 'sqdc.title', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'sqdc',
          name: 'sqdc-redirect',
          component: () => import('@/views/sqdc/SqdcParkRedirect.vue'),
          meta: { titleKey: 'sqdc.hierarchicalParkTitle', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'sqdc/parks/:parkId/assets/:assetId',
          name: 'sqdc-asset-board',
          component: () => import('@/views/sqdc/AssetSqdcBoard.vue'),
          meta: { titleKey: 'sqdc.hierarchicalAssetTitle', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'sqdc/parks/:parkId',
          name: 'sqdc-park-board',
          component: () => import('@/views/sqdc/ParkSqdcBoard.vue'),
          meta: { titleKey: 'sqdc.hierarchicalParkTitle', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'audit',
          name: 'audit',
          component: () => import('@/views/AuditLogsView.vue'),
          meta: {
            title: 'Audit log',
            permission: { resource: 'audit', action: 'read' },
          },
        },
        {
          path: 'live',
          name: 'wave2-live',
          component: () => import('@/views/Wave2LiveView.vue'),
          meta: { title: 'Live connectivity', permission: { resource: 'integration', action: 'read' } },
        },
        {
          path: 'import',
          name: 'import',
          component: () => import('@/views/ImportView.vue'),
          meta: { title: 'Import', permission: { resource: 'import', action: 'create' } },
        },
        {
          path: 'data-quality',
          name: 'data-quality',
          component: () => import('@/views/DataQualityView.vue'),
          meta: { title: 'Data quality', permission: { resource: 'dataquality', action: 'read' } },
        },
        {
          path: 'simulator',
          name: 'simulator',
          component: () => import('@/views/SimulatorView.vue'),
          meta: { title: 'Simulator', permission: { resource: 'simulator', action: 'run' } },
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
            roles: [ROLE_CODES.SYSTEM_ADMIN],
          },
        },
        {
          path: 'integrations',
          name: 'integrations',
          component: () => import('@/views/IntegrationSettingsView.vue'),
          meta: { title: 'Integrations', permission: { resource: 'integrations', action: 'read' } },
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
            title: 'Devices & Services',
            permission: { resource: 'integrations', action: 'read' },
          },
        },
        {
          path: 'settings/devices-services/integrations/:id',
          name: 'integration-detail',
          component: () => import('@/views/settings/IntegrationDetailView.vue'),
          meta: {
            title: 'Integration',
            permission: { resource: 'integrations', action: 'read' },
          },
        },
        {
          path: 'settings/adapter-pipeline-log',
          name: 'adapter-pipeline-log',
          component: () => import('@/views/settings/AdapterPipelineLogView.vue'),
          meta: {
            title: 'Adapter operations center',
            permission: { resource: 'integrations', action: 'read' },
          },
        },
        {
          path: 'park-entities',
          redirect: '/integrations',
        },
        {
          path: 'admin/master-data',
          redirect: { name: 'master-data', params: { entityType: 'parks' } },
        },
        {
          path: 'admin/master-data/attractions',
          redirect: { name: 'master-data', params: { entityType: 'rides' } },
        },
        {
          path: 'admin/master-data/:entityType',
          name: 'master-data',
          component: () => import('@/views/master-data/MasterDataEntityView.vue'),
          meta: { title: 'Master data', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'mdm/rides',
          name: 'mdm-rides',
          component: () => import('@/views/mdm/MdmRidesListView.vue'),
          meta: { title: 'Ride master data', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'mdm/rides/new',
          name: 'mdm-ride-new',
          component: () => import('@/views/mdm/MdmRideWizardView.vue'),
          meta: { title: 'New MDM ride', permission: { resource: 'rides', action: 'create' } },
        },
        {
          path: 'mdm/rides/:id',
          name: 'mdm-ride-detail',
          component: () => import('@/views/mdm/MdmRideDetailView.vue'),
          meta: { title: 'MDM ride', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'mdm/templates',
          name: 'mdm-templates',
          component: () => import('@/views/mdm/MdmTemplatesView.vue'),
          meta: { title: 'Ride templates', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'mdm/zones',
          name: 'mdm-zones',
          component: () => import('@/views/mdm/MdmZoneAssignmentView.vue'),
          meta: { title: 'Zone assignment', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform',
          name: 'platform-hub',
          component: () => import('@/views/platform/PlatformHubView.vue'),
          meta: { title: 'Platform MDM', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/parks',
          name: 'platform-parks',
          component: () => import('@/views/platform/PlatformParkExplorerView.vue'),
          meta: { title: 'Park explorer', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/assets',
          name: 'platform-assets',
          component: () => import('@/views/platform/PlatformAssetExplorerView.vue'),
          meta: { title: 'Asset explorer', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/oee',
          name: 'platform-oee-mvp',
          component: () => import('@/views/platform/PlatformOeeMvpView.vue'),
          meta: { title: 'OEE / Stillstände', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/shift-handover',
          name: 'platform-shift-handover',
          component: () => import('@/views/platform/PlatformShiftHandoverView.vue'),
          meta: { title: 'Schichtübergabe', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/shift-handover/logbook',
          name: 'platform-shift-handover-logbook',
          component: () => import('@/views/platform/PlatformShiftHandoverLogbookView.vue'),
          meta: { title: 'Schicht-Logbuch', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/rides/:assetId',
          name: 'platform-ride-master',
          component: () => import('@/views/platform/PlatformRideMasterEditorView.vue'),
          meta: { title: 'Ride master data', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/live-queue',
          name: 'platform-live-queue',
          component: () => import('@/views/platform/PlatformLiveQueueView.vue'),
          meta: { title: 'Live queue', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/map',
          name: 'platform-map',
          component: () => import('@/views/platform/PlatformAssetMapView.vue'),
          meta: { title: 'Asset map', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/visitor-flow',
          name: 'platform-visitor-flow',
          component: () => import('@/views/platform/PlatformVisitorFlowView.vue'),
          meta: { title: 'Visitor flow (sim)', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'platform/templates',
          name: 'platform-templates',
          component: () => import('@/views/platform/PlatformTemplateManagementView.vue'),
          meta: { title: 'Templates', permission: { resource: 'rides', action: 'read' } },
        },
        {
          path: 'admin/uns-registry/mirror',
          redirect: '/uns/registry-mirror',
        },
        {
          path: 'admin/uns-spy/inbox',
          redirect: '/uns/spy-inbox',
        },
        {
          path: 'admin/uns-governance',
          redirect: '/uns/governance',
        },
        {
          path: 'uns',
          component: () => import('@/views/uns/UnsHubView.vue'),
          redirect: { name: 'uns-tree' },
          meta: { title: 'UNS', permission: { resource: 'integrations', action: 'read' } },
          children: [
            {
              path: 'tree',
              name: 'uns-tree',
              component: () => import('@/views/uns/UnsTreeBuilderView.vue'),
              meta: { title: 'UNS · Namespace Tree', permission: { resource: 'integrations', action: 'read' } },
            },
            {
              path: 'live',
              name: 'uns-live',
              component: () => import('@/views/uns/UnsLiveStateView.vue'),
              meta: { title: 'UNS · Live MQTT', permission: { resource: 'integrations', action: 'read' } },
            },
            {
              path: 'oee-cockpit',
              name: 'uns-oee-cockpit',
              component: () => import('@/views/uns/OeeMqttCockpitView.vue'),
              meta: { title: 'UNS · OEE cockpit', permission: { resource: 'integrations', action: 'read' } },
            },
            {
              path: 'topics',
              name: 'uns-topics',
              component: () => import('@/views/uns/UnsTopicsView.vue'),
              meta: { title: 'UNS · Topic Preview', permission: { resource: 'integrations', action: 'read' } },
            },
            {
              path: 'registry-mirror',
              name: 'uns-registry-mirror',
              component: () => import('@/views/UnsRegistryMirrorView.vue'),
              meta: {
                title: 'UNS registry mirror',
                permission: { resource: 'integrations', action: 'read' },
              },
            },
            {
              path: 'spy-inbox',
              name: 'uns-spy-inbox',
              component: () => import('@/views/UnsSpyInboxView.vue'),
              meta: {
                titleKey: 'unsSpyInbox.title',
                permission: { resource: 'integrations', action: 'read' },
              },
            },
            {
              path: 'governance',
              name: 'uns-governance-console',
              component: () => import('@/views/uns/UnsGovernanceConsoleView.vue'),
              meta: {
                titleKey: 'unsGovernance.title',
                permission: { resource: 'integrations', action: 'read' },
              },
            },
            {
              path: 'signal-view',
              name: 'uns-signal-view',
              component: () => import('@/views/uns/UnsSignalView.vue'),
              meta: {
                titleKey: 'unsSignalView.title',
                permission: { resource: 'integrations', action: 'read' },
              },
            },
          ],
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.bootstrapped) {
    await auth.bootstrap()
  }
  if (to.meta.public) return true
  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  const rolesGuard = to.meta.roles
  if (rolesGuard?.length && !auth.canAny(rolesGuard)) {
    return { name: 'unauthorized' }
  }
  const perm = to.meta.permission as { resource: string; action: string } | undefined
  if (perm && !auth.hasPermission(perm.resource, perm.action)) {
    return { name: 'unauthorized' }
  }
  return true
})

router.afterEach((to) => {
  const tk = to.meta.titleKey as string | undefined
  const title = tk
    ? String(i18n.global.t(tk))
    : ((to.meta.title as string) || 'Smart Park OS')
  document.title = `${title} · Smart Park OS`
})

export default router
