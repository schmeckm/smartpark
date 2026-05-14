<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import {
  getPlatformAssets,
  ApiRequestError,
  getAiFeatureDataQualityDashboard,
  postAiForecastsRefresh,
  type AiFeatureDataQualityDashboard,
  type MlPredictionTraceRow,
  type MlPredictionTraceDetailPayload,
  type MlPredictionResultRow,
  type MlPredictionTraceCoefficientsPayload,
  type MlWeightedFeatureTraceEntry,
  type MlRideProfileRow,
  listMlForecastAccuracyLogs,
  getMlForecastAccuracyKpis,
  type MlForecastAccuracyLogRow,
  type MlForecastAccuracyKpis,
  getMlFeatureStoreReadiness,
  getMlFeatureStoreSnapshotDebug,
  type MlFeatureStoreReadinessPayload,
  type MlFeatureStoreSnapshotDebugPayload,
  listMlRideProfiles,
} from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { listMlPredictionTraces, getMlPredictionTraceFilterOptions, getMlPredictionTrace, getMlPredictionTraceCoefficients } from '@/services/api/mlPredictionTraces.api'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useParkContextStore } from '@/stores/parkContext'
import { useAuthStore } from '@/stores/auth'
import {
  buildFeatureTableRows,
  featureKeyCount,
  missingFeatureCount,
  formatReasonCodes,
} from '@/utils/mlPredictionTracesDisplay'
import HelpPanelButton from '@/components/help/HelpPanelButton.vue'
import HelpPanelModal from '@/components/help/HelpPanelModal.vue'
import {
  badgeCoefficientAvailability,
  badgeExplanationHealth,
  badgeFeatureCompleteness,
  badgeForecastAccuracyHealth,
  badgeMissingFeatures,
  badgeModelDataMismatch,
  badgeStaleSignals,
  badgeTraceQuality,
  computeMissingFeaturesTotal,
  countNoGovernedSnapshotHorizons,
  flattenFeatureDataQualityWarnings,
} from '@/utils/mlForecastHealthStrip.mjs'
import { buildRideBehaviorSummaryLines, hydrateRideBehaviorDraft } from '@/utils/mlOperationalProfileBehavior'

/** Park-wide UNS live/stale summaries need ride-scoped APIs — optional future wiring. */
const STALE_SIGNALS_API_AVAILABLE = false

function formatLoadErr(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

function reasonCodesList(row: MlPredictionResultRow): string[] {
  const rc = row.reasonCodesJson
  if (!Array.isArray(rc)) return []
  return rc.map(String)
}

/** Reduces cognitive complexity in `inferTraceEngineMode` by separating aggregation from classification. */
function aggregateTraceEngineFlags(results: MlPredictionResultRow[]) {
  const flags = { closed: false, noSnap: false, ml: false, baselineOnly: false }
  for (const r of results) {
    const c = reasonCodesList(r)
    if (c.includes('PARK_CLOSED') || c.includes('RIDE_CLOSED')) flags.closed = true
    if (c.includes('NO_GOVERNED_SNAPSHOT')) flags.noSnap = true
    const hasMl = c.includes('SOURCE_ML_MODEL')
    if (hasMl) flags.ml = true
    if (c.includes('SOURCE_BASELINE') && !hasMl) flags.baselineOnly = true
  }
  return flags
}

/** Aggregates per-horizon `reason_codes_json` from the trace writer (`SOURCE_*`, `NO_GOVERNED_SNAPSHOT`). */
function inferTraceEngineMode(results: MlPredictionResultRow[]): 'ridge' | 'baseline' | 'fallback' | 'unknown' {
  if (!results.length) return 'unknown'
  const flags = aggregateTraceEngineFlags(results)
  if (flags.closed) return 'baseline'
  if (flags.noSnap) return 'fallback'
  if (flags.ml && flags.baselineOnly) return 'fallback'
  if (flags.ml) return 'ridge'
  if (flags.baselineOnly) return 'baseline'
  return 'unknown'
}

function predictionSummaryDisplay(predictedValue: string | null | undefined): string {
  if (predictedValue == null || String(predictedValue).trim() === '') return '—'
  return String(predictedValue).trim()
}

function pickDetailConfidence(results: MlPredictionResultRow[]): string {
  for (const r of results) {
    const s = r.confidenceScore
    if (s != null && String(s).trim() !== '') return String(s).trim()
  }
  return '—'
}

function detailResultAtHorizon(results: MlPredictionResultRow[], horizon: number): MlPredictionResultRow | undefined {
  for (const r of results) {
    if (r.horizonMinutes == null) continue
    if (Number(r.horizonMinutes) === horizon) return r
  }
  return undefined
}

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()
const auth = useAuthStore()

const canOpenIntegrationSettings = computed(() => auth.hasPermission('integrations', 'read'))
const canOpenRealtimeLive = computed(() => auth.hasPermission('iotOt', 'settings.read'))
const canOpenPipelineLog = computed(() => auth.hasPermission('iotOt', 'settings.read'))

const canAiRefresh = computed(() => auth.hasPermission('ai', 'refresh'))
const rebuildingSnapshots = ref(false)

const FORECAST_SUPPORT_STEP_KEYS = [1, 2, 3, 4, 5] as const
const forecastSupportStepTexts = computed(() =>
  FORECAST_SUPPORT_STEP_KEYS.map((n) => t(`aiMl.forecastAccuracy.supportStep${n}`))
)

async function runFeatureStorePipelineRefresh() {
  if (!canAiRefresh.value || rebuildingSnapshots.value) return
  rebuildingSnapshots.value = true
  try {
    await postAiForecastsRefresh()
    push(t('aiMl.forecastAccuracy.rebuildSnapshotsOk'), 'success')
    await loadForecastAccuracy()
    await loadFeatureStoreReadiness()
    await loadSnapshotDebug()
  } catch (e) {
    push(
      t('aiMl.forecastAccuracy.rebuildSnapshotsFail', { message: formatLoadErr(e) }),
      'error'
    )
  } finally {
    rebuildingSnapshots.value = false
  }
}

/** Platform park_assets (RIDE) — same id space as ML trace `rideId`. */
const rides = ref<PlatformAsset[]>([])
const rideOptionsLoading = ref(false)

const rideFilterOptions = computed(() => {
  const out: { id: string; name: string }[] = []
  for (const a of rides.value) {
    const id = String((a as Record<string, unknown>).assetId ?? '')
    if (!id) continue
    out.push({ id, name: String((a as Record<string, unknown>).name ?? id) })
  }
  return out
})

/** Resolve platform asset UUID → ride name for trace rows (same catalog as the filter dropdown). */
const rideNameByAssetId = computed(() => {
  const m = new Map<string, string>()
  for (const r of rideFilterOptions.value) {
    m.set(r.id, r.name)
  }
  return m
})

const filterRideId = ref('')
const filterModelName = ref('')
const filterTargetName = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const filterLimit = ref(50)
const filterAccuracyHorizon = ref('')
/** Hide UNKNOWN / no-Ist rows in Forecast-Genauigkeit (default on). */
const filterForecastAccuracyComparableOnly = ref(true)

const traceFilterMetaModelNames = ref<string[]>([])
const traceFilterMetaTargetNames = ref<string[]>([])
const traceFilterMetaLoading = ref(false)
const traceFilterMetaError = ref<string | null>(null)
const traceFilterMetaTextFallback = ref(false)

function reconcileTraceFilterMetaSelections() {
  if (traceFilterMetaTextFallback.value) return
  const ms = new Set(traceFilterMetaModelNames.value)
  const ts = new Set(traceFilterMetaTargetNames.value)
  if (filterModelName.value && ms.size > 0 && !ms.has(filterModelName.value)) {
    filterModelName.value = ''
  }
  if (filterTargetName.value && ts.size > 0 && !ts.has(filterTargetName.value)) {
    filterTargetName.value = ''
  }
}

async function loadTraceFilterMeta() {
  traceFilterMetaError.value = null
  traceFilterMetaTextFallback.value = false
  if (!parkCtx.activeParkId) {
    traceFilterMetaModelNames.value = []
    traceFilterMetaTargetNames.value = []
    return
  }
  traceFilterMetaLoading.value = true
  try {
    const o = await getMlPredictionTraceFilterOptions()
    traceFilterMetaModelNames.value = Array.isArray(o.modelNames) ? o.modelNames : []
    traceFilterMetaTargetNames.value = Array.isArray(o.targetNames) ? o.targetNames : []
    reconcileTraceFilterMetaSelections()
  } catch (e) {
    traceFilterMetaModelNames.value = []
    traceFilterMetaTargetNames.value = []
    traceFilterMetaError.value = formatLoadErr(e)
    traceFilterMetaTextFallback.value = true
  } finally {
    traceFilterMetaLoading.value = false
  }
}

const accuracyKpis = ref<MlForecastAccuracyKpis | null>(null)
const accuracyRows = ref<MlForecastAccuracyLogRow[]>([])
const accuracyLoading = ref(false)
const accuracyError = ref<string | null>(null)
const accuracyChartEl = ref<HTMLDivElement | null>(null)
let accuracyChart: echarts.ECharts | null = null

function disposeAccuracyChart() {
  if (accuracyChart) {
    accuracyChart.dispose()
    accuracyChart = null
  }
}

function numFromApi(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function formatFixedOptional(v: number | null, digits: number): string {
  if (v == null) return '—'
  return v.toFixed(digits)
}

/** Rows with snapshot-backed actual — needed for MAPE / chart. */
const accuracyComparableRowCount = computed(() =>
  accuracyRows.value.filter(
    (r) => numFromApi(r.predictedValue) != null && numFromApi(r.actualValue) != null
  ).length
)

const fhAccuracyBadge = computed(() =>
  badgeForecastAccuracyHealth(accuracyKpis.value?.avgPercentageError ?? null, {
    kpi: accuracyKpis.value,
  })
)

const fhAccuracyPrimary = computed(() => {
  const k = accuracyKpis.value
  if (!k || k.totalEvaluations <= 0) return t('aiMl.healthStrip.accuracyPrimaryEmpty')
  if (fhAccuracyBadge.value === 'na') {
    return t('aiMl.healthStrip.accuracyPrimaryClosedPeriod', { n: String(k.totalEvaluations) })
  }
  const ape = k.avgPercentageError
  if (ape != null && Number.isFinite(Number(ape))) {
    const pct = Math.round(Number(ape) * 1000) / 10
    return t('aiMl.healthStrip.accuracyPrimary', { pct: String(pct) })
  }
  const uk = k.unknownCount ?? 0
  const tot = k.totalEvaluations
  if (uk > 0 && uk === tot) {
    return t('aiMl.healthStrip.accuracyPrimaryAllUnknown', { n: String(tot) })
  }
  return t('aiMl.healthStrip.accuracyPrimaryEmpty')
})

const fhAccuracyHelper = computed(() => {
  const b = fhAccuracyBadge.value
  const k = accuracyKpis.value
  if (b === 'na') return t('aiMl.healthStrip.accuracyHelperClosedPeriod')
  if (b === 'unknown' && k && k.totalEvaluations > 0 && k.avgPercentageError == null) {
    const uk = k.unknownCount ?? 0
    if (uk === k.totalEvaluations) {
      return t('aiMl.healthStrip.accuracyHelperAllUnknown')
    }
    if (uk > 0) {
      return t('aiMl.healthStrip.accuracyHelperSomeUnknown', {
        unknown: String(uk),
        total: String(k.totalEvaluations),
      })
    }
  }
  if (b === 'unknown') return t('aiMl.healthStrip.accuracyHelperUnknown')
  if (b === 'ok') return t('aiMl.healthStrip.accuracyHelperOk')
  if (b === 'warning') return t('aiMl.healthStrip.accuracyHelperWarn')
  return t('aiMl.healthStrip.accuracyHelperCrit')
})

function accuracyFiltersPayload() {
  const rawH = String(filterAccuracyHorizon.value ?? '').trim()
  let horizonMinutes: number | undefined
  if (rawH !== '') {
    const h = Number(rawH)
    if (Number.isFinite(h) && h > 0) horizonMinutes = h
  }
  return {
    rideId: filterRideId.value.trim() || undefined,
    modelName: filterModelName.value.trim() || undefined,
    targetName: filterTargetName.value.trim() || undefined,
    horizonMinutes,
    from: toIsoBoundary(filterFrom.value, false),
    to: toIsoBoundary(filterTo.value, true),
    ...(filterForecastAccuracyComparableOnly.value ? { comparableOnly: true as const } : {}),
  }
}

async function loadForecastAccuracy() {
  accuracyError.value = null
  if (!parkCtx.activeParkId) {
    accuracyKpis.value = null
    accuracyRows.value = []
    disposeAccuracyChart()
    return
  }
  accuracyLoading.value = true
  try {
    const base = accuracyFiltersPayload()
    const [kpis, logs] = await Promise.all([
      getMlForecastAccuracyKpis(base),
      listMlForecastAccuracyLogs({ ...base, limit: 80 }),
    ])
    accuracyKpis.value = kpis
    accuracyRows.value = Array.isArray(logs) ? logs : []
  } catch (e) {
    accuracyKpis.value = null
    accuracyRows.value = []
    accuracyError.value = formatLoadErr(e)
    disposeAccuracyChart()
  } finally {
    accuracyLoading.value = false
  }
  await nextTick()
  renderAccuracyChart()
}

const fsReadiness = ref<MlFeatureStoreReadinessPayload | null>(null)
const fsReadinessLoading = ref(false)
const fsReadinessFailed = ref(false)

async function loadFeatureStoreReadiness() {
  fsReadinessFailed.value = false
  if (!parkCtx.activeParkId) {
    fsReadiness.value = null
    return
  }
  fsReadinessLoading.value = true
  try {
    fsReadiness.value = await getMlFeatureStoreReadiness({
      rideId: filterRideId.value.trim() || undefined,
      from: toIsoBoundary(filterFrom.value, false),
      to: toIsoBoundary(filterTo.value, true),
    })
  } catch {
    fsReadiness.value = null
    fsReadinessFailed.value = true
  } finally {
    fsReadinessLoading.value = false
  }
}

const SNAPSHOT_DEBUG_WINDOW_OPTIONS = [1, 2, 6, 24] as const
type SnapshotDebugWindowHours = (typeof SNAPSHOT_DEBUG_WINDOW_OPTIONS)[number]
const snapshotDebugWindowHours = ref<SnapshotDebugWindowHours>(2)

const snapshotDebug = ref<MlFeatureStoreSnapshotDebugPayload | null>(null)
const snapshotDebugLoading = ref(false)
const snapshotDebugFailed = ref(false)

async function loadSnapshotDebug() {
  snapshotDebugFailed.value = false
  if (!parkCtx.activeParkId || !filterRideId.value.trim()) {
    snapshotDebug.value = null
    return
  }
  snapshotDebugLoading.value = true
  try {
    snapshotDebug.value = await getMlFeatureStoreSnapshotDebug({
      rideId: filterRideId.value.trim(),
      windowHours: snapshotDebugWindowHours.value,
    })
  } catch {
    snapshotDebug.value = null
    snapshotDebugFailed.value = true
  } finally {
    snapshotDebugLoading.value = false
  }
}

function boolTriLabel(v: boolean | null | undefined): string {
  if (v === true) return t('aiMl.fsSnapshotDebug.yes')
  if (v === false) return t('aiMl.fsSnapshotDebug.no')
  return '—'
}

function fsSnapshotDebugVerdict(d: MlFeatureStoreSnapshotDebugPayload): string {
  if (!d.latestSnapshotAtOverall && d.rowsLastWindow === 0) {
    return t('aiMl.fsSnapshotDebug.verdictNever')
  }
  if (d.latestSnapshotAtOverall && d.rowsLastWindow === 0) {
    return t('aiMl.fsSnapshotDebug.verdictStaleWindow')
  }
  if (d.rowsLastWindow > 0 && d.rowsWithNumericWaitInWindow === 0) {
    return t('aiMl.fsSnapshotDebug.verdictNoWait')
  }
  const dq = String(d.latestSnapshots[0]?.dataQualityReason ?? '')
  if (dq === 'PARK_CLOSED' || dq === 'RIDE_CLOSED') {
    return t('aiMl.fsSnapshotDebug.verdictClosed')
  }
  if (d.rowsLastWindow > 0 && d.rowsAccuracyEligibleInWindow === 0 && d.rowsWithNumericWaitInWindow > 0) {
    return t('aiMl.fsSnapshotDebug.verdictIneligible')
  }
  return t('aiMl.fsSnapshotDebug.verdictOk')
}

function renderAccuracyChart() {
  disposeAccuracyChart()
  const el = accuracyChartEl.value
  const sorted = [...accuracyRows.value]
    .filter((r) => numFromApi(r.predictedValue) != null && numFromApi(r.actualValue) != null)
    .sort((a, b) => new Date(a.evaluatedAt).getTime() - new Date(b.evaluatedAt).getTime())
    .slice(-80)
  if (!el || sorted.length < 2) return

  const times = sorted.map((r) => formatDateTime(r.evaluatedAt))
  const pred = sorted.map((r) => numFromApi(r.predictedValue) as number)
  const act = sorted.map((r) => numFromApi(r.actualValue) as number)

  accuracyChart = echarts.init(el, undefined, { renderer: 'canvas' })
  const opt: EChartsOption = {
    color: ['#38bdf8', '#a78bfa'],
    tooltip: { trigger: 'axis' },
    legend: {
      data: [t('aiMl.forecastAccuracy.chartPred'), t('aiMl.forecastAccuracy.chartActual')],
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: 35 },
    },
    yAxis: {
      type: 'value',
      name: 'min',
      axisLabel: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: '#33415555' } },
    },
    series: [
      {
        name: t('aiMl.forecastAccuracy.chartPred'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: pred,
      },
      {
        name: t('aiMl.forecastAccuracy.chartActual'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: act,
      },
    ],
  }
  accuracyChart.setOption(opt)
}

function accuracyStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toUpperCase()
  if (s === 'OK') return t('aiMl.forecastAccuracy.statusOk')
  if (s === 'WARNING') return t('aiMl.forecastAccuracy.statusWarning')
  if (s === 'CRITICAL') return t('aiMl.forecastAccuracy.statusCritical')
  return t('aiMl.forecastAccuracy.statusUnknown')
}

function accuracyStatusBadgeClass(status: string | null | undefined): string {
  const s = String(status || '').toUpperCase()
  if (s === 'OK') return 'border-emerald-700/70 bg-emerald-950/55 text-emerald-100'
  if (s === 'WARNING') return 'border-amber-700/70 bg-amber-950/55 text-amber-100'
  if (s === 'CRITICAL') return 'border-rose-700/70 bg-rose-950/55 text-rose-100'
  return 'border-slate-600 bg-slate-800/60 text-slate-300'
}

watch(accuracyRows, () => {
  void nextTick(() => renderAccuracyChart())
})

watch(
  () => [accuracyChartEl.value, parkCtx.activeParkId] as const,
  () => {
    void nextTick(() => renderAccuracyChart())
  }
)

onBeforeUnmount(() => {
  disposeAccuracyChart()
})

const rows = ref<MlPredictionTraceRow[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const drawerOpen = ref(false)
const selectedPredictionId = ref<string | null>(null)
const detailLoading = ref(false)
const detail = ref<MlPredictionTraceDetailPayload | null>(null)
const mlCoefficients = ref<MlPredictionTraceCoefficientsPayload | null>(null)
const mlCoefficientsError = ref<string | null>(null)
const detailError = ref<string | null>(null)
const vectorTab = ref<'standard' | 'weighted'>('standard')

const detailRideProfiles = ref<MlRideProfileRow[]>([])
const detailRideProfilesLoading = ref(false)

const limitOptions = [25, 50, 100, 200, 500]

const featureRows = computed(() => {
  const tr = detail.value?.trace
  if (!tr) return []
  return buildFeatureTableRows(
    tr.featureVectorJson,
    tr.featureSourcesJson,
    tr.featureStatusJson,
    tr.missingFeaturesJson
  )
})

const hasWeightedVector = computed(() => {
  const w = detail.value?.trace?.weightedFeatureVectorJson
  return w != null && typeof w === 'object' && Object.keys(w as object).length > 0
})

const weightedRows = computed(() => {
  const w = detail.value?.trace?.weightedFeatureVectorJson as
    | Record<string, MlWeightedFeatureTraceEntry>
    | undefined
  if (!w) return []
  return Object.keys(w)
    .sort()
    .map((name) => {
      const row = w[name]
      return {
        name,
        rawValue: row.rawValue,
        normalizedValue: row.normalizedValue,
        weight: row.weight,
        weightedValue: row.weightedValue,
        source: row.source,
        status: row.status,
      }
    })
})

const detailResults = computed(() => detail.value?.results ?? [])

const detailEngineMode = computed(() => inferTraceEngineMode(detailResults.value))

const detailEngineModeLabel = computed(() => {
  const m = detailEngineMode.value
  const keys = {
    ridge: 'aiMl.featureMonitorEngineModeRidge',
    baseline: 'aiMl.featureMonitorEngineModeBaseline',
    fallback: 'aiMl.featureMonitorEngineModeFallback',
    unknown: 'aiMl.featureMonitorEngineModeUnknown',
  } as const
  return t(keys[m])
})

const detailSummaryConfidence = computed(() => pickDetailConfidence(detailResults.value))

const detailSummaryPred15 = computed(() =>
  predictionSummaryDisplay(detailResultAtHorizon(detailResults.value, 15)?.predictedValue)
)
const detailSummaryPred30 = computed(() =>
  predictionSummaryDisplay(detailResultAtHorizon(detailResults.value, 30)?.predictedValue)
)
const detailSummaryPred60 = computed(() =>
  predictionSummaryDisplay(detailResultAtHorizon(detailResults.value, 60)?.predictedValue)
)
const detailHasHorizon60 = computed(() => detailResultAtHorizon(detailResults.value, 60) != null)

const assignedRideProfilePrimary = computed(() => detailRideProfiles.value[0] ?? null)

const assignedProfileCategory = computed(() => {
  const r = assignedRideProfilePrimary.value
  if (!r) return '—'
  const cap = r.capacityProfileJson as Record<string, unknown> | undefined
  const c = cap?.category
  if (c != null && String(c).trim() !== '') return String(c)
  return r.rideType && r.rideType.trim() !== '' ? r.rideType : '—'
})

const assignedProfileSummaryText = computed(() => {
  const r = assignedRideProfilePrimary.value
  if (!r) return ''
  const d = hydrateRideBehaviorDraft(
    r.rideType ?? '',
    JSON.stringify(r.capacityProfileJson ?? {}),
    JSON.stringify(r.weatherSensitivityJson ?? {}),
    JSON.stringify(r.queueBehaviorProfileJson ?? {}),
    JSON.stringify(r.downtimeSensitivityJson ?? {}),
    JSON.stringify(r.staffingDependencyJson ?? {}),
    JSON.stringify(r.throughputProfileJson ?? {})
  )
  return buildRideBehaviorSummaryLines(d, t).join(' ')
})

watch(
  [drawerOpen, () => detail.value?.trace?.rideId ?? ''],
  async ([open, rideId]) => {
    detailRideProfiles.value = []
    if (!open || !rideId) return
    detailRideProfilesLoading.value = true
    try {
      let rows = await listMlRideProfiles({ rideId: String(rideId), enabled: true })
      if (!rows.length) rows = await listMlRideProfiles({ rideId: String(rideId) })
      detailRideProfiles.value = rows
    } catch {
      detailRideProfiles.value = []
    } finally {
      detailRideProfilesLoading.value = false
    }
  }
)

/** Prefer registered ridge model id from per-horizon rows when ML ran; otherwise trace header model. */
const detailSummaryModelDisplay = computed(() => {
  const tr = detail.value?.trace
  if (!tr) return { name: '—', version: '—' as string | null }
  const mlRow = detailResults.value.find((r) => reasonCodesList(r).includes('SOURCE_ML_MODEL'))
  if (mlRow && mlRow.modelName && mlRow.modelName.trim() !== '') {
    return { name: mlRow.modelName.trim(), version: mlRow.modelVersion }
  }
  return { name: tr.modelName || '—', version: tr.modelVersion }
})

const dqDashboard = ref<AiFeatureDataQualityDashboard | null>(null)
const dqLoading = ref(false)
const dqLoadFailed = ref(false)

async function loadForecastHealthDq() {
  dqLoadFailed.value = false
  if (!parkCtx.activeParkId) {
    dqDashboard.value = null
    return
  }
  dqLoading.value = true
  try {
    dqDashboard.value = await getAiFeatureDataQualityDashboard({ summariesLimit: 80 })
  } catch {
    dqDashboard.value = null
    dqLoadFailed.value = true
  } finally {
    dqLoading.value = false
  }
}

const fhAvgCompleteness = computed(() => dqDashboard.value?.kpis?.avgCompletenessScore ?? null)
const fhCompletenessBadge = computed(() => badgeFeatureCompleteness(fhAvgCompleteness.value))
const fhCompletenessPrimary = computed(() => {
  const a = fhAvgCompleteness.value
  if (a != null && Number.isFinite(Number(a))) return `${Math.round(Number(a) * 100)}%`
  return '—'
})
const fhCompletenessHelper = computed(() => {
  if (dqLoadFailed.value) return t('aiMl.healthStrip.dqFailed')
  if (dqLoading.value) return t('aiMl.healthStrip.dqLoading')
  if (fhAvgCompleteness.value == null) return t('aiMl.healthStrip.dqMissing')
  return t('aiMl.healthStrip.completenessHelper')
})

const fhMissingTotal = computed(() => computeMissingFeaturesTotal(dqDashboard.value?.kpis ?? null))
const fhMissingBadge = computed(() => badgeMissingFeatures(fhMissingTotal.value))
const fhMissingPrimary = computed(() => {
  const v = fhMissingTotal.value
  if (v == null) return '—'
  return String(v)
})
const fhMissingHelper = computed(() => {
  if (dqLoadFailed.value) return t('aiMl.healthStrip.dqFailed')
  if (dqLoading.value) return t('aiMl.healthStrip.dqLoading')
  if (fhMissingTotal.value == null) return t('aiMl.healthStrip.dqMissing')
  return t('aiMl.healthStrip.missingHelper')
})

const dqFlatWarnings = computed(() => flattenFeatureDataQualityWarnings(dqDashboard.value))

const fhStaleBadge = computed(() => badgeStaleSignals(0, 0, STALE_SIGNALS_API_AVAILABLE))
const fhStalePrimary = computed(() =>
  STALE_SIGNALS_API_AVAILABLE ? '—' : t('aiMl.healthStrip.staleNaPrimary')
)
const fhStaleHelper = computed(() => t('aiMl.healthStrip.staleNaHelper'))

function governedSnapshotClosedReason(trace: MlPredictionTraceRow | null | undefined): boolean {
  const raw = trace && typeof trace === 'object' ? (trace as Record<string, unknown>).governedSnapshotQualityReason : null
  const s = raw == null ? '' : String(raw).trim()
  return s === 'PARK_CLOSED' || s === 'RIDE_CLOSED'
}

/** List-row diagnostics (trace header + flags only; no per-horizon reason codes in list API). */
function traceListClosedPeriod(tr: MlPredictionTraceRow): boolean {
  if (String(tr.modelName || '').trim() === 'closed_period_forecast') return true
  return governedSnapshotClosedReason(tr)
}

function traceListNoGoverned(tr: MlPredictionTraceRow): boolean {
  return String(tr.modelName || '').trim() === 'no_governed_snapshot'
}

function traceListRidge(tr: MlPredictionTraceRow): boolean {
  return String(tr.modelName || '').trim() === 'ride_wait_forecast' && !tr.fallbackUsed
}

function traceListBaselineOnlyHeader(tr: MlPredictionTraceRow): boolean {
  if (traceListNoGoverned(tr) || traceListClosedPeriod(tr)) return true
  return String(tr.modelName || '').trim() === 'ride_wait_forecast' && tr.fallbackUsed
}

function traceListBaselineInvolved(tr: MlPredictionTraceRow): boolean {
  if (traceListRidge(tr)) return false
  return (
    traceListNoGoverned(tr) ||
    traceListClosedPeriod(tr) ||
    tr.fallbackUsed ||
    String(tr.modelName || '').trim() === 'ride_wait_forecast'
  )
}

type TraceRowBadge = { key: string; cls: string }

function traceRowBadgeClass(key: string): string {
  switch (key) {
    case 'noGov':
      return 'border-violet-700/60 bg-violet-950/50 text-violet-100'
    case 'fallback':
      return 'border-amber-600/50 bg-amber-950/60 text-amber-100'
    case 'baseline':
      return 'border-slate-600 bg-slate-800/70 text-slate-200'
    case 'ridge':
      return 'border-emerald-700/60 bg-emerald-950/50 text-emerald-100'
    case 'closed':
      return 'border-rose-700/60 bg-rose-950/45 text-rose-100'
    default:
      return 'border-slate-600 bg-slate-800/60 text-slate-300'
  }
}

function traceRowBadgeLabelKey(key: string): string {
  const m: Record<string, string> = {
    noGov: 'aiMl.featureMonitorBadgeNoGov',
    fallback: 'aiMl.featureMonitorBadgeFallback',
    baseline: 'aiMl.featureMonitorBadgeBaseline',
    ridge: 'aiMl.featureMonitorBadgeRidge',
    closed: 'aiMl.featureMonitorBadgeClosed',
  }
  return m[key] || 'aiMl.featureMonitorEngineModeUnknown'
}

function traceRowBadges(tr: MlPredictionTraceRow): TraceRowBadge[] {
  const out: TraceRowBadge[] = []
  if (traceListNoGoverned(tr)) out.push({ key: 'noGov', cls: traceRowBadgeClass('noGov') })
  if (tr.fallbackUsed) out.push({ key: 'fallback', cls: traceRowBadgeClass('fallback') })
  if (traceListBaselineInvolved(tr)) out.push({ key: 'baseline', cls: traceRowBadgeClass('baseline') })
  if (traceListRidge(tr)) out.push({ key: 'ridge', cls: traceRowBadgeClass('ridge') })
  if (traceListClosedPeriod(tr)) out.push({ key: 'closed', cls: traceRowBadgeClass('closed') })
  return out
}

const traceLoadSummary = computed(() => {
  const list = rows.value
  const total = list.length
  let fallback = 0
  let baselineOnly = 0
  let noGov = 0
  let closed = 0
  for (const tr of list) {
    if (tr.fallbackUsed) fallback += 1
    if (traceListNoGoverned(tr)) noGov += 1
    if (traceListClosedPeriod(tr)) closed += 1
    if (traceListBaselineOnlyHeader(tr)) baselineOnly += 1
  }
  return { total, fallback, baselineOnly, noGov, closed }
})

const traceTotal = computed(() => rows.value.length)
const traceClosedPeriodCount = computed(() => rows.value.filter((r) => governedSnapshotClosedReason(r)).length)
const traceFallback = computed(() =>
  rows.value.filter((r) => r.fallbackUsed && !governedSnapshotClosedReason(r)).length
)
const fhTraceBadge = computed(() =>
  badgeTraceQuality(traceTotal.value, traceFallback.value, {
    closedPeriodTraceCount: traceClosedPeriodCount.value,
  })
)
const fhTracePct = computed(() => {
  if (traceTotal.value <= 0) return null
  const denom = traceTotal.value - traceClosedPeriodCount.value
  if (denom <= 0) return null
  return Math.round((traceFallback.value / denom) * 1000) / 10
})

/** NO_GOVERNED_SNAPSHOT count from opened trace detail (reason_codes_json); null when unavailable. */
const fhTraceNoGovCount = computed(() => {
  if (!drawerOpen.value || detailLoading.value || !detailResults.value.length) return null
  return countNoGovernedSnapshotHorizons(detailResults.value)
})

const fhTracePrimary = computed(() => {
  if (traceTotal.value <= 0) return '—'
  const pct = fhTracePct.value ?? 0
  const baseArgs = {
    total: traceTotal.value,
    fallback: traceFallback.value,
    pct: String(pct),
  }
  const noGov = fhTraceNoGovCount.value
  if (noGov != null && noGov > 0) {
    return t('aiMl.healthStrip.tracePrimaryWithNoGov', { ...baseArgs, noGov })
  }
  return t('aiMl.healthStrip.tracePrimary', baseArgs)
})

const fhTraceHelper = computed(() => {
  const b = fhTraceBadge.value
  if (b === 'na') return t('aiMl.healthStrip.traceHelperClosedOnly')
  if (b === 'unknown') return t('aiMl.healthStrip.traceHelperUnknown')
  if (b === 'ok') return t('aiMl.healthStrip.traceHelperOk')
  if (b === 'warning') return t('aiMl.healthStrip.traceHelperWarn')
  return t('aiMl.healthStrip.traceHelperCrit')
})

const mismatchTraceResults = computed(() =>
  drawerOpen.value && detailResults.value.length ? detailResults.value : []
)
const fhMismatchBadge = computed(() =>
  badgeModelDataMismatch({ results: mismatchTraceResults.value, dqWarnings: dqFlatWarnings.value })
)
const fhMismatchHelper = computed(() =>
  fhMismatchBadge.value === 'warning'
    ? t('aiMl.healthStrip.mismatchWarnHelper')
    : t('aiMl.healthStrip.mismatchOkHelper')
)

/** Prefer trace detail `learnedCoefficients`; fall back to coefficients endpoint payload. */
const learnedCoefRowCount = computed(() => {
  const lr = detail.value?.learnedCoefficients?.rows
  if (lr?.length) return lr.length
  return mlCoefficients.value?.coefficients?.length ?? 0
})

const fhCoefBadge = computed(() =>
  badgeCoefficientAvailability(
    detailEngineMode.value,
    learnedCoefRowCount.value,
    Boolean(drawerOpen.value && selectedPredictionId.value),
    detailLoading.value
  )
)

const fhCoefPrimary = computed(() => {
  const b = fhCoefBadge.value
  if (b === 'unknown') return t('aiMl.healthStrip.coefUnknownPrimary')
  if (b === 'na') return t('aiMl.healthStrip.coefNaPrimary')
  if (b === 'ok')
    return t('aiMl.healthStrip.coefOkPrimary', { n: learnedCoefRowCount.value })
  return t('aiMl.healthStrip.coefWarnPrimary')
})

const fhCoefHelper = computed(() => {
  const b = fhCoefBadge.value
  if (b === 'unknown') return t('aiMl.healthStrip.coefUnknownHelper')
  if (b === 'na') return t('aiMl.healthStrip.coefNaHelper')
  if (b === 'ok') return t('aiMl.healthStrip.coefOkHelper')
  return t('aiMl.healthStrip.coefWarnHelper')
})

const fhLowConf = computed(() => dqDashboard.value?.kpis?.lowConfidenceForecastCount ?? null)
const fhExplainBadge = computed(() => badgeExplanationHealth(fhLowConf.value))
const fhExplainPrimary = computed(() =>
  fhLowConf.value != null && Number.isFinite(Number(fhLowConf.value))
    ? t('aiMl.healthStrip.explainPrimary', { n: Number(fhLowConf.value) })
    : '—'
)
const fhExplainHelper = computed(() => {
  if (dqLoadFailed.value) return t('aiMl.healthStrip.dqFailed')
  if (dqLoading.value) return t('aiMl.healthStrip.dqLoading')
  if (fhLowConf.value == null) return t('aiMl.healthStrip.dqMissing')
  return t('aiMl.healthStrip.explainHelper')
})

function healthStripBadgeClass(status: string): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-700/70 bg-emerald-950/45 text-emerald-100'
    case 'warning':
      return 'border-amber-700/70 bg-amber-950/45 text-amber-100'
    case 'critical':
      return 'border-rose-700/70 bg-rose-950/45 text-rose-100'
    case 'na':
      return 'border-slate-600 bg-slate-900/50 text-slate-400'
    default:
      return 'border-slate-600 bg-slate-900/50 text-slate-300'
  }
}

function healthStripStatusLabel(status: string): string {
  switch (status) {
    case 'ok':
      return t('aiMl.healthStrip.statusOk')
    case 'warning':
      return t('aiMl.healthStrip.statusWarning')
    case 'critical':
      return t('aiMl.healthStrip.statusCritical')
    case 'na':
      return t('aiMl.healthStrip.statusNa')
    default:
      return t('aiMl.healthStrip.statusUnknown')
  }
}

async function loadRideOptions() {
  if (!parkCtx.activeParkId) {
    rides.value = []
    return
  }
  rideOptionsLoading.value = true
  try {
    const list = await getPlatformAssets({
      parkId: parkCtx.activeParkId,
      assetTypeCode: 'RIDE',
      limit: 500,
    })
    rides.value = list
    const ids = new Set(
      list.map((a) => String((a as Record<string, unknown>).assetId ?? '').trim()).filter(Boolean)
    )
    if (filterRideId.value && !ids.has(filterRideId.value)) {
      filterRideId.value = ''
    }
  } catch {
    rides.value = []
  } finally {
    rideOptionsLoading.value = false
  }
}

function toIsoBoundary(raw: string, endOfDay: boolean): string | undefined {
  const s = String(raw || '').trim()
  if (!s) return undefined
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return undefined
  if (endOfDay) {
    d.setHours(23, 59, 59, 999)
  }
  return d.toISOString()
}

async function refreshList() {
  loadError.value = null
  loading.value = true
  try {
    const list = await listMlPredictionTraces({
      rideId: filterRideId.value.trim() || undefined,
      modelName: filterModelName.value.trim() || undefined,
      targetName: filterTargetName.value.trim() || undefined,
      from: toIsoBoundary(filterFrom.value, false),
      to: toIsoBoundary(filterTo.value, true),
      limit: filterLimit.value,
    })
    rows.value = Array.isArray(list) ? list : []
  } catch (e) {
    rows.value = []
    loadError.value = formatLoadErr(e)
    push(t('aiMl.featureMonitorLoadError'), 'error')
  } finally {
    loading.value = false
    void loadForecastHealthDq()
    void loadForecastAccuracy()
  }
}

async function openDetail(predictionId: string) {
  vectorTab.value = 'standard'
  selectedPredictionId.value = predictionId
  drawerOpen.value = true
  detail.value = null
  mlCoefficients.value = null
  mlCoefficientsError.value = null
  detailError.value = null
  detailLoading.value = true
  try {
    const [d, coefOutcome] = await Promise.all([
      getMlPredictionTrace(predictionId),
      getMlPredictionTraceCoefficients(predictionId).then(
        (c) => ({ ok: true as const, c }),
        (e: unknown) => ({ ok: false as const, e })
      ),
    ])
    detail.value = d
    if (coefOutcome.ok) {
      mlCoefficients.value = coefOutcome.c
      mlCoefficientsError.value = null
    } else {
      mlCoefficients.value = null
      mlCoefficientsError.value = formatLoadErr(coefOutcome.e)
    }
  } catch (e) {
    detail.value = { trace: null, results: [] }
    mlCoefficients.value = null
    mlCoefficientsError.value = null
    detailError.value = formatLoadErr(e)
    push(t('aiMl.featureMonitorDetailFailed'), 'error')
  } finally {
    detailLoading.value = false
  }
}

function closeDrawer() {
  drawerOpen.value = false
  selectedPredictionId.value = null
  detail.value = null
  mlCoefficients.value = null
  mlCoefficientsError.value = null
  detailError.value = null
}

function rowFeatureCount(tr: MlPredictionTraceRow): number {
  return featureKeyCount(tr.featureVectorJson)
}

function rowMissingCount(tr: MlPredictionTraceRow): number {
  return missingFeatureCount(tr.missingFeaturesJson)
}

function rowPredictedDisplay(): string {
  return t('aiMl.featureMonitorSeeDetail')
}

/** Stable display for weighted trace numerics. */
function formatWeightedNum(v: unknown): string {
  if (v == null) return '—'
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return String(n)
  const t = n.toFixed(6)
  return t.replace(/\.?0+$/, '') || '0'
}

function coefModelSummary(c: MlPredictionTraceCoefficientsPayload): string {
  const nameRaw = String(c.modelName ?? '—').trim()
  const name = nameRaw === '' ? '—' : nameRaw
  const vsRaw = c.modelVersion == null ? '' : String(c.modelVersion).trim()
  const model = vsRaw === '' ? name : `${name} · ${vsRaw}`
  return t('aiMl.featureMonitorLearnedCoefModelLine', { model })
}

function traceManualBusinessWeight(feature: string): string {
  const w = detail.value?.trace?.weightedFeatureVectorJson?.[feature]?.weight
  if (w == null) return '—'
  return formatWeightedNum(w)
}

function directionLabel(d: string): string {
  if (d === 'positive') return t('aiMl.featureMonitorLearnedDirectionPositive')
  if (d === 'negative') return t('aiMl.featureMonitorLearnedDirectionNegative')
  return t('aiMl.featureMonitorLearnedDirectionNeutral')
}

function directionPillClass(d: string): string {
  if (d === 'positive') return 'text-emerald-300 bg-emerald-950/60 border border-emerald-800/80'
  if (d === 'negative') return 'text-rose-300 bg-rose-950/40 border border-rose-900/80'
  return 'text-slate-400 bg-slate-800/60 border border-slate-700/80'
}

function rowRideName(rideId: string | null | undefined): string {
  if (rideId == null || String(rideId).trim() === '') return '—'
  return rideNameByAssetId.value.get(String(rideId)) ?? t('aiMl.featureMonitorRideUnknownName')
}

const helpGuideOpen = ref(false)

function traceModelCellTitle(modelName: string | null | undefined): string {
  const m = String(modelName ?? '').trim()
  if (m === 'no_governed_snapshot') return t('aiMl.featureMonitorHelpModelNoGovernedTooltip')
  if (m === 'closed_period_forecast') return t('aiMl.featureMonitorHelpModelClosedPeriodTooltip')
  return ''
}

function traceFallbackCellTitle(fallbackUsed: boolean): string {
  return fallbackUsed ? t('aiMl.featureMonitorHelpFallbackYes') : t('aiMl.featureMonitorHelpFallbackNo')
}

function accuracyRowStatusTitle(status: string | null | undefined): string {
  const s = String(status || '').toUpperCase()
  if (s === 'UNKNOWN') return t('aiMl.featureMonitorHelpAccuracyUnknownStatus')
  return ''
}

onMounted(() => {
  void loadRideOptions()
  void loadTraceFilterMeta()
  void refreshList()
  void loadForecastHealthDq()
  void loadFeatureStoreReadiness()
  void loadSnapshotDebug()
})

watch(
  () => parkCtx.activeParkId,
  () => {
    filterRideId.value = ''
    filterModelName.value = ''
    filterTargetName.value = ''
    void loadRideOptions()
    void loadTraceFilterMeta()
    void refreshList()
    void loadForecastHealthDq()
    void loadFeatureStoreReadiness()
    void loadSnapshotDebug()
  }
)

watch([() => filterRideId.value, () => filterFrom.value, () => filterTo.value], () => {
  void loadFeatureStoreReadiness()
})

watch([() => filterRideId.value, () => snapshotDebugWindowHours.value], () => {
  void loadSnapshotDebug()
})

/** Debounce filter changes so the trace list, DQ tiles, and Accuracy KPIs stay in sync without spamming the API. */
let filterRefreshTimer: ReturnType<typeof setTimeout> | null = null
const FILTER_REFRESH_DEBOUNCE_MS = 400

function scheduleFiltersRefresh() {
  if (!parkCtx.activeParkId) return
  if (filterRefreshTimer) clearTimeout(filterRefreshTimer)
  filterRefreshTimer = setTimeout(() => {
    filterRefreshTimer = null
    void refreshList()
  }, FILTER_REFRESH_DEBOUNCE_MS)
}

watch(
  [
    () => filterRideId.value,
    () => filterModelName.value,
    () => filterTargetName.value,
    () => filterFrom.value,
    () => filterTo.value,
    () => filterLimit.value,
  ],
  () => {
    scheduleFiltersRefresh()
  }
)

onBeforeUnmount(() => {
  if (filterRefreshTimer) clearTimeout(filterRefreshTimer)
})
</script>

<template>
  <div class="min-h-screen px-4 py-6 lg:px-8" data-testid="ml-feature-monitor-root">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">
      ← {{ t('aiMl.back') }}
    </RouterLink>

    <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
      <header class="min-w-0 flex-1">
        <h1 :class="ui.title">{{ t('aiMl.featureMonitorTitle') }}</h1>
        <p v-if="parkCtx.activePark?.name" class="mt-1 text-sm text-slate-500 dark:!text-brand-300">
          {{ parkCtx.activePark.name }}
        </p>
      </header>
      <HelpPanelButton
        :expanded="helpGuideOpen"
        controls-id="fm-help-guide-panel"
        @click="helpGuideOpen = true"
      >
        {{ t('aiMl.featureMonitorGuideButton') }}
      </HelpPanelButton>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.card" class="mt-6 text-amber-600 dark:text-amber-500">
      {{ t('aiMl.needPark') }}
    </div>

    <section :class="ui.card" class="mt-6 space-y-4 p-4" data-testid="ml-feature-monitor-filters">
      <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-ride"
          >{{ t('aiMl.featureMonitorFilterRide') }}</label>
          <select
            id="fm-filter-ride"
            v-model="filterRideId"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
            :disabled="rideOptionsLoading"
          >
            <option value="">{{ t('aiMl.featureMonitorRideAny') }}</option>
            <option v-for="r in rideFilterOptions" :key="r.id" :value="r.id">
              {{ r.name }}
            </option>
          </select>
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpRide') }}</span>
        </div>
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-model"
          >{{ t('aiMl.featureMonitorFilterModel') }}</label>
          <select
            v-if="!traceFilterMetaTextFallback"
            id="fm-filter-model"
            v-model="filterModelName"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
            :disabled="traceFilterMetaLoading || !parkCtx.activeParkId"
          >
            <option value="">{{ t('aiMl.featureMonitorFilterAll') }}</option>
            <option v-for="m in traceFilterMetaModelNames" :key="m" :value="m">{{ m }}</option>
          </select>
          <input
            v-else
            id="fm-filter-model"
            v-model="filterModelName"
            type="text"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
            autocomplete="off"
          />
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpModel') }}</span>
          <p
            v-if="traceFilterMetaError && traceFilterMetaTextFallback"
            class="text-[10px] leading-snug text-rose-600 dark:text-rose-400"
          >
            {{ t('aiMl.featureMonitorFilterMetaLoadFailed', { message: traceFilterMetaError }) }}
          </p>
        </div>
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-target"
          >{{ t('aiMl.featureMonitorFilterTarget') }}</label>
          <select
            v-if="!traceFilterMetaTextFallback"
            id="fm-filter-target"
            v-model="filterTargetName"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
            :disabled="traceFilterMetaLoading || !parkCtx.activeParkId"
          >
            <option value="">{{ t('aiMl.featureMonitorFilterAll') }}</option>
            <option v-for="optTarget in traceFilterMetaTargetNames" :key="optTarget" :value="optTarget">{{ optTarget }}</option>
          </select>
          <input
            v-else
            id="fm-filter-target"
            v-model="filterTargetName"
            type="text"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
            autocomplete="off"
          />
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpTarget') }}</span>
          <p
            v-if="traceFilterMetaError && traceFilterMetaTextFallback"
            class="text-[10px] leading-snug text-rose-600 dark:text-rose-400"
          >
            {{ t('aiMl.featureMonitorFilterMetaLoadFailed', { message: traceFilterMetaError }) }}
          </p>
        </div>
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-from"
          >{{ t('aiMl.featureMonitorFilterFrom') }}</label>
          <input
            id="fm-filter-from"
            v-model="filterFrom"
            type="datetime-local"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
          />
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpCreatedAt') }}</span>
        </div>
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-to"
          >{{ t('aiMl.featureMonitorFilterTo') }}</label>
          <input
            id="fm-filter-to"
            v-model="filterTo"
            type="datetime-local"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
          />
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpCreatedAt') }}</span>
        </div>
        <div class="group/tip relative flex min-w-0 flex-col gap-1">
          <label
            :class="ui.filterLabel"
            for="fm-filter-limit"
          >{{ t('aiMl.featureMonitorFilterLimit') }}</label>
          <select
            id="fm-filter-limit"
            v-model.number="filterLimit"
            :class="ui.control"
            class="!mt-0 w-full rounded-lg"
          >
            <option v-for="n in limitOptions" :key="n" :value="n">{{ n }}</option>
          </select>
          <span class="fm-tooltip">{{ t('aiMl.featureMonitorHelpLimit') }}</span>
        </div>
      </div>
      <div>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          :disabled="loading || !parkCtx.activeParkId"
          @click="refreshList"
        >
          {{ t('aiMl.featureMonitorRefresh') }}
        </button>
      </div>
    </section>

    <section
      v-if="parkCtx.activeParkId"
      :class="ui.card"
      class="mt-6 space-y-3 p-4"
      aria-label="ML forecast health strip"
    >
      <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">
        {{ t('aiMl.healthStrip.title') }}
      </h2>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div :class="ui.metricTile" :title="fhCompletenessHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.completenessLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhCompletenessBadge)"
            >
              {{ healthStripStatusLabel(fhCompletenessBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ fhCompletenessPrimary }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhMissingHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.missingLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhMissingBadge)"
            >
              {{ healthStripStatusLabel(fhMissingBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ fhMissingPrimary }}
          </p>
        </div>

        <div v-if="STALE_SIGNALS_API_AVAILABLE" :class="ui.metricTile" :title="fhStaleHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.staleLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhStaleBadge)"
            >
              {{ healthStripStatusLabel(fhStaleBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ fhStalePrimary }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhTraceHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.traceLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhTraceBadge)"
            >
              {{ healthStripStatusLabel(fhTraceBadge) }}
            </span>
          </div>
          <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {{ fhTracePrimary }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhMismatchHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.mismatchLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhMismatchBadge)"
            >
              {{ healthStripStatusLabel(fhMismatchBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{
              fhMismatchBadge === 'warning'
                ? t('aiMl.healthStrip.mismatchPrimaryWarn')
                : t('aiMl.healthStrip.mismatchPrimaryOk')
            }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhCoefHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.coefLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhCoefBadge)"
            >
              {{ healthStripStatusLabel(fhCoefBadge) }}
            </span>
          </div>
          <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {{ fhCoefPrimary }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhExplainHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.explainLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhExplainBadge)"
            >
              {{ healthStripStatusLabel(fhExplainBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ fhExplainPrimary }}
          </p>
        </div>

        <div :class="ui.metricTile" :title="fhAccuracyHelper" class="cursor-help">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
              t('aiMl.healthStrip.accuracyLabel')
            }}</span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="healthStripBadgeClass(fhAccuracyBadge)"
            >
              {{ healthStripStatusLabel(fhAccuracyBadge) }}
            </span>
          </div>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ fhAccuracyPrimary }}
          </p>
        </div>
      </div>
    </section>

    <section
      v-if="parkCtx.activeParkId"
      :class="ui.card"
      class="mt-6 space-y-3 p-4"
      aria-label="Feature Store Readiness"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {{ t('aiMl.fsReadiness.title') }}
          </h2>
          <p v-if="fsReadinessFailed" class="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            {{ t('aiMl.fsReadiness.loadFailed') }}
          </p>
        </div>
        <div class="flex flex-col items-end gap-1">
          <button
            v-if="canAiRefresh"
            type="button"
            class="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            :disabled="rebuildingSnapshots || fsReadinessLoading"
            @click="runFeatureStorePipelineRefresh"
          >
            {{ rebuildingSnapshots ? t('aiMl.forecastAccuracy.rebuildSnapshotsBusy') : t('aiMl.fsReadiness.runPipelineRefresh') }}
          </button>
          <p v-else class="max-w-xs text-right text-[10px] text-slate-500 dark:text-slate-400">
            {{ t('aiMl.fsReadiness.noRefreshPerm') }}
          </p>
        </div>
      </div>

      <p v-if="fsReadinessLoading" class="text-xs text-slate-500 dark:!text-brand-400">
        {{ t('aiMl.fsReadiness.loading') }}
      </p>

      <template v-else-if="fsReadiness">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div :class="ui.metricTile">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
                t('aiMl.fsReadiness.schedulerTile')
              }}</span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="accuracyStatusBadgeClass(fsReadiness.scheduler.status)"
              >
                {{ accuracyStatusLabel(fsReadiness.scheduler.status) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {{
                fsReadiness.scheduler.enabled
                  ? t('aiMl.fsReadiness.schedulerOn', { source: fsReadiness.scheduler.source })
                  : t('aiMl.fsReadiness.schedulerOff', { source: fsReadiness.scheduler.source })
              }}
            </p>
          </div>

          <div :class="ui.metricTile">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
                t('aiMl.fsReadiness.pipelineTile')
              }}</span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="accuracyStatusBadgeClass(fsReadiness.lastPipelineRun.status)"
              >
                {{ accuracyStatusLabel(fsReadiness.lastPipelineRun.status) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {{
                fsReadiness.lastPipelineRun.lastRunAt
                  ? t('aiMl.fsReadiness.pipelineLine', {
                      rides: String(fsReadiness.lastPipelineRun.rideSnapshotsWritten),
                      time: formatDateTime(fsReadiness.lastPipelineRun.lastRunAt),
                    })
                  : t('aiMl.fsReadiness.pipelineNone')
              }}
            </p>
          </div>

          <div :class="ui.metricTile">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
                t('aiMl.fsReadiness.snapshotTile')
              }}</span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="accuracyStatusBadgeClass(fsReadiness.snapshotCoverage.status)"
              >
                {{ accuracyStatusLabel(fsReadiness.snapshotCoverage.status) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {{
                fsReadiness.snapshotCoverage.latestSnapshotAt
                  ? t('aiMl.fsReadiness.snapshotLine', {
                      rows: String(fsReadiness.snapshotCoverage.totalRows),
                      rides: String(fsReadiness.snapshotCoverage.ridesWithSnapshots),
                      latest: formatDateTime(fsReadiness.snapshotCoverage.latestSnapshotAt),
                    })
                  : t('aiMl.fsReadiness.snapshotLineNoLatest', {
                      rows: String(fsReadiness.snapshotCoverage.totalRows),
                      rides: String(fsReadiness.snapshotCoverage.ridesWithSnapshots),
                    })
              }}
            </p>
          </div>

          <div :class="ui.metricTile">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{ t('aiMl.fsReadiness.waitTile') }}</span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="accuracyStatusBadgeClass(fsReadiness.waitTimeCoverage.status)"
              >
                {{ accuracyStatusLabel(fsReadiness.waitTimeCoverage.status) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {{
                t('aiMl.fsReadiness.waitLine', {
                  pct: String(fsReadiness.waitTimeCoverage.coveragePercent),
                  with: String(fsReadiness.waitTimeCoverage.rowsWithWaitTime),
                  total: String(
                    fsReadiness.waitTimeCoverage.rowsWithWaitTime + fsReadiness.waitTimeCoverage.rowsWithoutWaitTime
                  ),
                })
              }}
            </p>
          </div>

          <div :class="ui.metricTile">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-medium text-slate-600 dark:text-slate-400">{{
                t('aiMl.fsReadiness.eligibilityTile')
              }}</span>
              <span
                class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                :class="accuracyStatusBadgeClass(fsReadiness.accuracyEligibility.status)"
              >
                {{ accuracyStatusLabel(fsReadiness.accuracyEligibility.status) }}
              </span>
            </div>
            <p class="mt-2 text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
              {{
                t('aiMl.fsReadiness.eligibilityLine', {
                  eligible: String(fsReadiness.accuracyEligibility.eligibleRows),
                  total: String(fsReadiness.snapshotCoverage.totalRows || 1),
                })
              }}
            </p>
            <ul
              v-if="fsReadiness.accuracyEligibility.topReasons.length"
              class="mt-2 list-none space-y-0.5 text-[10px] text-slate-500 dark:text-slate-400"
            >
              <li v-for="(rr, ix) in fsReadiness.accuracyEligibility.topReasons.slice(0, 4)" :key="ix">
                {{ rr.reason }}: {{ rr.count }}
              </li>
            </ul>
          </div>
        </div>
        <div
          v-if="fsReadiness && !fsReadinessLoading && !fsReadinessFailed"
          class="mt-4 flex flex-wrap gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-700/80"
        >
          <RouterLink
            v-if="canOpenIntegrationSettings"
            :to="{ name: 'integrations' }"
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800"
          >
            {{ t('aiMl.fsReadiness.actionIntegrations') }}
          </RouterLink>
          <RouterLink
            v-if="canOpenRealtimeLive"
            :to="{ name: 'realtime-live-signals' }"
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800"
          >
            {{ t('aiMl.fsReadiness.actionUnsLive') }}
          </RouterLink>
          <RouterLink
            v-if="canOpenPipelineLog"
            :to="{ name: 'adapter-pipeline-log' }"
            class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800"
          >
            {{ t('aiMl.fsReadiness.actionPipeline') }}
          </RouterLink>
          <button
            v-if="canAiRefresh"
            type="button"
            class="rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            :disabled="rebuildingSnapshots"
            @click="runFeatureStorePipelineRefresh"
          >
            {{ t('aiMl.fsReadiness.actionForecastRefresh') }}
          </button>
        </div>
      </template>
    </section>

    <section
      v-if="parkCtx.activeParkId"
      :class="ui.card"
      class="mt-6 space-y-3 p-4"
      aria-label="Feature store snapshot SQL debug"
    >
      <details class="group rounded-lg border border-slate-200/80 bg-slate-50/40 p-3 dark:border-slate-700/80 dark:bg-slate-900/30">
        <summary
          class="cursor-pointer list-none text-sm font-semibold text-slate-800 marker:hidden dark:text-slate-100 [&::-webkit-details-marker]:hidden"
        >
          <span class="inline-flex items-center gap-2">
            <span aria-hidden="true" class="text-slate-400 transition group-open:rotate-90">▸</span>
            {{ t('aiMl.fsSnapshotDebug.title') }}
          </span>
        </summary>
        <div class="mt-2 flex items-center gap-3">
          <label class="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <span>Window</span>
            <select
              v-model.number="snapshotDebugWindowHours"
              :class="ui.control"
              class="!mt-0 rounded-lg"
              :disabled="snapshotDebugLoading"
              :title="t('aiMl.fsSnapshotDebug.windowHelp')"
            >
              <option v-for="h in SNAPSHOT_DEBUG_WINDOW_OPTIONS" :key="h" :value="h">
                {{ t('aiMl.fsSnapshotDebug.windowOption', { hours: String(h) }) }}
              </option>
            </select>
          </label>
        </div>
        <div
          v-if="!filterRideId.trim()"
          class="mt-3 rounded-lg border border-dashed border-slate-300/90 bg-slate-50/60 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-600 dark:bg-slate-900/25 dark:!text-brand-400"
        >
          {{ t('aiMl.fsSnapshotDebug.placeholderNoRide') }}
        </div>
        <template v-else>
          <p v-if="snapshotDebugLoading" class="mt-3 text-xs text-slate-500 dark:!text-brand-400">
            {{ t('aiMl.fsSnapshotDebug.loading') }}
          </p>
          <p v-else-if="snapshotDebugFailed" class="mt-3 text-xs text-amber-700 dark:text-amber-300">
            {{ t('aiMl.fsSnapshotDebug.loadFailed') }}
          </p>
          <template v-else-if="snapshotDebug">
            <p class="mt-3 text-[11px] font-medium text-brand-800 dark:text-brand-300">
              {{ fsSnapshotDebugVerdict(snapshotDebug) }}
            </p>
            <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div :class="ui.metricTile" class="!p-2">
                <p class="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {{ t('aiMl.fsSnapshotDebug.rowsWindow') }}
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {{ String(snapshotDebug.rowsLastWindow) }}
                </p>
              </div>
              <div :class="ui.metricTile" class="!p-2">
                <p class="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {{ t('aiMl.fsSnapshotDebug.rowsWithWait') }}
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {{ String(snapshotDebug.rowsWithNumericWaitInWindow) }}
                </p>
              </div>
              <div :class="ui.metricTile" class="!p-2">
                <p class="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {{ t('aiMl.fsSnapshotDebug.rowsAccuracyEligible') }}
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                  {{ String(snapshotDebug.rowsAccuracyEligibleInWindow) }}
                </p>
              </div>
              <div :class="ui.metricTile" class="!p-2">
                <p class="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {{ t('aiMl.fsSnapshotDebug.latestInWindow') }}
                </p>
                <p class="mt-1 text-xs font-medium leading-snug text-slate-900 dark:text-slate-50">
                  {{
                    snapshotDebug.latestSnapshotAtInWindow
                      ? formatDateTime(snapshotDebug.latestSnapshotAtInWindow)
                      : '—'
                  }}
                </p>
              </div>
              <div :class="ui.metricTile" class="!p-2">
                <p class="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                  {{ t('aiMl.fsSnapshotDebug.latestOverall') }}
                </p>
                <p class="mt-1 text-xs font-medium leading-snug text-slate-900 dark:text-slate-50">
                  {{
                    snapshotDebug.latestSnapshotAtOverall
                      ? formatDateTime(snapshotDebug.latestSnapshotAtOverall)
                      : '—'
                  }}
                </p>
              </div>
            </div>
            <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-700/80">
              <table class="min-w-full text-left text-[10px] text-slate-700 dark:text-slate-200">
                <thead class="bg-slate-100/80 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
                  <tr>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colSnapshotAt') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colWait') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colWaitMin') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colEligible') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colReason') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colParkOpen') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colRideOpen') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colRainMm') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colTempC') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colSchoolHol') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colPublicHol') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colCrowd') }}</th>
                    <th class="px-2 py-1.5 font-medium">{{ t('aiMl.fsSnapshotDebug.colWeekendUtc') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, ix) in snapshotDebug.latestSnapshots"
                    :key="ix"
                    class="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td class="whitespace-nowrap px-2 py-1.5 tabular-nums">
                      {{ row.snapshotAt ? formatDateTime(row.snapshotAt) : '—' }}
                    </td>
                    <td class="max-w-[8rem] truncate px-2 py-1.5">{{ row.waitTime ?? '—' }}</td>
                    <td class="px-2 py-1.5 tabular-nums">{{ row.currentWaitTimeMin ?? '—' }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.accuracyEligible) }}</td>
                    <td class="max-w-[10rem] truncate px-2 py-1.5">{{ row.dataQualityReason ?? '—' }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.parkIsOpen) }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.rideIsOpen) }}</td>
                    <td class="px-2 py-1.5 tabular-nums">{{ row.precipitationMm ?? '—' }}</td>
                    <td class="px-2 py-1.5 tabular-nums">{{ row.temperatureC ?? '—' }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.isSchoolHoliday) }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.isPublicHoliday) }}</td>
                    <td class="px-2 py-1.5 tabular-nums">{{ row.parkCrowdIndex ?? '—' }}</td>
                    <td class="px-2 py-1.5">{{ boolTriLabel(row.isWeekendUtc) }}</td>
                  </tr>
                  <tr v-if="!snapshotDebug.latestSnapshots.length">
                    <td colspan="13" class="px-2 py-3 text-center text-slate-500 dark:text-slate-400">
                      {{ t('aiMl.fsSnapshotDebug.tableEmpty') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </template>
      </details>
    </section>

    <p v-if="loadError" class="mt-3 text-sm text-rose-600 dark:text-rose-400">{{ loadError }}</p>

    <section
      v-if="parkCtx.activeParkId"
      :class="ui.card"
      class="mt-4 space-y-4 p-4"
      aria-label="Forecast accuracy"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {{ t('aiMl.forecastAccuracy.title') }}
        </h2>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1" :class="ui.filterLabel">
            {{ t('aiMl.forecastAccuracy.filterHorizon') }}
            <input
              v-model="filterAccuracyHorizon"
              type="number"
              min="0"
              step="1"
              :class="ui.control"
              class="!mt-0 w-28 rounded-lg"
              placeholder="—"
            />
          </label>
          <label class="flex cursor-pointer items-center gap-2 pb-1 text-[11px] text-slate-600 dark:text-slate-300">
            <input
              v-model="filterForecastAccuracyComparableOnly"
              type="checkbox"
              class="rounded border-slate-400 dark:border-slate-600"
              @change="loadForecastAccuracy()"
            />
            {{ t('aiMl.forecastAccuracy.comparableOnlyLabel') }}
          </label>
          <button
            type="button"
            class="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
            :disabled="accuracyLoading || !parkCtx.activeParkId"
            @click="loadForecastAccuracy"
          >
            {{ t('aiMl.forecastAccuracy.refresh') }}
          </button>
        </div>
      </div>

      <p v-if="accuracyError" class="text-sm text-rose-600 dark:text-rose-400">{{ accuracyError }}</p>

      <details
        class="rounded-lg border border-slate-200/90 bg-slate-50/70 text-slate-700 open:shadow-sm dark:border-brand-800/45 dark:bg-slate-950/55 dark:text-brand-200"
      >
        <summary
          class="cursor-pointer select-none px-3 py-2 text-xs font-semibold tracking-wide text-slate-800 marker:content-none dark:text-brand-100 [&::-webkit-details-marker]:hidden"
        >
          {{ t('aiMl.forecastAccuracy.supportDetailsSummary') }}
        </summary>
        <div
          class="space-y-3 border-t border-slate-200/80 px-3 py-3 text-[11px] leading-relaxed dark:border-brand-800/40"
        >
          <p>{{ t('aiMl.forecastAccuracy.supportIntro') }}</p>
          <ol class="list-decimal space-y-1.5 pl-4">
            <li v-for="(line, idx) in forecastSupportStepTexts" :key="idx">
              {{ line }}
            </li>
          </ol>
          <div class="flex flex-wrap gap-2">
            <RouterLink
              to="/ai-insights/feature-store-monitor"
              class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800"
            >
              {{ t('aiMl.forecastAccuracy.supportLinkFeatureStore') }}
            </RouterLink>
            <RouterLink
              to="/ai-insights/data-quality"
              class="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-brand-700 dark:bg-slate-900 dark:text-brand-100 dark:hover:bg-slate-800"
            >
              {{ t('aiMl.forecastAccuracy.supportLinkDataQuality') }}
            </RouterLink>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canAiRefresh"
              type="button"
              class="rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              :disabled="rebuildingSnapshots || accuracyLoading"
              @click="runFeatureStorePipelineRefresh"
            >
              {{
                rebuildingSnapshots
                  ? t('aiMl.forecastAccuracy.rebuildSnapshotsBusy')
                  : t('aiMl.forecastAccuracy.rebuildSnapshots')
              }}
            </button>
            <p
              v-if="!canAiRefresh"
              class="text-[11px] text-amber-800/90 dark:text-amber-200/90"
            >
              {{ t('aiMl.forecastAccuracy.supportAdminHint') }}
            </p>
            <p
              v-else
              class="text-[10px] text-slate-500 dark:text-slate-400"
            >
              {{ t('aiMl.forecastAccuracy.supportRebuildFootnote') }}
            </p>
          </div>
        </div>
      </details>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div :class="ui.metricTile">
          <p class="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {{ t('aiMl.forecastAccuracy.kpiAvgPct') }}
          </p>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{
              accuracyKpis?.avgPercentageError != null && Number.isFinite(Number(accuracyKpis.avgPercentageError))
                ? `${formatFixedOptional(Number(accuracyKpis.avgPercentageError) * 100, 2)}%`
                : '—'
            }}
          </p>
        </div>
        <div :class="ui.metricTile">
          <p class="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {{ t('aiMl.forecastAccuracy.kpiRmse') }}
          </p>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ formatFixedOptional(accuracyKpis?.rmse ?? null, 3) }}
          </p>
        </div>
        <div :class="ui.metricTile">
          <p class="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {{ t('aiMl.forecastAccuracy.kpiBias') }}
          </p>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ formatFixedOptional(accuracyKpis?.bias ?? null, 3) }}
          </p>
        </div>
        <div :class="ui.metricTile">
          <p class="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {{ t('aiMl.forecastAccuracy.kpiTotal') }}
          </p>
          <p class="mt-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {{ accuracyKpis?.totalEvaluations != null ? String(accuracyKpis.totalEvaluations) : '—' }}
          </p>
        </div>
        <div :class="ui.metricTile">
          <p class="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {{ t('aiMl.forecastAccuracy.kpiCritical') }}
          </p>
          <p class="mt-2 text-lg font-semibold tabular-nums text-rose-200">
            {{ accuracyKpis?.criticalCount != null ? String(accuracyKpis.criticalCount) : '—' }}
          </p>
        </div>
      </div>

      <p
        v-if="
          accuracyKpis &&
          accuracyKpis.totalEvaluations > 0 &&
          accuracyKpis.avgPercentageError == null &&
          (accuracyKpis.unknownCount ?? 0) === accuracyKpis.totalEvaluations
        "
        :class="ui.calloutSm"
      >
        {{ t('aiMl.forecastAccuracy.kpiUnknownOnlyHint', { n: accuracyKpis.totalEvaluations }) }}
      </p>

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:!text-brand-400">
          {{ t('aiMl.forecastAccuracy.chartTitle') }}
        </h3>
        <div
          v-if="accuracyLoading"
          :class="ui.chartLoadingPane"
        >
          {{ t('aiMl.featureMonitorLoading') }}
        </div>
        <div
          v-else-if="accuracyComparableRowCount < 2"
          :class="ui.chartEmptyPane"
        >
          {{
            accuracyRows.length === 0
              ? t('aiMl.forecastAccuracy.chartEmptyNoRows')
              : t('aiMl.forecastAccuracy.chartNeedPairs', {
                  pairs: String(accuracyComparableRowCount),
                })
          }}
        </div>
        <div
          v-else
          ref="accuracyChartEl"
          :class="ui.chartCanvasPane"
        />
      </div>

      <div :class="ui.tableShell">
        <table class="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700">
              <th class="px-3 py-2">{{ t('aiMl.forecastAccuracy.colEvaluatedAt') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.forecastAccuracy.colRide') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.forecastAccuracy.colModel') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.featureMonitorColHorizon') }}</th>
              <th class="px-3 py-2 text-right">{{ t('aiMl.forecastAccuracy.colPredicted') }}</th>
              <th class="px-3 py-2 text-right">{{ t('aiMl.forecastAccuracy.colActual') }}</th>
              <th class="px-3 py-2 text-right">{{ t('aiMl.forecastAccuracy.colAbsErr') }}</th>
              <th class="px-3 py-2 text-right">{{ t('aiMl.forecastAccuracy.colPctErr') }}</th>
              <th class="px-3 py-2 text-right">{{ t('aiMl.forecastAccuracy.colBias') }}</th>
              <th class="px-3 py-2" :title="t('aiMl.forecastAccuracy.colStatusHelp')">{{ t('aiMl.forecastAccuracy.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="accuracyLoading">
              <td colspan="10" class="px-3 py-8 text-center text-slate-500">{{ t('aiMl.featureMonitorLoading') }}</td>
            </tr>
            <tr v-else-if="!accuracyRows.length">
              <td colspan="10" class="px-3 py-8 text-center text-slate-500">
                <p>{{ t('aiMl.forecastAccuracy.empty') }}</p>
                <p class="mt-2 text-xs text-slate-400">{{ t('aiMl.forecastAccuracy.emptyHint') }}</p>
                <p v-if="filterForecastAccuracyComparableOnly" class="mt-2 text-xs text-slate-400">
                  {{ t('aiMl.forecastAccuracy.comparableOnlyEmptyHint') }}
                </p>
              </td>
            </tr>
            <tr
              v-for="ar in accuracyRows"
              :key="ar.id"
              class="border-b border-slate-100 dark:border-slate-800"
            >
              <td class="px-3 py-2 whitespace-nowrap">{{ formatDateTime(ar.evaluatedAt) }}</td>
              <td class="px-3 py-2 max-w-[12rem]">
                <div class="truncate text-sm" :title="rowRideName(ar.rideId)">{{ rowRideName(ar.rideId) }}</div>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ ar.modelName || '—' }}</td>
              <td class="px-3 py-2">{{ ar.horizonMinutes }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatFixedOptional(numFromApi(ar.predictedValue), 2) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatFixedOptional(numFromApi(ar.actualValue), 2) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatFixedOptional(numFromApi(ar.absoluteError), 2) }}</td>
              <td class="px-3 py-2 text-right tabular-nums">
                {{
                  numFromApi(ar.percentageError) != null
                    ? `${formatFixedOptional((numFromApi(ar.percentageError) as number) * 100, 2)}%`
                    : '—'
                }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ formatFixedOptional(numFromApi(ar.bias), 2) }}</td>
              <td class="px-3 py-2">
                <span
                  class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  :class="accuracyStatusBadgeClass(ar.accuracyStatus)"
                  :title="accuracyRowStatusTitle(ar.accuracyStatus) || undefined"
                >
                  {{ accuracyStatusLabel(ar.accuracyStatus) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div
      v-if="parkCtx.activeParkId && rows.length > 0"
      :class="ui.card"
      class="mt-3 p-3"
      aria-label="Trace load summary"
    >
      <p class="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
        {{ t('aiMl.featureMonitorTraceSummaryTitle') }}
      </p>
      <ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:!text-brand-400">
        <li>{{ t('aiMl.featureMonitorTraceSummaryTotal', { n: String(traceLoadSummary.total) }) }}</li>
        <li>{{ t('aiMl.featureMonitorTraceSummaryFallback', { n: String(traceLoadSummary.fallback) }) }}</li>
        <li>{{ t('aiMl.featureMonitorTraceSummaryBaselineOnly', { n: String(traceLoadSummary.baselineOnly) }) }}</li>
        <li>{{ t('aiMl.featureMonitorTraceSummaryNoGov', { n: String(traceLoadSummary.noGov) }) }}</li>
        <li>{{ t('aiMl.featureMonitorTraceSummaryClosed', { n: String(traceLoadSummary.closed) }) }}</li>
      </ul>
      <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-500">{{ t('aiMl.featureMonitorTraceSummaryNote') }}</p>
    </div>

    <p class="mt-3 text-xs leading-relaxed text-slate-600 dark:!text-brand-400">
      {{ t('aiMl.featureMonitorTraceTableHint') }}
    </p>

    <div :class="ui.card" class="mt-3 overflow-x-auto">
      <table class="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700">
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColCreated') }}</th>
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColRide') }}</th>
            <th class="px-3 py-2 min-w-[8rem]">{{ t('aiMl.featureMonitorColDiagnostics') }}</th>
            <th class="px-3 py-2" :title="t('aiMl.featureMonitorHelpModelCol')">{{ t('aiMl.featureMonitorColModel') }}</th>
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColModelVersion') }}</th>
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColTarget') }}</th>
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColHorizon') }}</th>
            <th class="px-3 py-2" :title="t('aiMl.featureMonitorHelpFallbackCol')">{{ t('aiMl.featureMonitorColFallback') }}</th>
            <th class="px-3 py-2 text-right">{{ t('aiMl.featureMonitorColFeatCount') }}</th>
            <th class="px-3 py-2 text-right">{{ t('aiMl.featureMonitorColMissing') }}</th>
            <th class="px-3 py-2">{{ t('aiMl.featureMonitorColPredicted') }}</th>
            <th class="px-3 py-2 text-right">{{ t('aiMl.featureMonitorColAction') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="12" class="px-3 py-8 text-center text-slate-500">{{ t('aiMl.featureMonitorLoading') }}</td>
          </tr>
          <tr v-else-if="!rows.length">
            <td colspan="12" class="px-3 py-8 text-left text-slate-500">
              <p class="text-center font-medium text-slate-700 dark:text-slate-300">{{ t('aiMl.featureMonitorEmpty') }}</p>
              <p class="mx-auto mt-4 max-w-lg text-xs font-medium text-slate-600 dark:text-slate-400">
                {{ t('aiMl.featureMonitorEmptyReasonIntro') }}
              </p>
              <ul
                class="mx-auto mt-2 max-w-lg list-disc space-y-1.5 pl-5 text-left text-xs text-slate-500 dark:text-slate-400"
              >
                <li>{{ t('aiMl.featureMonitorEmptyReasonTraceOff') }}</li>
                <li>{{ t('aiMl.featureMonitorEmptyReasonNoForecast') }}</li>
                <li>{{ t('aiMl.featureMonitorEmptyReasonFilters') }}</li>
                <li>{{ t('aiMl.featureMonitorEmptyReasonClosed') }}</li>
                <li>{{ t('aiMl.featureMonitorEmptyReasonNoSnapshot') }}</li>
                <li v-if="filterRideId.trim()">{{ t('aiMl.featureMonitorEmptyReasonNoMappedSamples') }}</li>
              </ul>
              <p class="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
                {{ t('aiMl.featureMonitorEmptyHint') }}
              </p>
            </td>
          </tr>
          <tr
            v-for="tr in rows"
            :key="tr.id"
            class="border-b border-slate-100 dark:border-slate-800"
          >
            <td class="px-3 py-2 whitespace-nowrap">{{ formatDateTime(tr.createdAt) }}</td>
            <td class="px-3 py-2 max-w-[14rem]">
              <template v-if="tr.rideId">
                <div class="truncate text-sm text-slate-800 dark:text-slate-200" :title="rowRideName(tr.rideId)">
                  {{ rowRideName(tr.rideId) }}
                </div>
                <div class="font-mono text-[11px] text-slate-500 dark:text-slate-500 break-all">
                  {{ tr.rideId }}
                </div>
              </template>
              <span v-else class="font-mono text-xs text-slate-500">—</span>
            </td>
            <td class="px-3 py-2 align-top">
              <div class="flex max-w-[14rem] flex-wrap gap-1">
                <span
                  v-for="b in traceRowBadges(tr)"
                  :key="b.key"
                  class="inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  :class="b.cls"
                >{{ t(traceRowBadgeLabelKey(b.key)) }}</span>
                <span v-if="!traceRowBadges(tr).length" class="text-[10px] text-slate-400">—</span>
              </div>
            </td>
            <td
              class="px-3 py-2"
              :title="traceModelCellTitle(tr.modelName) || undefined"
            >{{ tr.modelName }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ tr.modelVersion || '—' }}</td>
            <td class="px-3 py-2">{{ tr.targetName }}</td>
            <td class="px-3 py-2">{{ tr.horizonMinutes != null ? tr.horizonMinutes : '—' }}</td>
            <td
              class="px-3 py-2"
              :title="traceFallbackCellTitle(tr.fallbackUsed)"
            >{{ tr.fallbackUsed ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</td>
            <td class="px-3 py-2 text-right">{{ rowFeatureCount(tr) }}</td>
            <td class="px-3 py-2 text-right">{{ rowMissingCount(tr) }}</td>
            <td class="px-3 py-2 text-slate-500">{{ rowPredictedDisplay() }}</td>
            <td class="px-3 py-2 text-right">
              <button
                type="button"
                class="text-brand-400 hover:text-brand-300"
                @click="openDetail(tr.predictionId)"
              >
                {{ t('aiMl.featureMonitorViewDetails') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[1px]"
        @click.self="closeDrawer"
      >
        <div
          class="flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
        >
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-white">{{ t('aiMl.featureMonitorDrawerTitle') }}</div>
              <div class="truncate font-mono text-[11px] text-brand-400">{{ selectedPredictionId }}</div>
            </div>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-900"
              @click="closeDrawer"
            >
              {{ t('aiMl.featureMonitorClose') }}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3 text-sm text-slate-300">
            <div v-if="detailLoading" class="text-xs text-slate-500">{{ t('aiMl.featureMonitorDetailLoading') }}</div>
            <p v-else-if="detailError" class="text-rose-400">{{ detailError }}</p>
            <template v-else-if="detail?.trace">
              <section
                class="mb-5 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner ring-1 ring-white/5"
              >
                <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {{ t('aiMl.featureMonitorDetailSummaryTitle') }}
                  </h3>
                  <span
                    v-if="detail.trace.fallbackUsed"
                    class="rounded-full border border-amber-600/50 bg-amber-950/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100"
                  >
                    {{ t('aiMl.featureMonitorFallbackBadge') }}
                  </span>
                </div>
                <dl class="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
                  <div class="sm:col-span-2">
                    <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryRide') }}</dt>
                    <dd class="mt-0.5 text-sm font-medium text-slate-100">
                      {{ rowRideName(detail.trace.rideId) }}
                    </dd>
                  </div>
                  <div class="sm:col-span-2">
                    <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryModel') }}</dt>
                    <dd class="mt-0.5 font-mono text-sm text-slate-200">
                      {{ detailSummaryModelDisplay.name }}
                      <span v-if="detailSummaryModelDisplay.version" class="text-slate-400">
                        · {{ detailSummaryModelDisplay.version }}</span>
                    </dd>
                  </div>
                  <div>
                    <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryTarget') }}</dt>
                    <dd class="mt-0.5 text-slate-100">{{ detail.trace.targetName || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryEngine') }}</dt>
                    <dd class="mt-0.5 text-slate-100">{{ detailEngineModeLabel }}</dd>
                  </div>
                  <div class="sm:col-span-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryPred15') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-200">{{ detailSummaryPred15 }}</dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryPred30') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-200">{{ detailSummaryPred30 }}</dd>
                    </div>
                    <div v-if="detailHasHorizon60">
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryPred60') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-200">{{ detailSummaryPred60 }}</dd>
                    </div>
                    <div :class="detailHasHorizon60 ? '' : 'sm:col-span-2'">
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorDetailSummaryConfidence') }}</dt>
                      <dd class="mt-0.5 font-mono text-slate-200">{{ detailSummaryConfidence }}</dd>
                    </div>
                  </div>
                </dl>
              </section>

              <section v-if="detail.trace.rideId" class="mt-4 border-b border-slate-800 pb-4">
                <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {{ t('aiMl.featureMonitorAssignedProfileTitle') }}
                </h3>
                <div v-if="detailRideProfilesLoading" class="text-xs text-slate-500">{{ t('aiMl.featureMonitorDetailLoading') }}</div>
                <template v-else-if="assignedRideProfilePrimary">
                  <p v-if="detailRideProfiles.length > 1" class="mb-2 text-[10px] text-amber-200/90">
                    {{ t('aiMl.featureMonitorAssignedProfileMultiHint') }}
                  </p>
                  <dl class="grid gap-2 text-xs sm:grid-cols-2">
                    <div class="sm:col-span-2">
                      <dt class="text-slate-500">{{ t('aiMl.metadataProfilesColName') }}</dt>
                      <dd class="text-sm font-medium text-white">{{ assignedRideProfilePrimary.profileName }}</dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileCategory') }}</dt>
                      <dd class="text-slate-200">{{ assignedProfileCategory }}</dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileVersion') }}</dt>
                      <dd class="font-mono text-slate-200">{{ assignedRideProfilePrimary.profileVersion }}</dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileActive') }}</dt>
                      <dd class="text-slate-200">
                        {{ assignedRideProfilePrimary.enabled ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileUpdated') }}</dt>
                      <dd class="text-slate-200">{{ formatDateTime(assignedRideProfilePrimary.updatedAt) }}</dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileSource') }}</dt>
                      <dd class="text-slate-200">{{ t('aiMl.featureMonitorAssignedProfileSourceAssignment') }}</dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileSummary') }}</dt>
                      <dd class="mt-0.5 text-[11px] leading-relaxed text-slate-400">{{ assignedProfileSummaryText }}</dd>
                    </div>
                  </dl>
                  <RouterLink
                    class="mt-3 inline-block text-xs text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
                    :to="{ path: '/ai/ml/profiles', query: { tab: 'ride', rideId: detail.trace.rideId } }"
                  >
                    {{ t('aiMl.featureMonitorLinkRideProfiles') }} →
                  </RouterLink>
                </template>
                <p v-else class="text-xs text-slate-500">{{ t('aiMl.featureMonitorAssignedProfileEmpty') }}</p>
              </section>

              <section class="space-y-2 border-b border-slate-800 pb-4">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {{ t('aiMl.featureMonitorDetailMeta') }}
                </h3>
                <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt class="text-slate-500">predictionId</dt>
                  <dd class="font-mono text-slate-200">{{ detail.trace.predictionId }}</dd>
                  <dt class="text-slate-500">parkId</dt>
                  <dd class="font-mono text-slate-200">{{ detail.trace.parkId || '—' }}</dd>
                  <dt class="text-slate-500">rideId</dt>
                  <dd class="text-slate-200">
                    <template v-if="detail.trace.rideId">
                      <div class="text-slate-200">{{ rowRideName(detail.trace.rideId) }}</div>
                      <div class="break-all font-mono text-[11px] text-slate-400">{{ detail.trace.rideId }}</div>
                    </template>
                    <span v-else>—</span>
                  </dd>
                  <dt class="text-slate-500">modelName</dt>
                  <dd class="font-mono">{{ detail.trace.modelName }}</dd>
                  <dt class="text-slate-500">modelVersion</dt>
                  <dd class="font-mono">{{ detail.trace.modelVersion || '—' }}</dd>
                  <dt class="text-slate-500">targetName</dt>
                  <dd>{{ detail.trace.targetName }}</dd>
                  <dt class="text-slate-500">horizonMinutes</dt>
                  <dd>{{ detail.trace.horizonMinutes != null ? detail.trace.horizonMinutes : '—' }}</dd>
                  <dt class="text-slate-500">fallbackUsed</dt>
                  <dd>{{ detail.trace.fallbackUsed ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</dd>
                  <dt class="text-slate-500">predictionInputHash</dt>
                  <dd class="break-all font-mono text-[11px]">{{ detail.trace.predictionInputHash || '—' }}</dd>
                  <dt class="text-slate-500">createdAt</dt>
                  <dd>{{ formatDateTime(detail.trace.createdAt) }}</dd>
                </dl>
              </section>

              <section class="mt-4 border-b border-slate-800 pb-4">
                <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {{ t('aiMl.featureMonitorRelatedProfiles') }}
                </h3>
                <ul class="space-y-2 text-xs">
                  <li>
                    <RouterLink
                      class="text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
                      :to="{ path: '/ai/ml/profiles', query: { tab: 'park' } }"
                    >
                      {{ t('aiMl.featureMonitorLinkParkProfiles') }} →
                    </RouterLink>
                  </li>
                  <li v-if="detail.trace.rideId">
                    <RouterLink
                      class="text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
                      :to="{ path: '/ai/ml/profiles', query: { tab: 'ride', rideId: detail.trace.rideId } }"
                    >
                      {{ t('aiMl.featureMonitorLinkRideProfiles') }} →
                    </RouterLink>
                  </li>
                </ul>
              </section>

              <section class="mt-4 border-b border-slate-800 pb-4">
                <div
                  class="mb-3 inline-flex flex-wrap rounded-lg border border-slate-700 bg-slate-900/90 p-0.5"
                  role="tablist"
                  aria-label="Feature vector"
                >
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="vectorTab === 'standard'"
                    class="rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors"
                    :class="
                      vectorTab === 'standard'
                        ? 'bg-slate-800 text-brand-300 shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    "
                    @click="vectorTab = 'standard'"
                  >
                    {{ t('aiMl.featureMonitorTabStandardX') }}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="vectorTab === 'weighted'"
                    class="rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors"
                    :class="
                      vectorTab === 'weighted'
                        ? 'border border-brand-400/55 bg-slate-900/95 text-brand-300 shadow-sm'
                        : 'border border-transparent text-slate-500 hover:text-slate-300'
                    "
                    @click="vectorTab = 'weighted'"
                  >
                    {{ t('aiMl.featureMonitorTabWeightedX') }}
                  </button>
                </div>
                <div v-show="vectorTab === 'standard'" role="tabpanel">
                  <p
                    v-if="detail.trace?.governedSnapshotQualityReason"
                    class="mb-2 rounded border border-brand-800/40 bg-slate-950/70 px-2 py-1.5 text-[11px] text-brand-400"
                  >
                    {{ t('aiMl.featureMonitorSnapshotQuality', { reason: detail.trace.governedSnapshotQualityReason }) }}
                  </p>
                  <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.featureMonitorFeatureTable') }}
                  </h3>
                  <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-slate-700 text-slate-500">
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorColFeature') }}</th>
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorColValue') }}</th>
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorColSource') }}</th>
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorColStatus') }}</th>
                          <th class="py-1 text-left">{{ t('aiMl.featureMonitorColMissing') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-if="!featureRows.length">
                          <td colspan="5" class="py-2 text-slate-500">{{ t('aiMl.featureMonitorNoFeatures') }}</td>
                        </tr>
                        <tr v-for="fr in featureRows" :key="fr.name" class="border-b border-slate-800/80">
                          <td class="py-1 pr-2 font-mono text-brand-300">{{ fr.name }}</td>
                          <td class="py-1 pr-2">{{ fr.valueDisplay }}</td>
                          <td class="py-1 pr-2">{{ fr.source }}</td>
                          <td class="py-1 pr-2">{{ fr.status }}</td>
                          <td class="py-1">
                            {{
                              fr.missingLabel === 'yes' ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo')
                            }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div v-show="vectorTab === 'weighted'" role="tabpanel">
                  <template v-if="hasWeightedVector">
                    <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {{ t('aiMl.featureMonitorWeightedTableTitle') }}
                    </h3>
                    <p class="mb-2 text-[11px] text-slate-500 dark:text-brand-400/95">
                      {{ t('aiMl.featureMonitorWeightedHint') }}
                    </p>
                    <div class="overflow-x-auto">
                      <table class="min-w-full text-xs">
                        <thead>
                          <tr class="border-b border-slate-700 text-slate-500">
                            <th class="py-1 pr-2 text-left font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThFeature') }}
                            </th>
                            <th class="py-1 pr-2 text-right font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThRawValue') }}
                            </th>
                            <th class="py-1 pr-2 text-right font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThNormalizedValue') }}
                            </th>
                            <th class="py-1 pr-2 text-right font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThWeight') }}
                            </th>
                            <th class="py-1 pr-2 text-right font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThWeightedValue') }}
                            </th>
                            <th class="py-1 pr-2 text-left font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThSource') }}
                            </th>
                            <th class="py-1 text-left font-mono text-[10px] normal-case">
                              {{ t('aiMl.featureMonitorWeightedThStatus') }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="wr in weightedRows"
                            :key="wr.name"
                            class="border-b border-slate-800/80"
                          >
                            <td class="py-1 pr-2 font-mono text-brand-300">{{ wr.name }}</td>
                            <td class="py-1 pr-2 text-right tabular-nums">{{ wr.rawValue ?? '—' }}</td>
                            <td class="py-1 pr-2 text-right tabular-nums">{{ formatWeightedNum(wr.normalizedValue) }}</td>
                            <td class="py-1 pr-2 text-right tabular-nums">{{ formatWeightedNum(wr.weight) }}</td>
                            <td class="py-1 pr-2 text-right tabular-nums">{{ formatWeightedNum(wr.weightedValue) }}</td>
                            <td class="py-1 pr-2 font-mono text-[11px]">{{ wr.source }}</td>
                            <td class="py-1 font-mono text-[11px]">{{ wr.status }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </template>
                  <p
                    v-else
                    class="rounded-lg border border-amber-900/50 bg-amber-950/25 px-3 py-3 text-sm leading-relaxed text-amber-100/95"
                  >
                    {{ t('aiMl.featureMonitorWeightedEmpty') }}
                  </p>
                </div>
              </section>

              <section class="mt-4 border-b border-slate-800 pb-4">
                <h3 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {{ t('aiMl.featureMonitorLearnedCoefTitle') }}
                </h3>
                <p class="mb-2 text-[11px] leading-relaxed text-slate-500 dark:text-brand-400/90">
                  {{ t('aiMl.featureMonitorLearnedCoefSubtitle') }}
                </p>
                <p class="mb-3 text-[10px] leading-relaxed text-slate-600 dark:text-brand-400/75">
                  {{ t('aiMl.featureMonitorLearnedCoefManualFromTraceHint') }}
                </p>
                <p v-if="mlCoefficientsError" class="mb-3 text-sm text-rose-400">{{ mlCoefficientsError }}</p>
                <template v-else-if="mlCoefficients && mlCoefficients.coefficients.length">
                  <p class="mb-3 break-all font-mono text-[10px] leading-snug text-slate-400">
                    {{ coefModelSummary(mlCoefficients) }}
                  </p>
                  <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                      <thead>
                        <tr class="border-b border-slate-700 text-slate-500">
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorColFeature') }}</th>
                          <th class="py-1 pr-2 text-right tabular-nums">
                            {{ t('aiMl.featureMonitorLearnedColManualWeight') }}
                          </th>
                          <th class="py-1 pr-2 text-right tabular-nums">
                            {{ t('aiMl.featureMonitorLearnedColCoef') }}
                          </th>
                          <th class="py-1 pr-2 text-left">{{ t('aiMl.featureMonitorLearnedColDirection') }}</th>
                          <th class="py-1 text-right tabular-nums">{{ t('aiMl.featureMonitorLearnedColRank') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="row in mlCoefficients.coefficients"
                          :key="row.feature"
                          class="border-b border-slate-800/80"
                        >
                          <td class="py-1 pr-2 font-mono text-brand-300">{{ row.feature }}</td>
                          <td class="py-1 pr-2 text-right tabular-nums">
                            {{ traceManualBusinessWeight(row.feature) }}
                          </td>
                          <td class="py-1 pr-2 text-right tabular-nums">{{ formatWeightedNum(row.coefficient) }}</td>
                          <td class="py-1 pr-2">
                            <span
                              class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                              :class="directionPillClass(row.direction)"
                            >
                              {{ directionLabel(row.direction) }}
                            </span>
                          </td>
                          <td class="py-1 text-right tabular-nums">{{ row.absoluteRank }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </template>
                <p
                  v-else
                  class="rounded-lg border border-brand-900/45 bg-slate-950/50 px-3 py-3 text-sm leading-relaxed text-brand-400"
                >
                  {{ t('aiMl.featureMonitorLearnedCoefEmpty') }}
                </p>
              </section>

              <section class="mt-4">
                <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {{ t('aiMl.featureMonitorResultsTitle') }}
                </h3>
                <p v-if="!detail.results?.length" class="text-xs text-slate-500">
                  {{ t('aiMl.featureMonitorNoResults') }}
                </p>
                <div v-else class="space-y-3">
                  <div
                    v-for="res in detail.results"
                    :key="res.id"
                    class="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs"
                  >
                    <dl class="grid grid-cols-2 gap-x-2 gap-y-1">
                      <dt class="text-slate-500">horizonMinutes</dt>
                      <dd>{{ res.horizonMinutes != null ? res.horizonMinutes : '—' }}</dd>
                      <dt class="text-slate-500">predictedValue</dt>
                      <dd>{{ res.predictedValue ?? '—' }}</dd>
                      <dt class="text-slate-500">actualValue</dt>
                      <dd>{{ res.actualValue ?? '—' }}</dd>
                      <dt class="text-slate-500">confidenceScore</dt>
                      <dd>{{ res.confidenceScore ?? '—' }}</dd>
                      <dt class="text-slate-500">fallbackUsed</dt>
                      <dd>{{ res.fallbackUsed ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</dd>
                      <dt class="text-slate-500">createdAt</dt>
                      <dd>{{ formatDateTime(res.createdAt) }}</dd>
                      <dt class="col-span-2 text-slate-500">reasonCodesJson</dt>
                      <dd class="col-span-2 break-all font-mono text-[11px] text-slate-300">
                        {{ formatReasonCodes(res.reasonCodesJson) }}
                      </dd>
                    </dl>
                  </div>
                </div>
              </section>
            </template>
            <p v-else class="text-xs text-slate-500">{{ t('aiMl.featureMonitorNoTrace') }}</p>
          </div>
        </div>
      </div>
    </Teleport>

    <HelpPanelModal
      v-model="helpGuideOpen"
      panel-id="fm-help-guide-panel"
      title-id="fm-help-guide-title"
    >
      <template #title>{{ t('aiMl.featureMonitorGuideTitle') }}</template>
      <template #closeLabel>{{ t('aiMl.featureMonitorGuideClose') }}</template>
      <p>{{ t('aiMl.featureMonitorGuideIntro') }}</p>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionPrereqTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionPrereqBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionParkTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionParkBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionFiltersTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionFiltersBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionListTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionListBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionDetailTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionDetailBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionEmptyTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionEmptyBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionAccuracyTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.featureMonitorGuideSectionAccuracyBody') }}</p>
      </section>
      <section>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('aiMl.featureMonitorGuideSectionForecastSupportTitle') }}
        </h3>
        <p class="mt-1">{{ t('aiMl.forecastAccuracy.supportIntro') }}</p>
        <ol class="mt-2 list-decimal space-y-1 pl-5">
          <li v-for="(line, idx) in forecastSupportStepTexts" :key="idx">{{ line }}</li>
        </ol>
        <p class="mt-2">{{ t('aiMl.forecastAccuracy.supportAdminHint') }}</p>
      </section>
    </HelpPanelModal>
  </div>
</template>

<style scoped>
.fm-tooltip {
  pointer-events: none;
  position: absolute;
  left: 0;
  top: 100%;
  z-index: 50;
  margin-top: 4px;
  max-width: 260px;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
  white-space: normal;
  opacity: 0;
  transition: opacity 0.15s ease;
  background: #1e293b;
  color: #e2e8f0;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
}
.group\/tip:hover > .fm-tooltip {
  opacity: 1;
}
</style>
