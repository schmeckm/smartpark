import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { getRides } from '@/api/client'
import type { Ride } from '@/types/api'

/** Global open state — toggled from MainLayout (⌘K / Ctrl+K) and header button. */
export const commandPaletteOpen = ref(false)

export type PalettePage = {
  id: string
  titleKey: string
  to: { name: string; params?: Record<string, string>; query?: Record<string, string> }
  canAccess: (auth: { hasPermission: (resource: string, action: string) => boolean }) => boolean
}

/** Curated high-value destinations — filtered live by RBAC. */
export const PALETTE_PAGES: PalettePage[] = [
  {
    id: 'park-live',
    titleKey: 'menu.parkLive',
    to: { name: 'operations' },
    canAccess: (a) => a.hasPermission('dashboard', 'read'),
  },
  {
    id: 'incidents',
    titleKey: 'menu.incidents',
    to: { name: 'incidents' },
    canAccess: (a) => a.hasPermission('incidents', 'read'),
  },
  {
    id: 'staff',
    titleKey: 'menu.staffAllocation',
    to: { name: 'staff-allocation' },
    canAccess: (a) => a.hasPermission('staff', 'read'),
  },
  {
    id: 'visit-planning',
    titleKey: 'menu.hotelGuestPlanning',
    to: { name: 'hotel-guest-planning' },
    canAccess: (a) => a.hasPermission('rides', 'read'),
  },
  {
    id: 'pdm',
    titleKey: 'menu.predictiveMaintenance',
    to: { name: 'predictive-maintenance' },
    canAccess: (a) => a.hasPermission('rides', 'read'),
  },
  {
    id: 'sqdc',
    titleKey: 'menu.sqdcHierarchical',
    to: { name: 'sqdc-redirect' },
    canAccess: (a) => a.hasPermission('rides', 'read'),
  },
  {
    id: 'map',
    titleKey: 'menu.assetMap',
    to: { name: 'platform-map' },
    canAccess: (a) => a.hasPermission('rides', 'read'),
  },
  {
    id: 'ai-insights',
    titleKey: 'menu.aiForecasts',
    to: { name: 'ai-insights' },
    canAccess: (a) => a.hasPermission('ai', 'read'),
  },
  {
    id: 'ai-studio',
    titleKey: 'menu.aiModelsTraining',
    to: { name: 'ai-studio' },
    canAccess: (a) => a.hasPermission('ai', 'read'),
  },
  {
    id: 'live-stream',
    titleKey: 'menu.realtimeLiveSignals',
    to: { name: 'realtime-live-signals' },
    canAccess: (a) =>
      a.hasPermission('iotOt', 'settings.read') || a.hasPermission('mqtt', 'read'),
  },
  {
    id: 'topic-explorer',
    titleKey: 'menu.realtimeTopicExplorer',
    to: { name: 'realtime-topic-explorer' },
    canAccess: (a) =>
      a.hasPermission('iotOt', 'settings.read') || a.hasPermission('rides', 'read'),
  },
  {
    id: 'uns-asset-hierarchy',
    titleKey: 'menu.realtimeUnsAssetHierarchy',
    to: { name: 'realtime-topic-explorer', query: { tab: 'assets' } },
    canAccess: (a) =>
      a.hasPermission('iotOt', 'settings.read') || a.hasPermission('rides', 'read'),
  },
  {
    id: 'master-rides',
    titleKey: 'masterDataEntity.tabs.rides',
    to: { name: 'master-data', params: { entityType: 'rides' } },
    canAccess: (a) => a.hasPermission('rides', 'read'),
  },
  {
    id: 'integrations',
    titleKey: 'menu.integrations',
    to: { name: 'integrations' },
    canAccess: (a) => a.hasPermission('integrations', 'read'),
  },
  {
    id: 'devices-services',
    titleKey: 'menu.devicesServices',
    to: { name: 'devices-services' },
    canAccess: (a) => a.hasPermission('iotOt', 'settings.read'),
  },
  {
    id: 'audit',
    titleKey: 'menu.auditLog',
    to: { name: 'audit' },
    canAccess: (a) => a.hasPermission('audit', 'read'),
  },
]

export function useCommandPalette() {
  const router = useRouter()
  const auth = useAuthStore()
  const { t } = useI18n()

  const query = ref('')
  const rides = ref<Ride[]>([])
  const loadingRides = ref(false)

  watch(commandPaletteOpen, async (open) => {
    query.value = ''
    if (!open || !auth.hasPermission('rides', 'read')) return
    loadingRides.value = true
    try {
      rides.value = await getRides()
    } catch {
      rides.value = []
    } finally {
      loadingRides.value = false
    }
  })

  const accessiblePages = computed(() => PALETTE_PAGES.filter((p) => p.canAccess(auth)))

  const qNorm = computed(() => query.value.trim().toLowerCase())

  const filteredPages = computed(() => {
    const q = qNorm.value
    if (!q) return accessiblePages.value.slice(0, 12)
    return accessiblePages.value.filter((p) => t(p.titleKey).toLowerCase().includes(q)).slice(0, 12)
  })

  const filteredRides = computed(() => {
    if (!auth.hasPermission('rides', 'read')) return []
    const q = qNorm.value
    const list = rides.value
    if (!q) return list.slice(0, 8)
    return list.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 12)
  })

  const showNewIncident = computed(
    () => auth.hasPermission('incidents', 'create') && (!qNorm.value || t('cmdK.actionNewIncident').toLowerCase().includes(qNorm.value)),
  )

  function navigateToRide(rideId: string) {
    void router.push({ name: 'mvp-ride-overview', params: { rideId } })
    commandPaletteOpen.value = false
  }

  function navigateToPage(entry: PalettePage) {
    void router.push(entry.to)
    commandPaletteOpen.value = false
  }

  function navigateNewIncident() {
    void router.push({ name: 'incident-new' })
    commandPaletteOpen.value = false
  }

  function close() {
    commandPaletteOpen.value = false
  }

  return {
    query,
    loadingRides,
    filteredPages,
    filteredRides,
    showNewIncident,
    navigateToRide,
    navigateToPage,
    navigateNewIncident,
    close,
    t,
  }
}
