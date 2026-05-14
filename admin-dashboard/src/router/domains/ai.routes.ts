import type { RouteRecordRaw } from 'vue-router'

/**
 * F2-MVP · AI & Insights domain.
 *
 * Hosts the existing `/ai-insights/*` tree verbatim and adds short-form
 * `/ai/*` aliases for the upcoming Sidebar v2.
 */
export const aiRoutes: RouteRecordRaw[] = [
  // ── Main entry: ride wait grid (business-user landing page) ──────────
  {
    path: 'ai-insights',
    name: 'ai-insights',
    component: () => import('@/views/AiRideWaitGridView.vue'),
    meta: { titleKey: 'aiRideGrid.title', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  // Legacy hub page (accessible for power users via studio link)
  {
    path: 'ai-insights/hub',
    name: 'ai-insights-hub',
    component: () => import('@/views/AiInsightsView.vue'),
    meta: { title: 'AI insights (advanced)', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/accuracy',
    name: 'ai-forecast-accuracy',
    component: () => import('@/views/AiForecastAccuracyView.vue'),
    meta: { titleKey: 'aiAccuracy.title', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/timeseries',
    name: 'ai-ride-timeseries',
    component: () => import('@/views/AiRideTimeseriesView.vue'),
    meta: { titleKey: 'aiTimeseries.title', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/ride-waits',
    name: 'ai-ride-wait-grid',
    redirect: { name: 'ai-insights' },
    meta: { domain: 'ai' },
  },
  {
    path: 'ai-insights/ml-global-factors',
    name: 'ai-ml-global-factors',
    component: () => import('@/views/AiMlGlobalFactorsView.vue'),
    meta: { titleKey: 'aiMl.globalTitle', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/ml-park-factors',
    name: 'ai-ml-park-factors',
    component: () => import('@/views/AiMlParkFactorsView.vue'),
    meta: { titleKey: 'aiMl.parkTitle', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/ml-profiles',
    name: 'ai-ml-profiles',
    component: () => import('@/views/AiMlProfilesView.vue'),
    meta: { titleKey: 'aiMl.profilesTitle', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/feature-store-monitor',
    name: 'ai-feature-store-monitor',
    component: () => import('@/views/AiFeatureStoreMonitorView.vue'),
    meta: { titleKey: 'aiMl.monitorTitle', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/data-quality',
    name: 'ai-feature-data-quality',
    component: () => import('@/views/AiFeatureDataQualityView.vue'),
    meta: { titleKey: 'aiDq.title', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai-insights/studio',
    name: 'ai-studio',
    component: () => import('@/views/AiStudioView.vue'),
    meta: { titleKey: 'aiStudio.title', domain: 'ai', permission: { resource: 'ai', action: 'read' } },
  },
  {
    path: 'ai/ml/feature-monitor',
    name: 'ai-ml-feature-monitor',
    component: () => import('@/views/ai/MLFeatureMonitorView.vue'),
    meta: {
      titleKey: 'aiMl.featureMonitorTitle',
      domain: 'ai',
      permission: { resource: 'ai', action: 'read' },
    },
  },
  {
    path: 'ai/ml/profiles',
    name: 'ai-ml-metadata-profiles',
    component: () => import('@/views/ai/MLProfilesView.vue'),
    meta: {
      titleKey: 'aiMl.metadataProfilesTitle',
      domain: 'ai',
      permission: { resource: 'ai', action: 'read' },
    },
  },

  // ── F2-MVP namespace (`/ai/*`) ─────────────────────────────────────────
  { path: 'ai', name: 'mvp-ai', redirect: { name: 'ai-insights' }, meta: { domain: 'ai' } },
  { path: 'ai/forecasts', name: 'mvp-ai-forecasts', redirect: { name: 'ai-ride-wait-grid' }, meta: { domain: 'ai' } },
  { path: 'ai/queue', name: 'mvp-ai-queue', redirect: { name: 'ai-ride-wait-grid' }, meta: { domain: 'ai' } },
  { path: 'ai/recommendations', name: 'mvp-ai-recommendations', redirect: { name: 'ai-insights-hub' }, meta: { domain: 'ai' } },
  { path: 'ai/studio', name: 'mvp-ai-studio', redirect: { name: 'ai-studio' }, meta: { domain: 'ai' } },
  { path: 'ai/ml', name: 'mvp-ai-ml', redirect: { name: 'ai-ml-feature-monitor' }, meta: { domain: 'ai' } },
]
