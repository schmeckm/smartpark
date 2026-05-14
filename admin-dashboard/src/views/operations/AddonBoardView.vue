<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getAddonBoardCriticalRides,
  getAddonBoardHeatmap,
  getAddonBoardLayout,
  getAddonBoardRideDetail,
  getAddonBoardRides,
  getAddonBoardSummary,
  deleteAddonBoardRideCustomWidget,
  getAddonBoardRideCustomWidgets,
  getAddonBoardWidgetSourceDraft,
  getAddonBoardZones,
  getAddonBoardZoneSummary,
  getOperationsFactsRide,
  patchAddonBoardRideCustomWidget,
  postAddonBoardPromoteWidgetFromDraft,
  putAddonBoardWidgetSourceDraft,
  type AddonBoardCustomWidgetHealth,
  type AddonBoardHeatmapPayload,
  type AddonBoardParkSummary,
  type AddonBoardRideCard,
  type AddonBoardRideCustomWidget,
  type AddonBoardRidesPayload,
  type AddonBoardWidgetSourceDraft,
  type AddonBoardWidgetSourcePreviewResponse,
  type AddonBoardZonesListPayload,
  type AddonBoardZoneSummary,
  type OperationFactRide,
  type AssetPredictiveMaintenancePayload,
} from '@/api/client'
import OperationsFactsRidePilotPanel from '@/components/operations/OperationsFactsRidePilotPanel.vue'
import BoardSignalSourcePicker from '@/components/addon-board/BoardSignalSourcePicker.vue'
import {
  addonBoardSignalSourcePickerEnabled,
  operationsFactsRideDashboardPilotEnabled,
} from '@/config/featureFlags'
import { useParkContextStore } from '@/stores/parkContext'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'

const { t } = useI18n()
const parkCtx = useParkContextStore()
const auth = useAuthStore()
const { push } = useToast()

const tab = ref<'l0' | 'l1' | 'l3'>('l0')
const loading = ref(false)
const summary = ref<AddonBoardParkSummary | null>(null)
const critical = ref<AddonBoardRideCard[]>([])
const ridesPayload = ref<AddonBoardRidesPayload | null>(null)
const zoneId = ref<string>('')
const zoneSummary = ref<AddonBoardZoneSummary | null>(null)
const zonesPayload = ref<AddonBoardZonesListPayload | null>(null)
const rideId = ref<string>('')
const rideDetail = ref<Record<string, unknown> | null>(null)
const operationsFactRide = ref<OperationFactRide | null>(null)
const operationsFactsLoading = ref(false)
const operationsFactsFailed = ref(false)
let loadRideDetailSeq = 0
let rideDetailDebounceTimer: ReturnType<typeof setTimeout> | null = null
const heatmapPayload = ref<AddonBoardHeatmapPayload | null>(null)
const l0WidgetIds = ref<string[]>([])
const l1WidgetIds = ref<string[]>([])
const l3WidgetIds = ref<string[]>([])
/** Phase F: picker selection (clears on ride change; not saved until Phase G save). */
const l3BoardSignalKey = ref<string | null>(null)
/** Phase G+H: saved draft + resolved preview from GET widget-source-draft. */
const widgetSourcePreview = ref<AddonBoardWidgetSourcePreviewResponse | null>(null)
const saveWidgetSourceBusy = ref(false)
/** Phase J: promoted custom widgets for L3 ride (`master_profile.addonBoardCustomWidgets`). */
const rideCustomWidgets = ref<AddonBoardRideCustomWidget[]>([])
const promoteWidgetBusy = ref(false)
/** Phase L: rename / enable / remove custom widgets */
const renamingWidgetId = ref<string | null>(null)
const renameDraftTitle = ref('')
const customWidgetActionBusyId = ref<string | null>(null)
const parkId = computed(() => parkCtx.activeParkId)
const canUpdateRides = computed(() => auth.hasPermission('rides', 'update'))

/** Phase M — counts from API `health` (invalid = invalid_source + entity_mismatch). */
const customWidgetHealthSummary = computed(() => {
  const w = rideCustomWidgets.value
  const total = w.length
  let ok = 0
  let invalid = 0
  let disabled = 0
  let noLive = 0
  for (const x of w) {
    const h = x.health
    if (h === 'disabled') disabled += 1
    else if (h === 'no_live_value') noLive += 1
    else if (h === 'invalid_source' || h === 'entity_mismatch') invalid += 1
    else ok += 1
  }
  return { total, ok, invalid, disabled, noLive }
})

function customWidgetHealthBadgeClass(h: AddonBoardCustomWidgetHealth | undefined): string {
  switch (h) {
    case 'ok':
      return 'bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700/40'
    case 'invalid_source':
    case 'entity_mismatch':
      return 'bg-amber-900/45 text-amber-100 ring-1 ring-amber-700/35'
    case 'disabled':
      return 'bg-slate-800 text-slate-400 ring-1 ring-slate-600/50'
    case 'no_live_value':
      return 'bg-sky-950/55 text-sky-200/90 ring-1 ring-sky-800/40'
    default:
      return 'bg-slate-800 text-slate-400 ring-1 ring-slate-600/40'
  }
}

/** Map deep-link: park + geo-pressure overlay (see `PlatformAssetMapView` query flags). */
const mapParkPressureQuery = computed(() => {
  const q: Record<string, string> = { pressure: '1' }
  if (parkId.value) q.parkId = parkId.value
  return q
})

function mapLinkForRide(assetId: string) {
  return { path: '/platform/map', query: { ...mapParkPressureQuery.value, assetId } }
}

/** Read-only widget-source live preview (scalar only; objects JSON-encoded). */
function formatWidgetSourceLiveValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const rideSwdec = computed(() => (rideDetail.value?.swdec as Record<string, unknown>) || {})
const rideWait = computed(() => (rideSwdec.value.waitingTime as Record<string, unknown>) || {})
const rideOperations = computed(() => (rideSwdec.value.rideOperations as Record<string, unknown>) || {})
const rideWeather = computed(() => (rideSwdec.value.weatherContext as Record<string, unknown>) || {})
const rideCrossAsset = computed(() => (rideSwdec.value.crossAssetContext as Record<string, unknown>) || {})
const rideCrossHints = computed(() => {
  const h = rideCrossAsset.value.hints
  if (!Array.isArray(h)) return [] as { code: string; severity?: string }[]
  return h.filter((x): x is { code: string; severity?: string } => {
    return Boolean(x && typeof x === 'object' && typeof (x as { code?: unknown }).code === 'string')
  })
})

function venueTripletNumeric(v: unknown): { r: number; s: number; sh: number } {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    r: Number(o.restaurants) || 0,
    s: Number(o.shops) || 0,
    sh: Number(o.shows) || 0,
  }
}

function venueTripletTotal(v: unknown): number {
  const { r, s, sh } = venueTripletNumeric(v)
  return r + s + sh
}

function formatVenueTripletLine(v: unknown): string {
  const { r, s, sh } = venueTripletNumeric(v)
  const parts: string[] = []
  if (r) parts.push(`${r} ${t('addonBoard.venuesRestaurantsShort')}`)
  if (s) parts.push(`${s} ${t('addonBoard.venuesShopsShort')}`)
  if (sh) parts.push(`${sh} ${t('addonBoard.venuesShowsShort')}`)
  return parts.join(' · ')
}

function crossHintLabel(code: string): string {
  return t(`addonBoard.crossHints.${code}`)
}

function hasRideCrossAssetDetail(cx: Record<string, unknown>): boolean {
  if (venueTripletTotal(cx.zoneVenues) > 0) return true
  const h = cx.hints
  return Array.isArray(h) && h.length > 0
}

function formatWeatherBannerLine(wx: Record<string, unknown> | null | undefined): string {
  if (!wx || typeof wx !== 'object') return ''
  const parts: string[] = []
  if (wx.temperatureC != null) parts.push(`${wx.temperatureC}°C`)
  if (wx.precipitationMm != null) parts.push(`${wx.precipitationMm} mm`)
  if (wx.windSpeedKmh != null) parts.push(`${wx.windSpeedKmh} km/h`)
  const cond = wx.weatherCondition != null ? String(wx.weatherCondition).trim() : ''
  if (cond) parts.push(cond)
  if (wx.rainProbabilityPercent != null) parts.push(`${wx.rainProbabilityPercent}%`)
  return parts.join(' · ')
}

function hasRideWeatherDetail(wx: Record<string, unknown>): boolean {
  return Boolean(
    formatWeatherBannerLine(wx) ||
      wx.rainSensitive != null ||
      wx.weatherSensitive != null ||
      wx.weatherSensitivityScore != null ||
      wx.contextAsOf != null ||
      (Array.isArray(wx.dataLayers) && wx.dataLayers.length > 0)
  )
}

function weatherLayersLabel(wx: Record<string, unknown>): string {
  const layers = wx.dataLayers
  if (!Array.isArray(layers)) return ''
  return layers.map(String).join(', ')
}
const rideMlFactors = computed(() => {
  const raw = rideDetail.value?.mlTopFactors
  return Array.isArray(raw) ? (raw as { feature: string; impact: string }[]) : []
})

const zoneSelectOptions = computed(() => {
  const rows = zonesPayload.value?.zones ?? []
  return rows.map((z) => ({
    id: z.zoneId,
    name: `${z.zoneName} (${z.rideCount})`,
  }))
})

function showL0Widget(id: string) {
  if (!l0WidgetIds.value.length) return true
  return l0WidgetIds.value.includes(id)
}

function showL1Widget(id: string) {
  if (!l1WidgetIds.value.length) return true
  return l1WidgetIds.value.includes(id)
}

function showL3Widget(id: string) {
  if (!l3WidgetIds.value.length) return true
  return l3WidgetIds.value.includes(id)
}

const hotspotRows = computed(() => {
  const h = heatmapPayload.value?.hotspots ?? []
  return h.slice(0, 10)
})

/** ML / baseline horizons — same order as “Wartezeit-Prognosen” card. */
function swdecForecastHorizonsLine(wt: Record<string, unknown>): string {
  const parts: string[] = []
  if (wt.forecastWaitTime5 != null) parts.push(`5′ ${wt.forecastWaitTime5}`)
  if (wt.forecastWaitTime10 != null) parts.push(`10′ ${wt.forecastWaitTime10}`)
  if (wt.forecastWaitTime15 != null) parts.push(`15′ ${wt.forecastWaitTime15}`)
  if (wt.forecastWaitTime30 != null) parts.push(`30′ ${wt.forecastWaitTime30}`)
  if (wt.forecastWaitTime60 != null) parts.push(`60′ ${wt.forecastWaitTime60}`)
  return parts.join(' · ')
}

function swdecDeliveryPill(wt: Record<string, unknown>, del: Record<string, unknown>): { primary: string; secondary: string } {
  const forecastLine = swdecForecastHorizonsLine(wt)
  const waitPrimary = wt.currentWaitTimeMinutes != null ? `${wt.currentWaitTimeMinutes}′` : null
  const throughputPrimary =
    del.actualThroughputPph != null ? `${del.actualThroughputPph} pph` : null
  const maxCap =
    del.theoreticalCapacityPph != null ? `max ${del.theoreticalCapacityPph}` : ''

  if (waitPrimary != null) {
    const throughputHint = [throughputPrimary, maxCap].filter(Boolean).join(' · ')
    const secondary = forecastLine || throughputHint
    return { primary: waitPrimary, secondary }
  }

  if (forecastLine) {
    if (throughputPrimary != null) return { primary: throughputPrimary, secondary: forecastLine }
    return { primary: forecastLine, secondary: maxCap }
  }

  return {
    primary: throughputPrimary ?? '—',
    secondary: maxCap,
  }
}

const swdecPills = computed(() => {
  const s = rideSwdec.value
  if (!s || !Object.keys(s).length) return []
  const safety = (s.safety as Record<string, unknown>) || {}
  const wt = (s.waitingTime as Record<string, unknown>) || {}
  const del = (s.delivery as Record<string, unknown>) || {}
  const eff = (s.efficiency as Record<string, unknown>) || {}
  const crew = (s.costCrew as Record<string, unknown>) || {}
  const inc = safety.incidentsToday != null ? String(safety.incidentsToday) : '—'
  const deliveryPill = swdecDeliveryPill(wt, del)
  return [
    { key: 'S', labelKey: 'swdecS' as const, primary: String(safety.status ?? '—'), secondary: `${inc}` },
    {
      key: 'W',
      labelKey: 'swdecW' as const,
      primary: wt.currentWaitTimeMinutes != null ? `${wt.currentWaitTimeMinutes}′` : '—',
      secondary: wt.forecastWaitTime60 != null ? `60′→ ${wt.forecastWaitTime60}` : '',
    },
    {
      key: 'D',
      labelKey: 'swdecD' as const,
      primary: deliveryPill.primary,
      secondary: deliveryPill.secondary,
    },
    {
      key: 'E',
      labelKey: 'swdecE' as const,
      primary: eff.rideOeePercent != null ? `${eff.rideOeePercent}%` : '—',
      secondary:
        eff.rideOeeSource === 'MQTT_SPARKPLUG'
          ? [
              t('addonBoard.oeeFromMqttShort'),
              eff.performancePercent != null ? `perf ${eff.performancePercent}%` : '',
              eff.availabilityPercent != null ? `${t('addonBoard.availabilityShort')} ${eff.availabilityPercent}%` : '',
            ]
              .filter(Boolean)
              .join(' · ')
          : [
              eff.performancePercent != null ? `perf ${eff.performancePercent}%` : '',
              eff.availabilityPercent != null ? `${t('addonBoard.availabilityShort')} ${eff.availabilityPercent}%` : '',
            ]
              .filter(Boolean)
              .join(' · '),
    },
    {
      key: 'C',
      labelKey: 'swdecC' as const,
      primary: crew.crewGap != null ? `${crew.crewGap}` : '—',
      secondary: crew.plannedCrew != null ? `plan ${crew.plannedCrew}` : '',
    },
  ]
})

async function loadL0() {
  if (!parkId.value) return
  loading.value = true
  try {
    const [s, c, layout, heat] = await Promise.all([
      getAddonBoardSummary(),
      getAddonBoardCriticalRides({ limit: 20 }),
      getAddonBoardLayout({ boardId: 'park-management-default' }).catch(() => null),
      getAddonBoardHeatmap().catch(() => null),
    ])
    summary.value = s
    critical.value = c.rides
    l0WidgetIds.value = layout?.widgets?.map((w) => w.id) ?? []
    heatmapPayload.value = heat
  } catch (e) {
    push((e as Error).message || 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadZonesForL1() {
  if (!parkId.value) return
  loading.value = true
  try {
    const [zones, heat, layout] = await Promise.all([
      getAddonBoardZones(),
      getAddonBoardHeatmap().catch(() => null),
      getAddonBoardLayout({ boardId: 'zone-management-default' }).catch(() => null),
    ])
    zonesPayload.value = zones
    heatmapPayload.value = heat ?? heatmapPayload.value
    l1WidgetIds.value = layout?.widgets?.map((w) => w.id) ?? []
    if (!zoneId.value && zones.zones.length) zoneId.value = zones.zones[0]!.zoneId
    await loadZoneSummary()
  } catch (e) {
    push((e as Error).message || 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadRidesIfNeeded() {
  if (!parkId.value) return
  if (ridesPayload.value) return
  loading.value = true
  try {
    ridesPayload.value = await getAddonBoardRides()
    const rides = ridesPayload.value.rides
    if (!rideId.value && rides.length) rideId.value = rides[0]!.rideId
  } catch (e) {
    push((e as Error).message || 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadLayoutL3() {
  try {
    const layout = await getAddonBoardLayout({ boardId: 'ride-operations-default' })
    l3WidgetIds.value = layout.widgets.map((w) => w.id)
  } catch {
    l3WidgetIds.value = []
  }
}

async function loadZoneSummary() {
  if (!parkId.value || !zoneId.value) return
  loading.value = true
  try {
    zoneSummary.value = await getAddonBoardZoneSummary(zoneId.value)
  } catch (e) {
    push((e as Error).message || 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadRideDetail() {
  if (!parkId.value || !rideId.value) return
  const seq = ++loadRideDetailSeq
  loading.value = true
  operationsFactRide.value = null
  operationsFactsFailed.value = false
  operationsFactsLoading.value = operationsFactsRideDashboardPilotEnabled

  const legacyP = getAddonBoardRideDetail(rideId.value)
  const factsP = operationsFactsRideDashboardPilotEnabled
    ? getOperationsFactsRide(rideId.value).then(
        (data) => ({ ok: true as const, data }),
        () => ({ ok: false as const })
      )
    : Promise.resolve<'skip'>('skip')

  const settled = await Promise.allSettled([legacyP, factsP])
  if (seq !== loadRideDetailSeq) return

  const leg = settled[0]
  if (leg.status === 'fulfilled') {
    rideDetail.value = leg.value
  } else {
    rideDetail.value = null
    const msg =
      leg.reason instanceof Error ? leg.reason.message : String(leg.reason ?? 'Error')
    push(msg || 'Error', 'error')
  }

  const frCell = settled[1]
  if (operationsFactsRideDashboardPilotEnabled && frCell.status === 'fulfilled' && frCell.value !== 'skip') {
    const fr = frCell.value
    if (fr.ok) {
      operationsFactRide.value = fr.data
      operationsFactsFailed.value = false
    } else {
      operationsFactRide.value = null
      operationsFactsFailed.value = true
      push(t('operationsFactsPilot.loadFailed'), 'error')
    }
  }
  operationsFactsLoading.value = false
  loading.value = false
  if (seq === loadRideDetailSeq && addonBoardSignalSourcePickerEnabled && rideId.value) {
    void loadRideCustomWidgets()
  }
}

async function loadSavedWidgetSourceDraft() {
  if (!addonBoardSignalSourcePickerEnabled || !rideId.value) {
    widgetSourcePreview.value = null
    return
  }
  try {
    widgetSourcePreview.value = await getAddonBoardWidgetSourceDraft(rideId.value)
  } catch {
    widgetSourcePreview.value = null
  }
}

async function loadRideCustomWidgets() {
  if (!addonBoardSignalSourcePickerEnabled || !rideId.value) {
    rideCustomWidgets.value = []
    return
  }
  try {
    rideCustomWidgets.value = await getAddonBoardRideCustomWidgets(rideId.value)
  } catch {
    rideCustomWidgets.value = []
  }
}

async function promoteWidgetToBoard() {
  if (!rideId.value || !addonBoardSignalSourcePickerEnabled || !widgetSourcePreview.value?.resolved.valid) return
  promoteWidgetBusy.value = true
  try {
    await postAddonBoardPromoteWidgetFromDraft(rideId.value)
    await loadRideCustomWidgets()
    push(t('addonBoard.promoteToBoardWidgetSuccess'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.promoteToBoardWidgetFailed'), 'error')
  } finally {
    promoteWidgetBusy.value = false
  }
}

function startRenameCustomWidget(cw: AddonBoardRideCustomWidget) {
  renamingWidgetId.value = cw.widgetId
  renameDraftTitle.value = cw.title
}

function cancelRenameCustomWidget() {
  renamingWidgetId.value = null
  renameDraftTitle.value = ''
}

async function saveRenameCustomWidget() {
  if (!rideId.value || !renamingWidgetId.value) return
  const title = renameDraftTitle.value.trim()
  if (!title) {
    push(t('addonBoard.customWidgetTitleRequired'), 'error')
    return
  }
  const wid = renamingWidgetId.value
  customWidgetActionBusyId.value = wid
  try {
    await patchAddonBoardRideCustomWidget(rideId.value, wid, { title })
    await loadRideCustomWidgets()
    renamingWidgetId.value = null
    renameDraftTitle.value = ''
    push(t('addonBoard.customWidgetUpdated'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.customWidgetLifecycleFailed'), 'error')
  } finally {
    customWidgetActionBusyId.value = null
  }
}

async function toggleCustomWidgetEnabled(cw: AddonBoardRideCustomWidget, ev: Event) {
  if (!rideId.value) return
  const el = ev.target as HTMLInputElement | null
  const next = el?.checked ?? cw.enabled
  customWidgetActionBusyId.value = cw.widgetId
  try {
    await patchAddonBoardRideCustomWidget(rideId.value, cw.widgetId, { enabled: next })
    await loadRideCustomWidgets()
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.customWidgetLifecycleFailed'), 'error')
    if (el) el.checked = cw.enabled
  } finally {
    customWidgetActionBusyId.value = null
  }
}

async function removeCustomWidget(cw: AddonBoardRideCustomWidget) {
  if (!rideId.value) return
  const ok = await askConfirm({
    message: t('addonBoard.customWidgetRemoveConfirm'),
    confirmLabel: 'Ja',
    cancelLabel: 'Abbrechen',
    variant: 'danger',
  })
  if (!ok) return
  customWidgetActionBusyId.value = cw.widgetId
  try {
    await deleteAddonBoardRideCustomWidget(rideId.value, cw.widgetId)
    if (renamingWidgetId.value === cw.widgetId) cancelRenameCustomWidget()
    await loadRideCustomWidgets()
    push(t('addonBoard.customWidgetRemoved'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.customWidgetLifecycleFailed'), 'error')
  } finally {
    customWidgetActionBusyId.value = null
  }
}

async function saveWidgetSourceToServer() {
  if (!rideId.value || !l3BoardSignalKey.value || !addonBoardSignalSourcePickerEnabled) return
  saveWidgetSourceBusy.value = true
  try {
    const body: AddonBoardWidgetSourceDraft = {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: rideId.value,
      signalKey: l3BoardSignalKey.value,
    }
    await putAddonBoardWidgetSourceDraft(rideId.value, body)
    await loadSavedWidgetSourceDraft()
    push(t('addonBoard.widgetSourceSaved'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.widgetSourceSaveFailed'), 'error')
  } finally {
    saveWidgetSourceBusy.value = false
  }
}

async function refresh() {
  summary.value = null
  critical.value = []
  ridesPayload.value = null
  zonesPayload.value = null
  zoneSummary.value = null
  rideDetail.value = null
  operationsFactRide.value = null
  operationsFactsFailed.value = false
  operationsFactsLoading.value = false
  heatmapPayload.value = null
  l0WidgetIds.value = []
  l1WidgetIds.value = []
  l3BoardSignalKey.value = null
  widgetSourcePreview.value = null
  rideCustomWidgets.value = []
  renamingWidgetId.value = null
  renameDraftTitle.value = ''
  customWidgetActionBusyId.value = null
  if (tab.value === 'l0') await loadL0()
  if (tab.value === 'l1') {
    await loadZonesForL1()
  }
  if (tab.value === 'l3') {
    await loadRidesIfNeeded()
    await loadLayoutL3()
    if (rideId.value) {
      await loadRideDetail()
      await loadSavedWidgetSourceDraft()
      await loadRideCustomWidgets()
    }
  }
}

watch(
  () => parkId.value,
  async (id) => {
    summary.value = null
    critical.value = []
    ridesPayload.value = null
    zonesPayload.value = null
    zoneSummary.value = null
    rideDetail.value = null
    operationsFactRide.value = null
    operationsFactsFailed.value = false
    operationsFactsLoading.value = false
    heatmapPayload.value = null
    l0WidgetIds.value = []
    l1WidgetIds.value = []
    l3WidgetIds.value = []
    l3BoardSignalKey.value = null
    widgetSourcePreview.value = null
    rideCustomWidgets.value = []
    renamingWidgetId.value = null
    renameDraftTitle.value = ''
    customWidgetActionBusyId.value = null
    zoneId.value = ''
    rideId.value = ''
    if (!id) return
    if (tab.value === 'l0') await loadL0()
  },
  { immediate: true }
)

watch(tab, async (v) => {
  if (!parkId.value) return
  if (v === 'l0') await loadL0()
  if (v === 'l1') {
    await loadZonesForL1()
  }
  if (v === 'l3') {
    await loadRidesIfNeeded()
    await loadLayoutL3()
    const rides = ridesPayload.value?.rides ?? []
    if (!rideId.value && rides.length) rideId.value = rides[0]!.rideId
    if (rideId.value) {
      await loadRideDetail()
      await loadSavedWidgetSourceDraft()
      await loadRideCustomWidgets()
    }
  }
})

watch(zoneId, async () => {
  if (tab.value === 'l1' && parkId.value) await loadZoneSummary()
})

watch(rideId, (next, prev) => {
  if (next !== prev) {
    l3BoardSignalKey.value = null
    renamingWidgetId.value = null
    renameDraftTitle.value = ''
    customWidgetActionBusyId.value = null
    if (addonBoardSignalSourcePickerEnabled && tab.value === 'l3' && next) {
      void loadSavedWidgetSourceDraft()
      void loadRideCustomWidgets()
    } else {
      widgetSourcePreview.value = null
      rideCustomWidgets.value = []
    }
  }
  if (tab.value !== 'l3' || !parkId.value || !rideId.value) return
  if (rideDetailDebounceTimer) clearTimeout(rideDetailDebounceTimer)
  rideDetailDebounceTimer = setTimeout(() => {
    rideDetailDebounceTimer = null
    void loadRideDetail()
  }, 200)
})

onBeforeUnmount(() => {
  if (rideDetailDebounceTimer) clearTimeout(rideDetailDebounceTimer)
})

function statusClass(status: string) {
  if (status === 'GREEN') return 'text-emerald-400'
  if (status === 'YELLOW') return 'text-amber-300'
  if (status === 'RED') return 'text-rose-400'
  return 'text-slate-400'
}

function sevClass(sev: string) {
  if (sev === 'CRITICAL') return 'text-rose-400'
  if (sev === 'HIGH') return 'text-amber-300'
  return 'text-slate-300'
}

function pdmRiskClass(risk: string) {
  if (risk === 'CRITICAL') return 'text-rose-400'
  if (risk === 'HIGH') return 'text-amber-300'
  if (risk === 'MEDIUM') return 'text-sky-300'
  return 'text-slate-400'
}

function ridePdmPayload(r: AddonBoardRideCard): AssetPredictiveMaintenancePayload | null {
  const p = r.predictiveMaintenance
  if (!p || typeof p !== 'object') return null
  return p as AssetPredictiveMaintenancePayload
}

const rideSeverity = computed(() => String(rideDetail.value?.severity || 'LOW'))

function pillWrapClassFromSeverity(sev: string) {
  if (sev === 'CRITICAL') return 'border-rose-600/75 bg-rose-950/30'
  if (sev === 'HIGH') return 'border-amber-500/65 bg-amber-950/25'
  if (sev === 'MEDIUM') return 'border-slate-500/80 bg-slate-900/35'
  return 'border-slate-700 bg-slate-950/40'
}

function heatField(h: Record<string, unknown>, key: string): string | number {
  const v = h[key]
  if (v == null) return '—'
  return typeof v === 'number' || typeof v === 'string' ? v : '—'
}

function addonSwdecWaitField(swdec: unknown, field: 'currentWaitTimeMinutes' | 'forecastWaitTime60'): string | number {
  const root = typeof swdec === 'object' && swdec ? (swdec as Record<string, unknown>) : {}
  const wt = root.waitingTime as Record<string, unknown> | undefined
  const v = wt?.[field]
  if (v == null) return '—'
  return typeof v === 'number' || typeof v === 'string' ? v : '—'
}

const rideAiRecommendationTitle = computed(() => {
  const ar = rideDetail.value?.aiRecommendation
  if (typeof ar !== 'object' || !ar) return ''
  return String((ar as { title?: unknown }).title ?? '')
})

const rideAiRecommendationImpact = computed(() => {
  const ar = rideDetail.value?.aiRecommendation
  if (typeof ar !== 'object' || !ar) return ''
  return String((ar as { expectedImpact?: unknown }).expectedImpact ?? '')
})

function swdecPillWrapClass(pillKey: string) {
  if (pillKey === 'S') {
    const safety = (rideSwdec.value.safety as Record<string, unknown>) || {}
    const st = String(safety.status || '').toUpperCase()
    if (st === 'CRITICAL') return 'border-rose-500/85 bg-rose-950/40'
    if (st === 'WARNING') return 'border-amber-500/70 bg-amber-950/30'
    return pillWrapClassFromSeverity(rideSeverity.value)
  }
  if (pillKey === 'W' || pillKey === 'D') {
    const wt = (rideSwdec.value.waitingTime as Record<string, unknown>) || {}
    const w = wt.currentWaitTimeMinutes
    const n = typeof w === 'number' ? w : Number(w)
    if (Number.isFinite(n) && n >= 90) return 'border-rose-600/70 bg-rose-950/25'
    if (Number.isFinite(n) && n >= 65) return 'border-amber-500/65 bg-amber-950/25'
    if (Number.isFinite(n) && n >= 45) return 'border-slate-500/80 bg-slate-900/35'
  }
  return pillWrapClassFromSeverity(rideSeverity.value)
}
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-6 text-slate-100 sm:px-6">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight text-white">
          {{ t('addonBoard.title') }}
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('addonBoard.subtitle') }}</p>
      </div>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="!parkId || loading"
        @click="refresh"
      >
        {{ t('addonBoard.refresh') }}
      </button>
    </div>

    <div v-if="!parkId" class="rounded-lg border border-amber-900/40 bg-amber-950/20 p-6 text-sm text-amber-100">
      {{ t('addonBoard.needPark') }}
    </div>

    <template v-else>
      <div class="mb-4 flex gap-1 rounded-lg border border-slate-700 bg-slate-900/50 p-1">
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium"
          :class="tab === 'l0' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'"
          @click="tab = 'l0'"
        >
          {{ t('addonBoard.tabL0') }}
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium"
          :class="tab === 'l1' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'"
          @click="tab = 'l1'"
        >
          {{ t('addonBoard.tabL1') }}
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium"
          :class="tab === 'l3' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'"
          @click="tab = 'l3'"
        >
          {{ t('addonBoard.tabL3') }}
        </button>
      </div>

      <div v-if="loading && !summary && tab === 'l0'" class="text-sm text-slate-500">…</div>

      <!-- L0 -->
      <div v-if="tab === 'l0' && summary" class="space-y-6">
        <p v-if="l0WidgetIds.length" class="text-xs text-slate-500">
          {{ t('addonBoard.layoutStrip') }}: <span class="text-slate-300">{{ l0WidgetIds.join(', ') }}</span>
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.parkHealth') }}
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="text-3xl font-semibold">{{ summary.parkHealthScore }}</span>
              <span class="text-sm font-medium" :class="statusClass(summary.status)">{{ summary.status }}</span>
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.openRides') }}
            </div>
            <div class="mt-2 text-3xl font-semibold">
              {{ summary.openRides }}<span class="text-lg font-normal opacity-60">/{{ summary.totalRides }}</span>
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.avgWait') }}
            </div>
            <div class="mt-2 text-3xl font-semibold">
              {{ summary.averageWaitTimeMinutes != null ? `${summary.averageWaitTimeMinutes}′` : '—' }}
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.demandForecast') }}
            </div>
            <div class="mt-2 text-xl font-semibold">{{ summary.forecastDemandIndex }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ t('addonBoard.criticalRides') }}: {{ summary.criticalRides }}</div>
          </div>
        </div>

        <div
          v-if="summary.weatherContext && formatWeatherBannerLine(summary.weatherContext as Record<string, unknown>)"
          class="rounded-lg border border-sky-900/40 bg-sky-950/20 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-sky-400/90">
            {{ t('addonBoard.weatherContextTitle') }} · {{ t('addonBoard.scopePark') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatWeatherBannerLine(summary.weatherContext as Record<string, unknown>) }}
          </p>
          <p v-if="summary.weatherContext.contextAsOf" class="mt-1 text-[11px] text-slate-500">
            {{ t('addonBoard.weatherAsOf') }}: {{ summary.weatherContext.contextAsOf }}
          </p>
        </div>

        <div
          v-if="summary.crossAssetContext"
          class="rounded-lg border border-amber-900/35 bg-amber-950/15 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
            {{ t('addonBoard.crossAssetContextTitle') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatVenueTripletLine(summary.crossAssetContext.parkVenues) }}
            <span
              v-if="summary.crossAssetContext.zonesWithVenues != null"
              class="text-slate-500"
            >
              ·
              {{
                t('addonBoard.venuesZonesWithVenues', { n: summary.crossAssetContext.zonesWithVenues })
              }}
            </span>
          </p>
          <p class="mt-1 text-[11px] text-slate-500">{{ t('addonBoard.crossAssetContextHint') }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.avgFcst60') }}
            </div>
            <div class="mt-2 text-2xl font-semibold">
              {{
                summary.averageForecastWaitTime60 != null ? `${summary.averageForecastWaitTime60}′` : '—'
              }}
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.forecastRiskRides') }}
            </div>
            <div class="mt-2 text-2xl font-semibold">
              {{ summary.forecastCriticalRides60 ?? '—'
              }}<span v-if="summary.forecastCriticalAtMinutes != null" class="text-sm font-normal opacity-60">
                @≥{{ summary.forecastCriticalAtMinutes }}′</span>
            </div>
          </div>
        </div>

        <div
          v-if="showL0Widget('geo-heatmap') && heatmapPayload && !heatmapPayload.error"
          class="rounded-lg border border-slate-800 bg-slate-900/60"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
            <span class="text-sm font-semibold text-white">{{ t('addonBoard.heatmapTitle') }}</span>
            <RouterLink class="text-sm text-sky-400 hover:underline" :to="{ path: '/platform/map', query: mapParkPressureQuery }">
              {{ t('addonBoard.linkAssetMap') }}
            </RouterLink>
          </div>
          <div class="overflow-x-auto px-4 py-3">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-700 text-xs uppercase text-slate-500">
                  <th class="py-2 pr-4">{{ t('addonBoard.heatmapHotspots') }}</th>
                  <th class="py-2 pr-4">{{ t('addonBoard.wait') }}</th>
                  <th class="py-2">score</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(h, i) in hotspotRows" :key="i" class="border-b border-slate-800/80">
                  <td class="py-2 pr-4 font-medium">{{ heatField(h, 'name') }}</td>
                  <td class="py-2 pr-4">{{ heatField(h, 'waitMinutes') }}</td>
                  <td class="py-2">{{ heatField(h, 'pressureScore') }}</td>
                </tr>
                <tr v-if="!hotspotRows.length">
                  <td class="py-6 text-center opacity-70" colspan="3">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="rounded-lg border border-slate-800 bg-slate-900/60">
          <div class="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-white">
            {{ t('addonBoard.criticalTable') }}
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-700 text-xs uppercase text-slate-500">
                  <th class="px-4 py-2">{{ t('addonBoard.ride') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.zone') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.wait') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.f60') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.severity') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.pdmColumnShort') }}</th>
                  <th class="px-4 py-2">{{ t('addonBoard.links') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in critical" :key="r.rideId" class="border-b border-slate-800/80">
                  <td class="px-4 py-2 font-medium">{{ r.rideName }}</td>
                  <td class="px-4 py-2">{{ r.zone ?? '—' }}</td>
                  <td class="px-4 py-2">
                    {{ addonSwdecWaitField(r.swdec, 'currentWaitTimeMinutes') }}
                  </td>
                  <td class="px-4 py-2">
                    {{ addonSwdecWaitField(r.swdec, 'forecastWaitTime60') }}
                  </td>
                  <td class="px-4 py-2 font-medium" :class="sevClass(r.severity)">{{ r.severity }}</td>
                  <td class="px-4 py-2 font-medium" :class="pdmRiskClass(ridePdmPayload(r)?.riskLevel ?? 'LOW')">
                    {{ ridePdmPayload(r)?.riskLevel ?? '—' }}
                  </td>
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap gap-x-3 gap-y-1 text-sky-400">
                      <RouterLink class="hover:underline" :to="`/platform/rides/${r.rideId}`">
                        {{ t('addonBoard.linkRideMaster') }}
                      </RouterLink>
                      <RouterLink class="hover:underline" to="/platform/live-queue">
                        {{ t('addonBoard.linkLiveQueue') }}
                      </RouterLink>
                      <RouterLink class="hover:underline" :to="mapLinkForRide(r.rideId)">
                        {{ t('addonBoard.linkAssetMap') }}
                      </RouterLink>
                    </div>
                  </td>
                </tr>
                <tr v-if="!critical.length">
                  <td class="px-4 py-6 text-center opacity-70" colspan="7">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- L1 -->
      <div v-if="tab === 'l1'" class="space-y-4">
        <p v-if="l1WidgetIds.length" class="text-xs text-slate-500">
          {{ t('addonBoard.layoutStrip') }}: <span class="text-slate-300">{{ l1WidgetIds.join(', ') }}</span>
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-sm font-medium text-white">{{ t('addonBoard.zoneSelect') }}</label>
          <select
            v-model="zoneId"
            class="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            :disabled="!zoneSelectOptions.length"
          >
            <option v-for="z in zoneSelectOptions" :key="z.id" :value="z.id">{{ z.name }}</option>
          </select>
        </div>
        <div
          v-if="showL1Widget('geo-heatmap') && heatmapPayload && !heatmapPayload.error"
          class="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm font-semibold text-white">{{ t('addonBoard.heatmapTitle') }}</span>
            <RouterLink class="text-sm text-sky-400 hover:underline" :to="{ path: '/platform/map', query: mapParkPressureQuery }">
              {{ t('addonBoard.linkAssetMap') }}
            </RouterLink>
          </div>
          <ul class="list-inside list-disc text-sm text-slate-300">
            <li v-for="(h, i) in hotspotRows" :key="i">
              {{ heatField(h, 'name') }} — wait {{ heatField(h, 'waitMinutes') }}, score
              {{ heatField(h, 'pressureScore') }}
            </li>
            <li v-if="!hotspotRows.length" class="list-none text-slate-500">—</li>
          </ul>
        </div>
        <div v-if="zoneSummary" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ t('addonBoard.zoneSummary') }}</div>
            <div class="mt-2 text-lg font-semibold">{{ zoneSummary.zoneName }}</div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ t('addonBoard.ridesInZone') }}</div>
            <div class="mt-2 text-3xl font-semibold">{{ zoneSummary.ridesInZone }}</div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ t('addonBoard.avgWait') }}</div>
            <div class="mt-2 text-3xl font-semibold">
              {{ zoneSummary.zoneAverageWaitTimeMinutes != null ? `${zoneSummary.zoneAverageWaitTimeMinutes}′` : '—' }}
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ t('addonBoard.f60') }} (ø)</div>
            <div class="mt-2 text-3xl font-semibold">{{ zoneSummary.zoneForecastWaitTime60 ?? '—' }}</div>
            <div class="mt-1 text-xs text-slate-500">
              {{ t('addonBoard.forecastRiskRides') }}: {{ zoneSummary.zoneForecastCriticalRides }}
              <span v-if="zoneSummary.forecastCriticalAtMinutes != null">
                (≥{{ zoneSummary.forecastCriticalAtMinutes }}′)</span>
            </div>
          </div>
          <div
            v-if="zoneSummary.zoneDemandForecastIndex"
            class="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
          >
            <div class="text-xs uppercase tracking-wide text-slate-500">{{ t('addonBoard.zoneDemandFcst') }}</div>
            <div class="mt-2 text-xl font-semibold">{{ zoneSummary.zoneDemandForecastIndex }}</div>
          </div>
        </div>
        <div
          v-if="
            zoneSummary?.weatherContext &&
            formatWeatherBannerLine(zoneSummary.weatherContext as Record<string, unknown>)
          "
          class="rounded-lg border border-sky-900/40 bg-sky-950/20 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-sky-400/90">
            {{ t('addonBoard.weatherContextTitle') }} · {{ t('addonBoard.scopePark') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatWeatherBannerLine(zoneSummary.weatherContext as Record<string, unknown>) }}
          </p>
          <p v-if="zoneSummary.weatherContext.contextAsOf" class="mt-1 text-[11px] text-slate-500">
            {{ t('addonBoard.weatherAsOf') }}: {{ zoneSummary.weatherContext.contextAsOf }}
          </p>
        </div>
        <div
          v-if="zoneSummary?.crossAssetContext"
          class="rounded-lg border border-amber-900/35 bg-amber-950/15 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
            {{ t('addonBoard.crossAssetZoneTitle') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatVenueTripletLine(zoneSummary.crossAssetContext.zoneVenues) }}
          </p>
          <p class="mt-1 text-xs text-slate-400">
            {{ t('addonBoard.crossAssetParkTotals') }}: {{ formatVenueTripletLine(zoneSummary.crossAssetContext.parkVenues) }}
          </p>
        </div>
      </div>

      <!-- L3 -->
      <div v-if="tab === 'l3'" class="space-y-4" data-testid="addon-board-l3-tab">
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-sm font-medium text-white">{{ t('addonBoard.rideSelect') }}</label>
          <select
            v-model="rideId"
            class="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            <option v-for="r in ridesPayload?.rides ?? []" :key="r.rideId" :value="r.rideId">{{ r.rideName }}</option>
          </select>
        </div>

        <div
          v-if="
            ridesPayload?.weatherContext &&
            formatWeatherBannerLine(ridesPayload.weatherContext as Record<string, unknown>)
          "
          class="rounded-lg border border-sky-900/40 bg-sky-950/20 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-sky-400/90">
            {{ t('addonBoard.weatherContextTitle') }} · {{ t('addonBoard.scopePark') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatWeatherBannerLine(ridesPayload.weatherContext as Record<string, unknown>) }}
          </p>
          <p v-if="ridesPayload.weatherContext.contextAsOf" class="mt-1 text-[11px] text-slate-500">
            {{ t('addonBoard.weatherAsOf') }}: {{ ridesPayload.weatherContext.contextAsOf }}
          </p>
        </div>

        <div
          v-if="ridesPayload?.crossAssetContext"
          class="rounded-lg border border-amber-900/35 bg-amber-950/15 px-4 py-3"
        >
          <div class="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
            {{ t('addonBoard.crossAssetContextTitle') }}
          </div>
          <p class="mt-1 text-sm text-slate-200">
            {{ formatVenueTripletLine(ridesPayload.crossAssetContext.parkVenues) }}
            <span
              v-if="ridesPayload.crossAssetContext.zonesWithVenues != null"
              class="text-slate-500"
            >
              ·
              {{
                t('addonBoard.venuesZonesWithVenues', { n: ridesPayload.crossAssetContext.zonesWithVenues })
              }}
            </span>
          </p>
        </div>

        <p v-if="rideId" class="text-xs text-slate-500">
          {{ t('addonBoard.pdmBoardHint') }}
          <RouterLink
            class="text-brand-400 hover:underline"
            :to="{ path: '/operations/predictive-maintenance', query: { assetId: rideId } }"
          >
            {{ t('menu.predictiveMaintenance') }}
          </RouterLink>
        </p>

        <div
          v-if="addonBoardSignalSourcePickerEnabled && rideId"
          class="rounded-lg border border-slate-700 bg-slate-900/40 p-4"
          data-testid="addon-board-signal-picker-panel"
        >
          <p class="text-sm font-semibold text-white">
            {{ t('addonBoard.customSignalWidgetsSectionTitle') }}
          </p>
          <p class="mt-1 text-xs text-slate-500">
            {{ t('addonBoard.customSignalWidgetsHelp') }}
          </p>
          <p
            class="mt-2 rounded-md border border-slate-700/80 bg-slate-800/35 px-3 py-2 text-[11px] leading-relaxed text-slate-400"
            data-testid="addon-board-custom-signal-widgets-banner"
          >
            {{ t('addonBoard.customSignalWidgetsApprovedBanner') }}
          </p>
          <div class="mt-3">
            <BoardSignalSourcePicker
              entity-type="park_asset"
              :entity-id="rideId"
              v-model="l3BoardSignalKey"
            />
          </div>
          <div v-if="canUpdateRides" class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              :disabled="!l3BoardSignalKey || saveWidgetSourceBusy"
              @click="saveWidgetSourceToServer"
            >
              {{ t('addonBoard.saveWidgetSource') }}
            </button>
          </div>
        </div>

        <div
          v-if="addonBoardSignalSourcePickerEnabled && rideId && widgetSourcePreview"
          class="rounded-lg border border-slate-700 bg-slate-900/55 p-4"
          data-testid="addon-board-widget-source-preview"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('addonBoard.widgetSourcePreviewTitle') }}</p>
          <h3 class="mt-1 font-mono text-sm font-semibold text-white">{{ widgetSourcePreview.draft.signalKey }}</h3>
          <dl class="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewSourceType') }}</dt>
              <dd class="mt-0.5 font-mono text-[11px]">{{ widgetSourcePreview.draft.sourceType }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewEntity') }}</dt>
              <dd class="mt-0.5">
                {{ widgetSourcePreview.draft.entityType === 'park_asset' ? t('addonBoard.previewEntityRideAsset') : widgetSourcePreview.draft.entityType }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewDomain') }}</dt>
              <dd class="mt-0.5 font-mono text-[11px]">{{ widgetSourcePreview.resolved.domain }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewMetric') }}</dt>
              <dd class="mt-0.5 font-mono text-[11px]">{{ widgetSourcePreview.resolved.metric }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewStatus') }}</dt>
              <dd class="mt-0.5">
                <span
                  class="rounded px-2 py-0.5 text-[11px] font-medium"
                  :class="
                    widgetSourcePreview.resolved.valid
                      ? 'bg-emerald-900/40 text-emerald-200'
                      : 'bg-amber-900/40 text-amber-100'
                  "
                >
                  {{
                    widgetSourcePreview.resolved.valid
                      ? t('addonBoard.previewStatusValid')
                      : t('addonBoard.previewStatusInvalid')
                  }}
                </span>
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('addonBoard.previewFlags') }}</dt>
              <dd class="mt-0.5 text-[11px] text-slate-400">
                enabled={{ widgetSourcePreview.resolved.enabled ? t('addonBoard.signalSourceYes') : t('addonBoard.signalSourceNo') }},
                boardEligible={{ widgetSourcePreview.resolved.boardEligible ? t('addonBoard.signalSourceYes') : t('addonBoard.signalSourceNo') }}
              </dd>
            </div>
          </dl>
          <div
            v-if="widgetSourcePreview.resolved.valid"
            class="mt-3 border-t border-slate-700/80 pt-3"
            data-testid="addon-board-widget-source-live-preview"
          >
            <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t('addonBoard.previewLiveValueTitle') }}
            </p>
            <template v-if="widgetSourcePreview.latestValue">
              <p class="mt-1 text-lg font-semibold tabular-nums text-white">
                {{ formatWidgetSourceLiveValue(widgetSourcePreview.latestValue.value) }}
                <span
                  v-if="widgetSourcePreview.latestValue.unit"
                  class="ml-1 text-sm font-normal text-slate-400"
                >{{ widgetSourcePreview.latestValue.unit }}</span>
              </p>
              <dl class="mt-2 grid gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
                <div>
                  <dt class="text-slate-500">{{ t('addonBoard.previewLiveAt') }}</dt>
                  <dd class="mt-0.5 font-mono text-slate-300">{{ widgetSourcePreview.latestValue.ts }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">{{ t('addonBoard.previewLiveSource') }}</dt>
                  <dd class="mt-0.5 font-mono text-slate-300">{{ widgetSourcePreview.latestValue.source }}</dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="text-slate-500">{{ t('addonBoard.previewLiveQuality') }}</dt>
                  <dd class="mt-0.5 font-mono text-slate-300">{{ widgetSourcePreview.latestValue.quality }}</dd>
                </div>
              </dl>
            </template>
            <p v-else class="mt-1 text-xs text-slate-400" data-testid="addon-board-widget-source-no-live-value">
              {{ t('addonBoard.previewNoLiveValue') }}
            </p>
          </div>
          <div
            v-if="widgetSourcePreview.resolved.valid && canUpdateRides"
            class="mt-3 flex flex-wrap gap-2"
          >
            <button
              type="button"
              class="rounded-lg border border-slate-600 bg-slate-800/80 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              :disabled="promoteWidgetBusy"
              data-testid="addon-board-promote-widget-from-draft"
              @click="promoteWidgetToBoard"
            >
              {{ t('addonBoard.promoteToBoardWidget') }}
            </button>
          </div>
          <p
            v-if="!widgetSourcePreview.resolved.valid"
            class="mt-3 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100/95"
            data-testid="addon-board-widget-source-preview-warning"
          >
            {{ t('addonBoard.previewInvalidWarning') }}
          </p>
        </div>

        <div
          v-if="addonBoardSignalSourcePickerEnabled && rideId"
          class="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-4"
          data-testid="addon-board-custom-widgets"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">
            {{ t('addonBoard.customWidgetsTitle') }}
          </p>
          <p class="mt-1 text-xs text-slate-500">{{ t('addonBoard.customWidgetsHint') }}</p>
          <p
            v-if="rideCustomWidgets.length"
            class="mt-2 text-[11px] leading-relaxed text-slate-400"
            data-testid="addon-board-custom-widget-health-summary"
          >
            {{ t('addonBoard.customWidgetHealthLine', customWidgetHealthSummary) }}
          </p>
          <div
            v-if="rideCustomWidgets.length"
            class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="addon-board-custom-widget-tiles"
          >
            <article
              v-for="cw in rideCustomWidgets"
              :key="cw.widgetId"
              class="flex flex-col rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300"
              :data-testid="`addon-board-custom-widget-tile-${cw.widgetId}`"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <h4 class="text-sm font-semibold text-white">{{ cw.title }}</h4>
                  <p class="mt-0.5 font-mono text-[10px] text-slate-500">{{ cw.widgetId }}</p>
                </div>
                <span
                  v-if="cw.health"
                  :class="[
                    'shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    customWidgetHealthBadgeClass(cw.health),
                  ]"
                  :title="t(`addonBoard.customWidgetHealthBadgeHint.${cw.health}`)"
                  data-testid="addon-board-custom-widget-health-badge"
                >
                  {{ t(`addonBoard.customWidgetHealthBadge.${cw.health}`) }}
                </span>
              </div>
              <p class="mt-1 font-mono text-[11px] text-slate-400">{{ cw.source.signalKey }}</p>

              <p
                v-if="cw.sourceEntityMismatch"
                class="mt-2 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-100/95"
                data-testid="addon-board-custom-widget-entity-mismatch"
              >
                {{ t('addonBoard.customWidgetEntityMismatch') }}
              </p>
              <p v-else-if="!cw.enabled" class="mt-2 text-[11px] text-slate-500">
                {{ t('addonBoard.customWidgetDisabledHint') }}
              </p>
              <p
                v-else-if="cw.resolved && !cw.resolved.valid"
                class="mt-2 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-100/95"
                data-testid="addon-board-custom-widget-invalid"
              >
                {{ t('addonBoard.previewInvalidWarning') }}
              </p>
              <template v-else-if="cw.resolved?.valid">
                <template v-if="cw.latestValue">
                  <p class="mt-2 text-lg font-semibold tabular-nums text-white">
                    {{ formatWidgetSourceLiveValue(cw.latestValue.value) }}
                    <span
                      v-if="cw.latestValue.unit"
                      class="ml-1 text-sm font-normal text-slate-400"
                    >{{ cw.latestValue.unit }}</span>
                  </p>
                  <dl class="mt-2 grid gap-1 text-[11px] text-slate-400">
                    <div>
                      <dt class="text-slate-500">{{ t('addonBoard.previewLiveAt') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-300">{{ cw.latestValue.ts }}</dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('addonBoard.previewLiveSource') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-300">{{ cw.latestValue.source }}</dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="text-slate-500">{{ t('addonBoard.previewLiveQuality') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-300">{{ cw.latestValue.quality }}</dd>
                    </div>
                  </dl>
                </template>
                <p
                  v-else
                  class="mt-2 text-[11px] text-slate-400"
                  data-testid="addon-board-custom-widget-no-live-value"
                >
                  {{ t('addonBoard.previewNoLiveValue') }}
                </p>
              </template>
              <p v-else class="mt-2 text-[11px] text-slate-500">—</p>

              <div
                v-if="canUpdateRides"
                class="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-2"
                data-testid="addon-board-custom-widget-lifecycle"
              >
                <template v-if="renamingWidgetId === cw.widgetId">
                  <input
                    v-model="renameDraftTitle"
                    type="text"
                    maxlength="200"
                    class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white"
                    data-testid="addon-board-custom-widget-rename-input"
                  />
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="rounded bg-brand-600 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      :disabled="customWidgetActionBusyId === cw.widgetId"
                      data-testid="addon-board-custom-widget-rename-save"
                      @click="saveRenameCustomWidget"
                    >
                      {{ t('addonBoard.customWidgetSaveTitle') }}
                    </button>
                    <button
                      type="button"
                      class="rounded border border-slate-600 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                      :disabled="customWidgetActionBusyId === cw.widgetId"
                      @click="cancelRenameCustomWidget"
                    >
                      {{ t('addonBoard.customWidgetCancelRename') }}
                    </button>
                  </div>
                </template>
                <template v-else>
                  <label class="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      class="rounded border-slate-600"
                      :checked="cw.enabled"
                      :disabled="customWidgetActionBusyId === cw.widgetId"
                      data-testid="addon-board-custom-widget-enabled"
                      @change="toggleCustomWidgetEnabled(cw, $event)"
                    />
                    {{ t('addonBoard.customWidgetEnabledLabel') }}
                  </label>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="rounded border border-slate-600 px-3 py-1 text-[11px] text-slate-200 hover:bg-slate-800/80 disabled:opacity-50"
                      :disabled="customWidgetActionBusyId === cw.widgetId"
                      data-testid="addon-board-custom-widget-rename"
                      @click="startRenameCustomWidget(cw)"
                    >
                      {{ t('addonBoard.customWidgetRename') }}
                    </button>
                    <button
                      type="button"
                      class="rounded border border-rose-900/60 px-3 py-1 text-[11px] text-rose-200 hover:bg-rose-950/40 disabled:opacity-50"
                      :disabled="customWidgetActionBusyId === cw.widgetId"
                      data-testid="addon-board-custom-widget-remove"
                      @click="removeCustomWidget(cw)"
                    >
                      {{ t('addonBoard.customWidgetRemove') }}
                    </button>
                  </div>
                </template>
              </div>
            </article>
          </div>
          <p v-else class="mt-2 text-xs text-slate-500">{{ t('addonBoard.customWidgetsEmpty') }}</p>
        </div>

        <div
          v-if="
            rideDetail ||
            (operationsFactsRideDashboardPilotEnabled &&
              rideId &&
              (operationsFactRide || operationsFactsLoading || operationsFactsFailed))
          "
          class="space-y-4"
        >
          <OperationsFactsRidePilotPanel
            v-if="operationsFactsRideDashboardPilotEnabled"
            :ride="operationsFactRide"
            :loading="operationsFactsLoading"
            :failed="operationsFactsFailed"
          />
          <p
            v-if="operationsFactsRideDashboardPilotEnabled && !rideDetail && !loading"
            class="rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-400"
          >
            {{ t('operationsFactsPilot.legacyDetailUnavailable') }}
          </p>
          <template v-if="rideDetail">
          <p v-if="l3WidgetIds.length" class="text-xs text-slate-500">
            {{ t('addonBoard.layoutStrip') }}: <span class="text-slate-300">{{ l3WidgetIds.join(', ') }}</span>
          </p>
          <div
            v-if="showL3Widget('deep-links')"
            class="flex flex-wrap gap-3 text-sm text-sky-400"
          >
            <RouterLink class="hover:underline" :to="`/platform/rides/${rideId}`">
              {{ t('addonBoard.linkRideMaster') }}
            </RouterLink>
            <RouterLink class="hover:underline" to="/platform/live-queue">
              {{ t('addonBoard.linkLiveQueue') }}
            </RouterLink>
            <RouterLink class="hover:underline" :to="mapLinkForRide(rideId)">
              {{ t('addonBoard.linkAssetMap') }}
            </RouterLink>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.fcstShort') }}</h3>
              <dl class="mt-2 space-y-1 text-sm">
                <div class="flex justify-between gap-2">
                  <dt class="text-slate-500">5′</dt>
                  <dd>{{ rideWait.forecastWaitTime5 ?? '—' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-slate-500">10′</dt>
                  <dd>{{ rideWait.forecastWaitTime10 ?? '—' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-slate-500">15′</dt>
                  <dd>{{ rideWait.forecastWaitTime15 ?? '—' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-slate-500">30′</dt>
                  <dd>{{ rideWait.forecastWaitTime30 ?? '—' }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt class="text-slate-500">60′</dt>
                  <dd>{{ rideWait.forecastWaitTime60 ?? '—' }}</dd>
                </div>
                <div
                  v-if="rideWait.queueOccupancyLive != null"
                  class="mt-2 flex justify-between gap-2 border-t border-slate-700/80 pt-2 text-sm"
                >
                  <dt class="text-slate-500">{{ t('addonBoard.queueOccupancyLive') }}</dt>
                  <dd>{{ rideWait.queueOccupancyLive }}</dd>
                </div>
              </dl>
            </div>
            <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.mlMeta') }}</h3>
              <dl class="mt-2 space-y-1 text-xs text-slate-300">
                <div>{{ t('addonBoard.predictionMode') }}: {{ rideDetail.predictionMode ?? '—' }}</div>
                <div>{{ t('addonBoard.modelId') }}: {{ (rideDetail.mlModelId as string) || '—' }}</div>
                <div>
                  {{ t('addonBoard.confidence') }}:
                  {{ rideDetail.mlForecastConfidence != null ? `${rideDetail.mlForecastConfidence}` : '—' }}
                </div>
                <div>{{ t('addonBoard.forecastSource') }}: {{ rideDetail.forecastSource ?? '—' }}</div>
              </dl>
            </div>
            <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.mlFactors') }}</h3>
              <ul v-if="rideMlFactors.length" class="mt-2 list-inside list-disc space-y-1 text-xs text-slate-300">
                <li v-for="(f, i) in rideMlFactors" :key="i">{{ f.feature }} — {{ f.impact }}</li>
              </ul>
              <p v-else class="mt-2 text-xs text-slate-500">—</p>
            </div>
          </div>
          <div
            v-if="hasRideWeatherDetail(rideWeather)"
            class="rounded-lg border border-sky-900/35 bg-slate-900/60 p-4"
          >
            <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.weatherContextTitle') }}</h3>
            <p class="mt-1 text-[11px] text-slate-500">{{ t('addonBoard.weatherContextHint') }}</p>
            <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherTemp') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.temperatureC != null ? `${rideWeather.temperatureC}°C` : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherPrecip') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.precipitationMm != null ? `${rideWeather.precipitationMm} mm` : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherWind') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.windSpeedKmh != null ? `${rideWeather.windSpeedKmh} km/h` : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2 sm:col-span-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherCondition') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.weatherCondition ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherRainProb') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.rainProbabilityPercent != null ? `${rideWeather.rainProbabilityPercent}%` : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherRainSensitive') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.rainSensitive != null ? String(rideWeather.rainSensitive) : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherWeatherSensitive') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.weatherSensitive != null ? String(rideWeather.weatherSensitive) : '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.weatherSensitivityScore') }}</dt>
                <dd class="text-right font-medium">{{ rideWeather.weatherSensitivityScore ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2 sm:col-span-2 lg:col-span-3">
                <dt class="text-slate-500">{{ t('addonBoard.weatherDataLayers') }}</dt>
                <dd class="text-right font-mono text-[11px] text-slate-300">{{ weatherLayersLabel(rideWeather) || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2 sm:col-span-2 lg:col-span-3">
                <dt class="text-slate-500">{{ t('addonBoard.weatherAsOf') }}</dt>
                <dd class="text-right text-[11px] text-slate-400">{{ rideWeather.contextAsOf ?? '—' }}</dd>
              </div>
            </dl>
          </div>
          <div
            v-if="hasRideCrossAssetDetail(rideCrossAsset)"
            class="rounded-lg border border-amber-900/35 bg-slate-900/60 p-4"
          >
            <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.crossAssetZoneTitle') }}</h3>
            <p class="mt-1 text-[11px] text-slate-500">{{ t('addonBoard.crossAssetContextHint') }}</p>
            <p class="mt-2 text-sm text-slate-200">{{ formatVenueTripletLine(rideCrossAsset.zoneVenues) }}</p>
            <div v-if="rideCrossHints.length" class="mt-3 flex flex-wrap gap-2">
              <span
                v-for="(hint, hi) in rideCrossHints"
                :key="hi"
                class="rounded-full bg-amber-950/50 px-2.5 py-1 text-[11px] text-amber-100 ring-1 ring-amber-800/40"
              >
                {{ crossHintLabel(hint.code) }}
              </span>
            </div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.rideOperationsCard') }}</h3>
            <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.operationalStatus') }}</dt>
                <dd class="text-right font-medium text-white">
                  {{ rideOperations.operationalStatus ?? '—' }}
                  <span
                    v-if="rideOperations.operationalStatusSource"
                    class="block text-[10px] font-normal text-slate-500"
                  >
                    {{ rideOperations.operationalStatusSource }}
                  </span>
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.availabilityToday') }}</dt>
                <dd class="text-right font-medium">
                  {{
                    rideOperations.availabilityPercentToday != null
                      ? `${rideOperations.availabilityPercentToday}%`
                      : '—'
                  }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.unplannedDowntimeToday') }}</dt>
                <dd class="text-right font-medium">
                  {{
                    rideOperations.unplannedDowntimeMinutesToday != null
                      ? `${rideOperations.unplannedDowntimeMinutesToday}′`
                      : '—'
                  }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.plannedDowntimeToday') }}</dt>
                <dd class="text-right font-medium">
                  {{
                    rideOperations.plannedDowntimeMinutesToday != null
                      ? `${rideOperations.plannedDowntimeMinutesToday}′`
                      : '—'
                  }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.mttr') }}</dt>
                <dd class="text-right font-medium">
                  {{ rideOperations.mttrMinutes != null ? `${rideOperations.mttrMinutes}′` : '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.mtbf') }}</dt>
                <dd class="text-right font-medium">
                  {{ rideOperations.mtbfHours != null ? `${rideOperations.mtbfHours} h` : '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2 sm:col-span-2 lg:col-span-1">
                <dt class="text-slate-500">{{ t('addonBoard.dispatchTarget') }}</dt>
                <dd class="text-right font-medium">
                  {{ rideOperations.dispatchIntervalTargetSec != null ? `${rideOperations.dispatchIntervalTargetSec}s` : '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.dispatchActual') }}</dt>
                <dd class="text-right font-medium">
                  {{ rideOperations.dispatchIntervalActualSec != null ? `${rideOperations.dispatchIntervalActualSec}s` : '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-2 rounded-md border border-slate-800/80 bg-slate-950/30 px-3 py-2">
                <dt class="text-slate-500">{{ t('addonBoard.dispatchEfficiency') }}</dt>
                <dd class="text-right font-medium">
                  {{
                    rideOperations.dispatchEfficiencyPercent != null
                      ? `${rideOperations.dispatchEfficiencyPercent}%`
                      : '—'
                  }}
                </dd>
              </div>
            </dl>
            <p class="mt-2 text-[11px] text-slate-500">
              {{ t('addonBoard.reliabilityWindowHint', { days: rideOperations.reliabilityLookbackDays ?? '—' }) }}
            </p>
          </div>
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.swdec') }}</h3>
              <div class="mt-3 grid gap-2 sm:grid-cols-5">
                <div
                  v-for="pill in swdecPills"
                  :key="pill.key"
                  class="rounded-md border p-3"
                  :class="swdecPillWrapClass(pill.key)"
                >
                  <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ pill.key }} · {{ t(`addonBoard.${pill.labelKey}`) }}
                  </div>
                  <div class="mt-1 text-sm font-semibold text-white">{{ pill.primary }}</div>
                  <div v-if="pill.secondary" class="mt-0.5 text-xs text-slate-400">{{ pill.secondary }}</div>
                </div>
              </div>
            </div>
            <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <h3 class="text-sm font-semibold text-white">{{ t('addonBoard.aiRec') }}</h3>
              <p class="mt-2 text-sm">{{ rideAiRecommendationTitle }}</p>
              <p class="mt-1 text-xs opacity-80">{{ rideAiRecommendationImpact }}</p>
            </div>
          </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
