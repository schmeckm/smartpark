<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDashboardSocket, type CanonicalMessageAppliedPayload } from '@/composables/useDashboardSocket'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useAiInsights } from '@/composables/useAiInsights'
import {
  getCanonicalMessages,
  getIntegrationSettings,
  getParkForecastSummary,
  getVisitActualYear,
  getVisitPlan,
  listIncidents,
  listVisitPlans,
  type ParkForecastSummary,
  type SqdcRingTone,
} from '@/api/client'
import { useParkContextStore } from '@/stores/parkContext'
import {
  useInstalledAdaptersStore,
  TRAFFIC_CORRIDORS_SURFACE_ADAPTER_KEYS,
} from '@/stores/installedAdapters'
import {
  dailyVisitTotal,
  pruneGuestCountsForYear,
  VISIT_PLAN_TICKET_CHANNEL_ROW_IDS,
} from '@/utils/visitPlanning.utils'
import DashboardHeader from '@/components/DashboardHeader.vue'
import CrowdHeatmap from '@/components/CrowdHeatmap.vue'
import RidesTable from '@/components/RidesTable.vue'
import StaffBoard from '@/components/StaffBoard.vue'
import RecommendationsPanel from '@/components/RecommendationsPanel.vue'
import RecentEventsStrip from '@/components/RecentEventsStrip.vue'
import AiForecastWidget from '@/components/AiForecastWidget.vue'
import LiveOpsSparkRing from '@/components/liveOps/LiveOpsSparkRing.vue'
import ParkTopLevelKpiMatrix from '@/components/operations/ParkTopLevelKpiMatrix.vue'
import AttendanceRiskForecastCard from '@/components/operations/AttendanceRiskForecastCard.vue'
import type { ParkTopLevelKpiValueCtx } from '@/utils/parkTopLevelKpiValues'
import { RIDES_ADAPTER_ZONE_ID, type Ride, type RideStatus, type VisitPlanPayload } from '@/types/api'

const { t } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const installedAdapters = useInstalledAdaptersStore()
const { push: toast } = useToast()

const showTrafficAttendanceCard = computed(
  () =>
    auth.hasPermission('rides', 'read') &&
    installedAdapters.isAnyInstalled(TRAFFIC_CORRIDORS_SURFACE_ADAPTER_KEYS)
)

function todayIsoLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayIsoLocal(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rowIdsFromVisitPayload(p: VisitPlanPayload): string[] {
  const hotels = Array.isArray(p.hotels) ? p.hotels : []
  return [...VISIT_PLAN_TICKET_CHANNEL_ROW_IDS, ...hotels.map((h) => h.id)]
}

const plannedVisitLoading = ref(false)
/** Set when the latest plan version was loaded and today falls in `planYear` (sum of channel + hotel rows). */
const plannedVisitTotal = ref<number | null>(null)
const plannedVisitVersionName = ref<string | null>(null)
const plannedVisitYear = ref<number>(new Date().getFullYear())
/** Sum of `visit-actuals` guestCounts for today / yesterday (same row scope as visit plan when available). */
const actualGuestsToday = ref<number | null>(null)
const actualGuestsYesterday = ref<number | null>(null)

async function loadActualGuestsForRowIds(rowIds: readonly string[], year: number) {
  try {
    const actual = await getVisitActualYear(year)
    const agc = pruneGuestCountsForYear({ ...actual.guestCounts }, year)
    const todayIso = todayIsoLocal()
    const yestIso = yesterdayIsoLocal()
    actualGuestsToday.value = dailyVisitTotal(agc, rowIds, todayIso)
    actualGuestsYesterday.value = dailyVisitTotal(agc, rowIds, yestIso)
  } catch {
    actualGuestsToday.value = null
    actualGuestsYesterday.value = null
  }
}

async function loadPlannedVisitorsToday() {
  plannedVisitYear.value = new Date().getFullYear()
  const todayIso = todayIsoLocal()
  actualGuestsToday.value = null
  actualGuestsYesterday.value = null
  if (!parkCtx.activeParkId) {
    plannedVisitTotal.value = null
    plannedVisitVersionName.value = null
    return
  }
  plannedVisitLoading.value = true
  plannedVisitTotal.value = null
  plannedVisitVersionName.value = null
  try {
    const versions = await listVisitPlans(plannedVisitYear.value)
    if (!versions.length) {
      await loadActualGuestsForRowIds([...VISIT_PLAN_TICKET_CHANNEL_ROW_IDS], plannedVisitYear.value)
      return
    }
    const latest = versions[0]
    const detail = await getVisitPlan(latest.id)
    const p = detail.payload
    const year = detail.planYear ?? plannedVisitYear.value
    if (!p || p.schemaVersion !== 2) {
      plannedVisitVersionName.value = latest.name
      await loadActualGuestsForRowIds([...VISIT_PLAN_TICKET_CHANNEL_ROW_IDS], year)
      return
    }
    if (!todayIso.startsWith(`${detail.planYear}-`)) {
      plannedVisitVersionName.value = latest.name
      await loadActualGuestsForRowIds(rowIdsFromVisitPayload(p), year)
      return
    }
    const gc = pruneGuestCountsForYear({ ...p.guestCounts }, detail.planYear)
    const rowIds = rowIdsFromVisitPayload(p)
    plannedVisitTotal.value = dailyVisitTotal(gc, rowIds, todayIso)
    plannedVisitVersionName.value = latest.name
    await loadActualGuestsForRowIds(rowIds, detail.planYear)
  } catch {
    plannedVisitTotal.value = null
    plannedVisitVersionName.value = null
    await loadActualGuestsForRowIds([...VISIT_PLAN_TICKET_CHANNEL_ROW_IDS], plannedVisitYear.value)
  } finally {
    plannedVisitLoading.value = false
  }
}

type ExternalLiveRow = {
  id: string
  name: string
  waitTime: number | null
  status: string | null
  isOpen: boolean | null
}

const selectedExternalParkName = ref<string>('')
const selectedExternalParkId = ref<string>('')
const selectedIntegrationProvider = ref<string>('themeparks_wiki')
const externalLiveLoading = ref(false)
const parkForecast = ref<ParkForecastSummary | null>(null)
const externalLiveRows = ref<ExternalLiveRow[]>([])
/** Open incidents total (API); null = unread or no permission. */
const openIncidentsTotal = ref<number | null>(null)
const rolePreset = ref<'duty' | 'ops' | 'safety'>('duty')

function normalizeAdapterRideStatus(row: ExternalLiveRow): RideStatus {
  if (row.isOpen === false) return 'CLOSED'
  const s = (row.status || '').toUpperCase()
  if (s.includes('MAINT') || s.includes('DOWN') || s.includes('REFURB')) return 'MAINTENANCE'
  if (row.isOpen === true) return 'OPEN'
  if (s.includes('CLOSED') || s.includes('CLOSE')) return 'CLOSED'
  if (s.includes('OPEN') || s.includes('OPERAT')) return 'OPEN'
  return 'OPEN'
}

function externalRowToRide(row: ExternalLiveRow): Ride {
  const wait = typeof row.waitTime === 'number' ? row.waitTime : 0
  const status = normalizeAdapterRideStatus(row)
  return {
    id: row.id,
    name: row.name,
    zoneId: RIDES_ADAPTER_ZONE_ID,
    status,
    waitTime: wait,
    capacityPerHour: 0,
    /** Integration feed does not ship a tenant criticality score — UI shows "—". */
    criticality: 0,
  }
}

function onCanonicalMessageApplied(payload: CanonicalMessageAppliedPayload) {
  if (!payload.applied || !payload.message) return
  const msg = payload.message as {
    messageType?: string
    provider?: string
    externalParkId?: string | null
    externalEntityId?: string | null
    payload?: Record<string, unknown>
  }
  if (msg.messageType !== 'WAIT_TIME_UPDATED') return
  if (!selectedExternalParkId.value || msg.externalParkId !== selectedExternalParkId.value) return
  if (selectedIntegrationProvider.value && msg.provider && msg.provider !== selectedIntegrationProvider.value) return
  const entityId = msg.externalEntityId
  if (!entityId) return
  const pl = (msg.payload || {}) as Record<string, unknown>
  const nextRow: ExternalLiveRow = {
    id: entityId,
    name: typeof pl.externalEntityName === 'string' ? pl.externalEntityName : entityId,
    waitTime: typeof pl.waitTime === 'number' ? pl.waitTime : null,
    status: typeof pl.status === 'string' ? pl.status : null,
    isOpen: typeof pl.isOpen === 'boolean' ? pl.isOpen : null,
  }
  const list = [...externalLiveRows.value]
  const idx = list.findIndex((x) => x.id === entityId)
  if (idx >= 0) list[idx] = nextRow
  else list.push(nextRow)
  externalLiveRows.value = list
}

const {
  zones,
  rides,
  staff,
  sortedRecommendations,
  recentEvents,
  connected,
  connectionLabel,
  loadError,
  openRecommendations,
  patchRecommendation,
  bootstrap,
} = useDashboardSocket({ onCanonicalMessageApplied })

const {
  summary: aiSummary,
  loading: aiLoading,
  busy: aiBusy,
  error: aiError,
  lastSocketAt: aiSocketAt,
  refresh: refreshAi,
} = useAiInsights({
  onError: (e) => {
    if (import.meta.env.DEV) {
      console.warn('AI insights load failed', e)
    }
  },
})

const openRecCount = computed(() => openRecommendations.value.length)
const criticalRecCount = computed(
  () => sortedRecommendations.value.filter((rec) => rec.priority === 'HIGH' || rec.priority === 'CRITICAL').length
)
const actionableRecommendations = computed(() => sortedRecommendations.value.slice(0, 6))

const ridesForTable = computed((): Ride[] => {
  if (selectedExternalParkId.value) {
    return externalLiveRows.value.map(externalRowToRide)
  }
  return rides.value
})
const openRideCount = computed(() => ridesForTable.value.filter((ride) => ride.status === 'OPEN').length)
const rideAvailabilityPercent = computed(() => {
  const total = ridesForTable.value.length
  if (!total) return null
  return Math.round((openRideCount.value / total) * 100)
})
const staffingCoveragePercent = computed(() => {
  if (!staff.value.length) return null
  const assigned = staff.value.filter((member) => member.currentZoneId).length
  return Math.round((assigned / staff.value.length) * 100)
})
const avgRideWaitMinutes = computed(() => {
  const waits = ridesForTable.value
    .map((ride) => ride.waitTime)
    .filter((wait): wait is number => typeof wait === 'number' && wait > 0)
  if (!waits.length) return null
  return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
})
const globalStatus = computed(() => {
  if (criticalRecCount.value >= 3) return 'Critical'
  if ((parkForecast.value?.crowdLevelPercent ?? 0) >= 75) return 'Busy'
  return 'Normal'
})
const globalStatusClass = computed(() => {
  if (globalStatus.value === 'Critical') return 'text-rose-300 border-rose-500/40 bg-rose-500/10'
  if (globalStatus.value === 'Busy') return 'text-amber-300 border-amber-500/40 bg-amber-500/10'
  return 'text-brand-200 border-brand-500/40 bg-brand-500/10'
})

const hasExternalParkLive = computed(() => Boolean(selectedExternalParkId.value))

/** Trend from `visit-actuals` guestCounts: today vs calendar yesterday (same row keys as plan when loaded). */
const guestTrendVsYesterday = computed(() => {
  const t = actualGuestsToday.value
  const y = actualGuestsYesterday.value
  if (t == null || y == null) return null
  const diff = t - y
  if (y === 0) {
    if (t === 0) return { kind: 'flat' as const, pct: 0, diff: 0 }
    return { kind: 'up' as const, pct: null as number | null, diff }
  }
  const pct = Math.round((diff / y) * 100)
  return {
    kind: (diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
    pct,
    diff,
  }
})

function trafficLightHigherIsBetter(score: number | null | undefined): SqdcRingTone | 'neutral' {
  if (score == null || !Number.isFinite(Number(score))) return 'neutral'
  const n = Number(score)
  if (n >= 80) return 'green'
  if (n >= 55) return 'amber'
  return 'red'
}

const guestsPlanRatioPercent = computed(() => {
  const p = plannedVisitTotal.value
  const a = actualGuestsToday.value
  if (p == null || p <= 0 || a == null) return null
  return Math.round((a / p) * 100)
})

function guestPlanBalanceTone(ratio: number | null): SqdcRingTone | 'neutral' {
  if (ratio == null) return 'neutral'
  if (ratio >= 85 && ratio <= 115) return 'green'
  if (ratio >= 55 && ratio < 140) return 'amber'
  return 'red'
}

const guestTrendRingLine = computed(() => {
  const tr = guestTrendVsYesterday.value
  if (!tr) return null
  if (tr.kind === 'up') {
    return tr.pct != null
      ? `${t('liveOpsDashboard.guestsTrendUpPct', { pct: tr.pct })} ${t('liveOpsDashboard.guestsTrendVsYesterday')}`
      : t('liveOpsDashboard.guestsTrendUpNoBaseline')
  }
  if (tr.kind === 'down') {
    return `${t('liveOpsDashboard.guestsTrendDownPct', { pct: Math.abs(tr.pct ?? 0) })} ${t('liveOpsDashboard.guestsTrendVsYesterday')}`
  }
  return `${t('liveOpsDashboard.guestsTrendFlatPct', { pct: tr.pct })} ${t('liveOpsDashboard.guestsTrendVsYesterday')}`
})

const liveOpsRingRide = computed(() => {
  const pct = rideAvailabilityPercent.value
  const tone = trafficLightHigherIsBetter(pct)
  return {
    letter: 'O',
    label: t('liveOpsDashboard.ringRideLabel'),
    percent: pct,
    tone: pct == null ? 'neutral' : tone,
    centerValue: pct == null ? null : String(pct),
    centerUnit: '%',
    statusLabel:
      pct == null
        ? null
        : tone === 'green'
          ? t('sqdc.pillarStatusGood')
          : tone === 'amber'
            ? t('sqdc.pillarStatusWatch')
            : t('sqdc.pillarStatusRisk'),
    statusTone: (pct == null ? 'neutral' : tone) as SqdcRingTone | 'neutral',
    trendText: t('liveOpsDashboard.ringRideTrend', {
      open: openRideCount.value,
      total: ridesForTable.value.length,
    }),
    subLabel: t('liveOpsDashboard.ringRideSub'),
    size: 'hero' as const,
  }
})

const liveOpsRingWait = computed(() => {
  const m = avgRideWaitMinutes.value
  const stress = m == null ? null : Math.min(100, Math.round((m / 75) * 100))
  const tone: SqdcRingTone | 'neutral' = m == null ? 'neutral' : m <= 20 ? 'green' : m <= 45 ? 'amber' : 'red'
  return {
    letter: 'W',
    label: t('liveOpsDashboard.ringWaitLabel'),
    percent: stress,
    tone,
    centerValue: m == null ? null : String(m),
    centerUnit: t('liveOpsDashboard.ringWaitUnit'),
    statusLabel:
      m == null ? null : tone === 'green' ? t('sqdc.pillarStatusGood') : tone === 'amber' ? t('sqdc.pillarStatusWatch') : t('sqdc.pillarStatusRisk'),
    statusTone: tone,
    trendText: t('liveOpsDashboard.ringWaitTrend'),
    subLabel: t('liveOpsDashboard.ringWaitSub'),
    size: 'hero' as const,
  }
})

const liveOpsRingGuests = computed(() => {
  const a = actualGuestsToday.value
  const ratio = guestsPlanRatioPercent.value
  const tone = guestPlanBalanceTone(ratio)
  const arc = ratio == null ? null : Math.min(100, ratio)
  return {
    letter: 'G',
    label: t('liveOpsDashboard.ringGuestsLabel'),
    percent: arc,
    tone,
    centerValue: a == null ? null : a.toLocaleString(),
    centerUnit: null as string | null,
    statusLabel:
      ratio == null
        ? a == null
          ? null
          : t('liveOpsDashboard.ringGuestsStatusNoPlan')
        : tone === 'green'
          ? t('sqdc.pillarStatusGood')
          : tone === 'amber'
            ? t('sqdc.pillarStatusWatch')
            : t('sqdc.pillarStatusRisk'),
    statusTone: (ratio == null && a == null ? 'neutral' : tone) as SqdcRingTone | 'neutral',
    trendText: guestTrendRingLine.value,
    subLabel:
      ratio != null
        ? t('liveOpsDashboard.ringGuestsSubPlan', { pct: ratio })
        : t('liveOpsDashboard.ringGuestsSubNoPlan'),
    size: 'hero' as const,
  }
})

const liveOpsRingStaff = computed(() => {
  const pct = staffingCoveragePercent.value
  const tone = trafficLightHigherIsBetter(pct)
  return {
    letter: 'S',
    label: t('liveOpsDashboard.ringStaffLabel'),
    percent: pct,
    tone: pct == null ? 'neutral' : tone,
    centerValue: pct == null ? null : String(pct),
    centerUnit: '%',
    statusLabel:
      pct == null
        ? null
        : tone === 'green'
          ? t('sqdc.pillarStatusGood')
          : tone === 'amber'
            ? t('sqdc.pillarStatusWatch')
            : t('sqdc.pillarStatusRisk'),
    statusTone: (pct == null ? 'neutral' : tone) as SqdcRingTone | 'neutral',
    trendText: t('liveOpsDashboard.ringStaffTrend'),
    subLabel: t('liveOpsDashboard.ringStaffSub'),
    size: 'hero' as const,
  }
})

async function loadOpenIncidentsCount() {
  if (!auth.hasPermission('incidents', 'read')) {
    openIncidentsTotal.value = null
    return
  }
  try {
    const p = await listIncidents({ status: 'OPEN', limit: 1 })
    openIncidentsTotal.value = p.total
  } catch {
    openIncidentsTotal.value = null
  }
}

const parkTopLevelKpiCtx = computed((): ParkTopLevelKpiValueCtx => ({
  zones: zones.value,
  rides: ridesForTable.value,
  rideAvailabilityPct: rideAvailabilityPercent.value,
  openRideCount: openRideCount.value,
  avgWaitMinutes: avgRideWaitMinutes.value,
  staffingCoveragePct: staffingCoveragePercent.value,
  openIncidentsTotal: openIncidentsTotal.value,
  aiSummary: aiSummary.value,
  criticalRecCount: criticalRecCount.value,
}))

const liveOpsRingCrowd = computed(() => {
  const raw = parkForecast.value?.crowdLevelPercent
  const pct = raw == null || !Number.isFinite(Number(raw)) ? null : Math.min(100, Math.max(0, Number(raw)))
  const health = pct == null ? null : 100 - pct
  const tone = trafficLightHigherIsBetter(health)
  return {
    letter: 'C',
    label: t('liveOpsDashboard.ringCrowdLabel'),
    percent: pct,
    tone: pct == null ? 'neutral' : tone,
    centerValue: pct == null ? null : String(pct),
    centerUnit: '%',
    statusLabel:
      pct == null
        ? null
        : tone === 'green'
          ? t('sqdc.pillarStatusGood')
          : tone === 'amber'
            ? t('sqdc.pillarStatusWatch')
            : t('sqdc.pillarStatusRisk'),
    statusTone: (pct == null ? 'neutral' : tone) as SqdcRingTone | 'neutral',
    trendText: hasExternalParkLive.value ? t('liveOpsDashboard.ringCrowdTrendLive') : t('liveOpsDashboard.ringCrowdTrendLocal'),
    subLabel: t('liveOpsDashboard.ringCrowdSub'),
    size: 'hero' as const,
  }
})

const showStaffBoard = computed(() => rolePreset.value !== 'safety')
const showRidesTable = computed(() => rolePreset.value !== 'safety')
const showExternalLive = computed(() => rolePreset.value !== 'safety')
const showActionQueue = computed(() => rolePreset.value !== 'ops')
const showRecommendationsPanel = computed(() => rolePreset.value !== 'ops')
const isSeedDataMode = computed(() => {
  const configuredMode = String(import.meta.env.VITE_CONTROL_TOWER_DATA_MODE ?? 'live').toLowerCase()
  return ['seed', 'demo', 'mock', 'simulation', 'simulated', 'test'].includes(configuredMode)
})

const externalLiveSummary = computed(() => {
  const all = externalLiveRows.value
  const withOpenFlag = all.filter((x) => x.isOpen !== null && x.isOpen !== undefined)
  const openReported =
    withOpenFlag.length === 0 ? null : all.filter((x) => x.isOpen === true).length
  return {
    total: all.length,
    openReported,
    avgWait: (() => {
      const waits = all.map((x) => x.waitTime).filter((x): x is number => typeof x === 'number')
      if (!waits.length) return null
      return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    })(),
    topWaits: [...all]
      .filter((x) => typeof x.waitTime === 'number')
      .sort((a, b) => (b.waitTime || 0) - (a.waitTime || 0))
      .slice(0, 5),
  }
})

async function loadSelectedParkLiveSnapshot() {
  externalLiveLoading.value = true
  try {
    const settings = await getIntegrationSettings()
    const park = (settings.selectedPark as { externalParkId?: string; parkName?: string } | undefined) || {}
    const provider = (settings.selectedProvider as { provider?: string } | undefined)?.provider || 'themeparks_wiki'
    selectedIntegrationProvider.value = provider
    selectedExternalParkId.value = park.externalParkId || ''
    selectedExternalParkName.value = park.parkName || park.externalParkId || ''
    if (!selectedExternalParkId.value) {
      const latest = await getCanonicalMessages({
        provider,
        messageType: 'WAIT_TIME_UPDATED',
        limit: 1,
      })
      const fallback = latest[0]
      if (fallback?.externalParkId) {
        selectedExternalParkId.value = fallback.externalParkId
        selectedExternalParkName.value = `Auto (${fallback.externalParkId.slice(0, 8)}...)`
      }
    }
    if (!selectedExternalParkId.value) {
      externalLiveRows.value = []
      parkForecast.value = null
      return
    }
    parkForecast.value = await getParkForecastSummary(selectedExternalParkId.value, provider)
    const messages = await getCanonicalMessages({
      provider,
      externalParkId: selectedExternalParkId.value,
      messageType: 'WAIT_TIME_UPDATED',
      limit: 500,
    })
    const byEntity = new Map<string, { id: string; name: string; waitTime: number | null; status: string | null; isOpen: boolean | null }>()
    for (const msg of messages) {
      if (!msg.externalEntityId) continue
      const payload = (msg.payload || {}) as Record<string, unknown>
      byEntity.set(msg.externalEntityId, {
        id: msg.externalEntityId,
        name: typeof payload.externalEntityName === 'string' ? payload.externalEntityName : msg.externalEntityId,
        waitTime: typeof payload.waitTime === 'number' ? payload.waitTime : null,
        status: typeof payload.status === 'string' ? payload.status : null,
        isOpen: typeof payload.isOpen === 'boolean' ? payload.isOpen : null,
      })
    }
    externalLiveRows.value = [...byEntity.values()]
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load selected park live snapshot', 'error')
  } finally {
    externalLiveLoading.value = false
  }
}

async function onAiRefresh() {
  if (!auth.hasPermission('ai', 'refresh')) {
    toast('You do not have permission to refresh AI forecasts', 'error')
    return
  }
  const ok = await refreshAi()
  if (ok) {
    toast('AI forecasts refreshed', 'success')
  }
}

function refreshParkViews() {
  void loadSelectedParkLiveSnapshot()
  void loadPlannedVisitorsToday()
  void loadOpenIncidentsCount()
}

watch(
  () => parkCtx.activeParkId,
  () => {
    void loadPlannedVisitorsToday()
  }
)

onMounted(() => {
  refreshParkViews()
})
</script>

<template>
  <div class="pb-12">
    <DashboardHeader
      :connected="connected"
      :connection-label="connectionLabel"
      :load-error="loadError"
      @retry="bootstrap"
    />

    <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
      <div
        v-if="isSeedDataMode"
        class="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
      >
        <p class="font-semibold uppercase tracking-wide">Simulation mode active</p>
        <p class="mt-1 text-xs text-amber-100/90">
          Control Tower shows seed/simulated data. Do not use this view for real-time operational decisions.
        </p>
      </div>

      <div class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-brand-400/90">Control tower</p>
            <h2 class="mt-1 text-lg font-semibold text-white">Park command dashboard</h2>
            <p class="mt-1 max-w-2xl text-sm text-slate-400">
              Highest-level operating picture for live crowd pressure, ride availability, staffing coverage, and recommended actions.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950/50 p-1">
              <button
                class="rounded px-2 py-1 text-[11px] font-medium transition"
                :class="rolePreset === 'duty' ? 'bg-brand-500/25 text-brand-200' : 'text-slate-400 hover:text-slate-200'"
                @click="rolePreset = 'duty'"
              >
                Duty manager
              </button>
              <button
                class="rounded px-2 py-1 text-[11px] font-medium transition"
                :class="rolePreset === 'ops' ? 'bg-brand-500/25 text-brand-200' : 'text-slate-400 hover:text-slate-200'"
                @click="rolePreset = 'ops'"
              >
                Ops lead
              </button>
              <button
                class="rounded px-2 py-1 text-[11px] font-medium transition"
                :class="rolePreset === 'safety' ? 'bg-brand-500/25 text-brand-200' : 'text-slate-400 hover:text-slate-200'"
                @click="rolePreset = 'safety'"
              >
                Safety
              </button>
            </div>
            <span class="rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide" :class="globalStatusClass">
              {{ globalStatus }}
            </span>
            <button
              class="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500"
              type="button"
              @click="refreshParkViews"
            >
              Refresh park snapshot
            </button>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-200">{{ t('liveOpsDashboard.heroRingsTitle') }}</h2>
            <p class="max-w-xl text-[10px] text-slate-500">{{ t('liveOpsDashboard.heroRingsHint') }}</p>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <LiveOpsSparkRing v-bind="liveOpsRingRide" />
            <LiveOpsSparkRing v-bind="liveOpsRingWait" />
            <LiveOpsSparkRing v-bind="liveOpsRingGuests" />
            <LiveOpsSparkRing v-bind="liveOpsRingStaff" />
            <LiveOpsSparkRing v-bind="liveOpsRingCrowd" />
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <p class="text-[11px] uppercase tracking-wide text-slate-500">Open recommendations</p>
            <p class="mt-1 font-display text-2xl font-bold text-white">{{ openRecCount }}</p>
            <p class="text-xs text-slate-500">Critical: {{ criticalRecCount }}</p>
          </div>
          <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <p class="text-[11px] uppercase tracking-wide text-slate-500">Ride availability</p>
            <p class="mt-1 font-display text-2xl font-bold text-white">
              {{ rideAvailabilityPercent == null ? '—' : `${rideAvailabilityPercent}%` }}
            </p>
            <p class="text-xs text-slate-500">
              {{ openRideCount }} / {{ ridesForTable.length }} rides operational
            </p>
          </div>
          <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <p class="text-[11px] uppercase tracking-wide text-slate-500">Average wait</p>
            <p class="mt-1 font-display text-2xl font-bold text-white">{{ avgRideWaitMinutes == null ? '—' : `${avgRideWaitMinutes}m` }}</p>
            <p class="text-xs text-slate-500">Across currently reported rides</p>
          </div>
          <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <p class="text-[11px] uppercase tracking-wide text-slate-500">Staff coverage</p>
            <p class="mt-1 font-display text-2xl font-bold text-white">
              {{ staffingCoveragePercent == null ? '—' : `${staffingCoveragePercent}%` }}
            </p>
            <p class="text-xs text-slate-500">Assigned staff vs active roster</p>
          </div>
          <div class="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <p class="text-[11px] uppercase tracking-wide text-slate-500">{{ t('liveOpsDashboard.guestsTodayKpiTitle') }}</p>
            <p v-if="plannedVisitLoading" class="mt-1 font-display text-2xl font-bold text-slate-500">…</p>
            <template v-else-if="!parkCtx.activeParkId">
              <p class="mt-1 font-display text-2xl font-bold text-white">—</p>
              <p class="text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayNoPark') }}</p>
            </template>
            <template v-else>
              <p class="mt-1 font-display text-2xl font-bold text-white">
                {{ actualGuestsToday == null ? '—' : actualGuestsToday.toLocaleString() }}
              </p>
              <div v-if="guestTrendVsYesterday" class="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs">
                <span
                  v-if="guestTrendVsYesterday.kind === 'up'"
                  class="inline-flex items-center gap-1 font-semibold text-emerald-400"
                >
                  <span aria-hidden="true">▲</span>
                  <span v-if="guestTrendVsYesterday.pct != null">{{
                    t('liveOpsDashboard.guestsTrendUpPct', { pct: guestTrendVsYesterday.pct })
                  }}</span>
                  <span v-else>{{ t('liveOpsDashboard.guestsTrendUpNoBaseline') }}</span>
                </span>
                <span
                  v-else-if="guestTrendVsYesterday.kind === 'down'"
                  class="inline-flex items-center gap-1 font-semibold text-rose-400"
                >
                  <span aria-hidden="true">▼</span>
                  <span>{{ t('liveOpsDashboard.guestsTrendDownPct', { pct: Math.abs(guestTrendVsYesterday.pct ?? 0) }) }}</span>
                </span>
                <span v-else class="inline-flex items-center gap-1 font-medium text-slate-400">
                  <span aria-hidden="true">◆</span>
                  <span>{{ t('liveOpsDashboard.guestsTrendFlatPct', { pct: guestTrendVsYesterday.pct }) }}</span>
                </span>
                <span class="text-slate-500">{{ t('liveOpsDashboard.guestsTrendVsYesterday') }}</span>
              </div>
              <p v-else-if="actualGuestsToday === null" class="mt-1 text-xs text-slate-500">
                {{ t('liveOpsDashboard.guestsTodayNoData') }}
              </p>
              <p class="mt-1 text-[11px] leading-snug text-slate-500">{{ t('liveOpsDashboard.guestsTodayKpiHint') }}</p>
            </template>
          </div>
        </div>

        <div class="mt-4">
          <ParkTopLevelKpiMatrix :ctx="parkTopLevelKpiCtx" />
        </div>

        <div v-if="showTrafficAttendanceCard" class="mt-4">
          <AttendanceRiskForecastCard />
        </div>

        <div
          v-if="hasExternalParkLive"
          class="mt-4 rounded-xl border border-brand-500/20 bg-brand-950/25 p-4"
        >
          <p class="text-[11px] font-semibold uppercase tracking-wide text-brand-300/95">
            {{ t('liveOpsDashboard.integrationKpisTitle') }}
          </p>
          <p class="mt-0.5 text-xs text-slate-400">{{ t('liveOpsDashboard.integrationKpisHint') }}</p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div class="rounded-lg border border-brand-500/15 bg-slate-950/40 px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-slate-500">{{ t('liveOpsDashboard.integrationEntities') }}</p>
              <p class="mt-1 font-display text-xl font-bold text-white">{{ externalLiveSummary.total }}</p>
            </div>
            <div class="rounded-lg border border-brand-500/15 bg-slate-950/40 px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-slate-500">{{ t('liveOpsDashboard.integrationOpen') }}</p>
              <p class="mt-1 font-display text-xl font-bold text-white">
                {{ externalLiveSummary.openReported == null ? '—' : externalLiveSummary.openReported }}
              </p>
              <p v-if="externalLiveSummary.openReported == null" class="mt-0.5 text-[10px] text-slate-500">
                {{ t('liveOpsDashboard.integrationOpenMissing') }}
              </p>
            </div>
            <div class="rounded-lg border border-brand-500/15 bg-slate-950/40 px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-slate-500">{{ t('liveOpsDashboard.integrationAvgWait') }}</p>
              <p class="mt-1 font-display text-xl font-bold text-white">
                {{ externalLiveSummary.avgWait == null ? '—' : `${externalLiveSummary.avgWait}m` }}
              </p>
            </div>
            <div class="rounded-lg border border-brand-500/15 bg-slate-950/40 px-3 py-2">
              <p class="text-[11px] uppercase tracking-wide text-slate-500">{{ t('liveOpsDashboard.integrationCrowd') }}</p>
              <p class="mt-1 font-display text-xl font-bold text-white">
                {{ parkForecast?.crowdLevelPercent == null ? '—' : `${parkForecast.crowdLevelPercent}%` }}
              </p>
            </div>
          </div>
        </div>

        <div
          class="mt-4 flex flex-col gap-4 rounded-xl border border-slate-800/80 bg-slate-950/30 p-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {{ t('liveOpsDashboard.plannedTodayTitle') }}
            </p>
            <p v-if="plannedVisitLoading" class="mt-1 text-sm text-slate-400">{{ t('liveOpsDashboard.plannedTodayLoading') }}</p>
            <template v-else-if="!parkCtx.activeParkId">
              <p class="mt-1 font-display text-2xl font-bold text-white">—</p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayNoPark') }}</p>
            </template>
            <template v-else-if="plannedVisitTotal === null && !plannedVisitVersionName">
              <p class="mt-1 font-display text-2xl font-bold text-white">—</p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayNoPlan', { year: plannedVisitYear }) }}</p>
            </template>
            <template v-else-if="plannedVisitTotal === null && plannedVisitVersionName">
              <p class="mt-1 font-display text-2xl font-bold text-white">—</p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayHint', { year: plannedVisitYear }) }}</p>
              <p class="mt-1 text-[11px] text-slate-500">{{ t('liveOpsDashboard.plannedVersionLabel', { name: plannedVisitVersionName }) }}</p>
            </template>
            <template v-else>
              <p class="mt-1 font-display text-2xl font-bold text-white">
                {{ plannedVisitTotal != null ? plannedVisitTotal.toLocaleString() : '—' }}
              </p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayHint', { year: plannedVisitYear }) }}</p>
              <p v-if="plannedVisitVersionName" class="mt-1 text-[11px] text-slate-500">
                {{ t('liveOpsDashboard.plannedVersionLabel', { name: plannedVisitVersionName }) }}
              </p>
            </template>
          </div>
          <div class="min-w-0 flex-1 border-t border-slate-800/80 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {{ t('liveOpsDashboard.actualTodayTitle') }}
            </p>
            <p v-if="plannedVisitLoading" class="mt-1 text-sm text-slate-400">{{ t('liveOpsDashboard.plannedTodayLoading') }}</p>
            <template v-else-if="!parkCtx.activeParkId">
              <p class="mt-1 font-display text-2xl font-bold text-white">—</p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.plannedTodayNoPark') }}</p>
            </template>
            <template v-else-if="actualGuestsToday == null">
              <p class="mt-1 font-display text-2xl font-bold text-slate-500">{{ t('liveOpsDashboard.actualTodayPlaceholder') }}</p>
              <p class="mt-1 text-xs text-slate-500">{{ t('liveOpsDashboard.actualTodayHint') }}</p>
            </template>
            <template v-else>
              <p class="mt-1 font-display text-2xl font-bold text-white">{{ actualGuestsToday.toLocaleString() }}</p>
              <div v-if="guestTrendVsYesterday" class="mt-2 flex flex-wrap items-center gap-x-2 text-xs">
                <span
                  v-if="guestTrendVsYesterday.kind === 'up'"
                  class="inline-flex items-center gap-1 font-semibold text-emerald-400"
                >
                  <span aria-hidden="true">▲</span>
                  <span v-if="guestTrendVsYesterday.pct != null">{{
                    t('liveOpsDashboard.guestsTrendUpPct', { pct: guestTrendVsYesterday.pct })
                  }}</span>
                  <span v-else>{{ t('liveOpsDashboard.guestsTrendUpNoBaseline') }}</span>
                </span>
                <span
                  v-else-if="guestTrendVsYesterday.kind === 'down'"
                  class="inline-flex items-center gap-1 font-semibold text-rose-400"
                >
                  <span aria-hidden="true">▼</span>
                  <span>{{ t('liveOpsDashboard.guestsTrendDownPct', { pct: Math.abs(guestTrendVsYesterday.pct ?? 0) }) }}</span>
                </span>
                <span v-else class="inline-flex items-center gap-1 font-medium text-slate-400">
                  <span aria-hidden="true">◆</span>
                  <span>{{ t('liveOpsDashboard.guestsTrendFlatPct', { pct: guestTrendVsYesterday.pct }) }}</span>
                </span>
                <span class="text-slate-500">{{ t('liveOpsDashboard.guestsTrendVsYesterday') }}</span>
              </div>
              <p class="mt-2 text-xs text-slate-500">{{ t('liveOpsDashboard.actualTodayFromVisitActuals') }}</p>
            </template>
          </div>
        </div>
      </div>

      <RecentEventsStrip :events="recentEvents" />

      <AiForecastWidget
        v-if="auth.hasPermission('ai', 'read')"
        :summary="aiSummary"
        :loading="aiLoading || aiBusy"
        :error="aiError"
        :last-socket-at="aiSocketAt"
        @refresh="onAiRefresh"
      />

      <AttendanceRiskForecastCard v-if="showTrafficAttendanceCard" card-test-id="traffic-attendance-risk-forecast-card" />

      <section v-if="showExternalLive" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-white">Selected external park live</h3>
            <p class="mt-1 text-xs text-slate-400">
              {{ selectedExternalParkName || 'No park selected in Integrations' }}
            </p>
          </div>
          <span class="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">Live</span>
        </div>
        <div v-if="externalLiveLoading" class="mt-3 text-xs text-slate-400">Loading selected park snapshot...</div>
        <div v-else-if="!selectedExternalParkId" class="mt-3 text-xs text-slate-500">
          Select a park under Integrations -> Save selection.
        </div>
        <div v-else class="mt-3">
          <p class="text-xs text-slate-500">{{ t('liveOpsDashboard.externalTopWaitsIntro') }}</p>
          <div class="mt-2 space-y-1.5">
            <div
              v-for="r in externalLiveSummary.topWaits"
              :key="r.id"
              class="flex items-center justify-between rounded-lg border border-slate-800/70 bg-slate-950/30 px-3 py-1.5 text-xs"
            >
              <span class="truncate text-slate-200">{{ r.name }}</span>
              <span class="rounded bg-brand-600/25 px-2 py-0.5 font-medium text-brand-200">{{ r.waitTime }}m</span>
            </div>
            <p v-if="!externalLiveSummary.topWaits.length" class="text-xs text-slate-500">
              No wait-time messages yet for selected park.
            </p>
          </div>
        </div>
      </section>

      <div class="grid gap-6 xl:grid-cols-3">
        <div class="space-y-6 xl:col-span-2">
          <CrowdHeatmap
            :zones="zones"
            :park-wide-load-percent="parkForecast?.crowdLevelPercent ?? null"
            :external-park-label="selectedExternalParkId ? selectedExternalParkName || selectedExternalParkId : ''"
            :hide-internal-zone-tiles="hasExternalParkLive"
          />
          <RidesTable
            v-if="showRidesTable"
            :rides="ridesForTable"
            :zones="zones"
            :adapter-live="Boolean(selectedExternalParkId)"
          />
          <StaffBoard v-if="showStaffBoard" :zones="zones" :staff="staff" />
        </div>
        <div class="space-y-6 xl:col-span-1">
          <section v-if="showActionQueue" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold text-white">Action queue</h3>
              <span class="text-xs text-slate-500">Top {{ actionableRecommendations.length }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-400">
              Prioritized recommendations for the shift lead. Acknowledge and dispatch from the recommendation panel.
            </p>
            <div class="mt-3 space-y-2">
              <div
                v-for="rec in actionableRecommendations"
                :key="rec.id"
                class="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              >
                <div class="flex items-start justify-between gap-2">
                  <p class="text-xs font-medium text-slate-200">{{ rec.message }}</p>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                    :class="
                      rec.priority === 'HIGH' || rec.priority === 'CRITICAL'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-brand-500/20 text-brand-300'
                    "
                  >
                    {{ rec.priority }}
                  </span>
                </div>
                <p v-if="rec.score?.explanation?.summary" class="mt-1 line-clamp-2 text-[11px] text-slate-400">
                  {{ rec.score.explanation.summary }}
                </p>
              </div>
              <p v-if="!actionableRecommendations.length" class="text-xs text-slate-500">No open recommendations right now.</p>
            </div>
          </section>
          <RecommendationsPanel
            v-if="showRecommendationsPanel"
            :recommendations="sortedRecommendations"
            @updated="patchRecommendation"
          />
        </div>
      </div>
    </div>
  </div>
</template>
