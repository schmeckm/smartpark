<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import {
  getAiFactorConfigs,
  getCanonicalMessages,
  getEntityForecastSummary,
  getIntegrationSettings,
  getParkRideForecastSummaries,
  getPlatformAssets,
  getRideCurrentWaits,
  getRideWaitTimeseries,
  type AiFactorConfig,
  type ForecastInfluencingFactor,
  type ParkForecastSummary,
} from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { waitMinutesFromAssetSnapshot } from '@/utils/assetWaitSnapshot'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useParkContextStore } from '@/stores/parkContext'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

type GridRow = {
  assetId: string
  name: string
  externalEntityId: string
  snapshotWait: number | null
  summary: ParkForecastSummary | null
}

const { t, locale } = useI18n()
const dt = useRegionalDateTime()
const chartZoneNote = computed(() =>
  t('aiRideGrid.timesShownIn', {
    tz: dt.getTimezoneLabel(),
    mode: dt.prefs.value.timeFormat === '12h' ? '12h' : '24h',
  })
)
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()

const loading = ref(false)
const assets = ref<PlatformAsset[]>([])
const summaries = ref<ParkForecastSummary[]>([])
const currentByAssetId = ref<Map<string, { waitTime: number | null; sampledAt: string }>>(new Map())
/** Same source as Live Ops: latest WAIT_TIME_UPDATED canonical payload per external entity. */
const canonicalWaitByExtId = ref<Map<string, number>>(new Map())
const factorLabels = ref<Map<string, string>>(new Map())

/** Bulk list only includes entities with feature snapshots; we hydrate the rest per entity (park/type fallback). */
const MAX_ENTITY_FORECAST_FETCH = 200
const ENTITY_FETCH_CONCURRENCY = 6

const searchQ = ref('')
const sortBy = ref<'name' | 'current' | 'f15' | 'f60' | 'trend' | 'basis' | 'confidence' | 'source' | 'factors'>(
  'name'
)
const sortDir = ref<'asc' | 'desc'>('asc')

const detailOpen = ref(false)
const detailRow = ref<GridRow | null>(null)
const detailQualityExpanded = ref(false)
const detailFactorsExpanded = ref(false)
const detailBucketMin = ref<15 | 30 | 60 | 1440>(60)
const detailDays = ref(7)
const detailShowPointLabels = ref(true)
const detailShowTrendLine = ref(true)
const detailLoading = ref(false)
const detailSeries = ref<{ t: number; wait: number }[]>([])
const detailContext = ref<Awaited<ReturnType<typeof getRideWaitTimeseries>> | null>(null)
const detailChartRef = ref<HTMLDivElement | null>(null)
let detailChartInstance: ReturnType<typeof echarts.init> | null = null
let detailChartResizeObs: ResizeObserver | null = null

function disposeDetailChart() {
  detailChartResizeObs?.disconnect()
  detailChartResizeObs = null
  detailChartInstance?.dispose()
  detailChartInstance = null
}

/** Half-width (minutes) of uncertainty ribbon from global confidence (API has no per-horizon intervals). */
function uncertaintyHalfSpread(waitMinutes: number, confidence01: number): number {
  const c = Math.min(1, Math.max(0, confidence01))
  const w = Math.max(0, Math.abs(waitMinutes))
  const fromConf = (1 - c) * 24
  const fromMag = 0.12 * w
  return Math.max(2.5, Math.min(48, fromConf + fromMag))
}

/** Least-squares line through observed [t, wait] buckets; x scaled from first t in minutes for stability. */
function linearTrendEndpointsFromHist(hist: [number, number][]): [number, number][] | null {
  if (hist.length < 2) return null
  const t0 = hist[0]![0]
  const xs: number[] = []
  const ys: number[] = []
  for (const [t, w] of hist) {
    if (!Number.isFinite(t) || !Number.isFinite(w)) continue
    xs.push((t - t0) / 60_000)
    ys.push(w)
  }
  if (xs.length < 2) return null
  const n = xs.length
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumXY = 0
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]!
    sumY += ys[i]!
    sumXX += xs[i]! * xs[i]!
    sumXY += xs[i]! * ys[i]!
  }
  const denom = n * sumXX - sumX * sumX
  if (Math.abs(denom) < 1e-12) return null
  const b = (n * sumXY - sumX * sumY) / denom
  const a = (sumY - b * sumX) / n
  const tFirst = hist[0]![0]
  const tLast = hist[hist.length - 1]![0]
  const yFirst = a + b * ((tFirst - t0) / 60_000)
  const yLast = a + b * ((tLast - t0) / 60_000)
  return [
    [tFirst, yFirst],
    [tLast, yLast],
  ]
}

const rows = computed<GridRow[]>(() => {
  const byExt = new Map<string, ParkForecastSummary>()
  for (const s of summaries.value) {
    const id = s.externalEntityId ? String(s.externalEntityId) : ''
    if (id) byExt.set(id, s)
  }
  return assets.value.map((a) => {
    const assetId = String(a.assetId ?? '')
    const ext = String(a.externalEntityId ?? '')
    return {
      assetId,
      name: String(a.name ?? assetId),
      externalEntityId: ext,
      snapshotWait: waitMinutesFromAssetSnapshot(a),
      summary: ext ? byExt.get(ext) ?? null : null,
    }
  })
})

function setSort(col: typeof sortBy.value) {
  if (sortBy.value === col) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = col
    sortDir.value = 'asc'
  }
}

function resetFilters() {
  searchQ.value = ''
  sortBy.value = 'name'
  sortDir.value = 'asc'
}

function basisSortKey(r: GridRow): string {
  const s = r.summary
  if (!s) return ''
  return [s.basis ?? '', s.model?.modelName ?? '', s.model?.version ?? ''].join('\t')
}

function formatConfidence(s: ParkForecastSummary | null): string {
  if (!s) return '—'
  const lv = s.confidenceLevel
  const pct = s.confidence != null && Number.isFinite(s.confidence) ? Math.round(s.confidence * 100) : null
  if (lv && pct != null) return `${lv} (${pct}%)`
  if (pct != null) return t('aiRideGrid.confidenceNumeric', { pct })
  return '—'
}

function formatFactorsShort(s: ParkForecastSummary | null): string {
  const facs = s?.topInfluencingFactors
  if (!facs?.length) return '—'
  return facs
    .slice(0, 3)
    .map((f: ForecastInfluencingFactor) => `${f.feature} ${f.impact}`)
    .join(' · ')
}

function trendDisplay(r: GridRow): string {
  const tr = r.summary?.trend
  if (!tr) return '—'
  if (tr === 'RISING') return t('aiRideGrid.trendRISING')
  if (tr === 'FALLING') return t('aiRideGrid.trendFALLING')
  if (tr === 'STABLE') return t('aiRideGrid.trendSTABLE')
  return tr
}

function formatForecastOutputMinutes(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return String(Math.round(Number(v)))
}

/**
 * Single source for “current wait” in grid + detail (live/thematic parity).
 * 1) Canonical adapter WAIT_TIME_UPDATED per external entity
 * 2) rides-current API sample for asset
 * 3) Forecast summary model baseline (currentAvgWaitMinutes)
 * 4) Optional summary.currentWaitMinutes when API sends it
 * 5) Asset sync snapshot (ThemeParks-style queue snapshot on asset)
 */
function currentWaitForRow(r: GridRow): number | null {
  if (r.externalEntityId) {
    const live = canonicalWaitByExtId.value.get(r.externalEntityId)
    if (live != null) return live
  }
  const current = currentByAssetId.value.get(r.assetId)
  if (current && current.waitTime != null) return current.waitTime
  const avg = r.summary?.currentAvgWaitMinutes
  if (avg != null && Number.isFinite(Number(avg))) return Math.round(Number(avg))
  const cw = r.summary?.currentWaitMinutes
  if (cw != null && Number.isFinite(Number(cw))) return Math.round(Number(cw))
  if (r.snapshotWait != null && Number.isFinite(r.snapshotWait)) return Math.round(r.snapshotWait)
  return null
}

const detailForecastMainDrivers = computed(() => {
  const facs = detailRow.value?.summary?.topInfluencingFactors
  if (!facs?.length) return []
  return facs.slice(0, 3)
})

const detailBaselineMismatchHint = computed(() =>
  detailRow.value ? modelBaselineSnapshotMismatchHint(detailRow.value) : null
)

/** Scope of the numeric forecast + configured baseline model (integration feature pipeline, not an arbitrary per-ride NN name). */
function formatModelBasis(r: GridRow): string {
  const s = r.summary
  if (!s) return ''
  const scopeKey =
    s.basis === 'ENTITY'
      ? 'aiRideGrid.basisScopeEntity'
      : s.basis === 'ENTITY_TYPE'
        ? 'aiRideGrid.basisScopeEntityType'
        : s.basis === 'PARK'
          ? 'aiRideGrid.basisScopePark'
          : s.basis === 'NONE'
            ? 'aiRideGrid.basisScopeNone'
            : 'aiRideGrid.basisScopeUnknown'
  const scope = t(scopeKey)
  const name = s.model?.modelName ? String(s.model.modelName) : ''
  const ver = s.model?.version ? String(s.model.version) : ''
  const mType = s.model?.modelType ? String(s.model.modelType) : ''
  const modelBit = [name, [mType, ver].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  return modelBit ? `${scope}: ${modelBit}` : scope
}

const displayRows = computed(() => {
  let list = [...rows.value]
  const q = searchQ.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.externalEntityId.toLowerCase().includes(q) ||
        r.assetId.toLowerCase().includes(q)
    )
  }
  const dir = sortDir.value === 'asc' ? 1 : -1
  const key = sortBy.value
  const trendRank = (x: string | undefined) => {
    if (x === 'RISING') return 2
    if (x === 'FALLING') return 0
    if (x === 'STABLE') return 1
    return -1
  }
  list.sort((a, b) => {
    let cmp = 0
    if (key === 'name') cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    else if (key === 'current') {
      const av = currentWaitForRow(a)
      const bv = currentWaitForRow(b)
      cmp = (av ?? -1) - (bv ?? -1)
    } else if (key === 'f15') {
      cmp = (a.summary?.forecast15Minutes ?? -1) - (b.summary?.forecast15Minutes ?? -1)
    } else if (key === 'f60') {
      cmp = (a.summary?.forecast60Minutes ?? -1) - (b.summary?.forecast60Minutes ?? -1)
    } else if (key === 'trend') {
      cmp = trendRank(a.summary?.trend) - trendRank(b.summary?.trend)
      if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }     else if (key === 'basis') {
      cmp = basisSortKey(a).localeCompare(basisSortKey(b))
    } else if (key === 'confidence') {
      cmp = (a.summary?.confidence ?? -1) - (b.summary?.confidence ?? -1)
    } else if (key === 'source') {
      cmp = (a.summary?.forecastSource ?? '').localeCompare(b.summary?.forecastSource ?? '')
    } else if (key === 'factors') {
      cmp = formatFactorsShort(a.summary).localeCompare(formatFactorsShort(b.summary))
    }
    return cmp * dir
  })
  return list
})

function parsePayloadWaitMinutes(payload: Record<string, unknown>): number | null {
  const w = payload.waitTime
  if (typeof w === 'number' && Number.isFinite(w)) return Math.max(0, Math.round(w))
  if (typeof w === 'string' && w.trim() !== '') {
    const n = Number(w)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  return null
}

function currentIsFromAdapter(r: GridRow): boolean {
  if (!r.externalEntityId) return false
  return canonicalWaitByExtId.value.has(r.externalEntityId)
}

/** Same “(sync)” rule as grid: no adapter live row, no rides-current, no summary — snapshot fills current. */
function currentIsSyncSnapshotOnly(r: GridRow): boolean {
  if (currentIsFromAdapter(r)) return false
  const apiRow = currentByAssetId.value.get(r.assetId)
  if (apiRow?.waitTime != null) return false
  return r.summary == null && r.snapshotWait != null
}

/** When model baseline and asset snapshot both exist and disagree. */
function modelBaselineSnapshotMismatchHint(row: GridRow): string | null {
  const avg = row.summary?.currentAvgWaitMinutes
  const snap = row.snapshotWait
  if (avg == null || snap == null || !Number.isFinite(Number(avg)) || !Number.isFinite(Number(snap))) return null
  if (Math.round(Number(avg)) === Math.round(Number(snap))) return null
  return t('aiRideGrid.modelBaselineHint', { min: Math.round(Number(avg)) })
}

function openDetail(r: GridRow) {
  detailRow.value = r
  detailOpen.value = true
  detailQualityExpanded.value = r.summary?.forecastDataQualityStatus === 'WARNING'
  detailFactorsExpanded.value = false
  void loadDetailSeries()
}

function closeDetail() {
  disposeDetailChart()
  detailOpen.value = false
  detailRow.value = null
  detailSeries.value = []
  detailContext.value = null
}

function bucketMs(m: number) {
  return m * 60 * 1000
}

function aggregateWaits(
  samples: Array<{ sampledAt: string; waitTime: number | null }>,
  bucketMinutes: number
): { t: number; wait: number }[] {
  if (!samples.length) return []
  const width = bucketMs(bucketMinutes)
  const bins = new Map<number, number[]>()
  for (const s of samples) {
    if (s.waitTime == null) continue
    const ts = new Date(s.sampledAt).getTime()
    const k = Math.floor(ts / width) * width
    if (!bins.has(k)) bins.set(k, [])
    bins.get(k)!.push(Number(s.waitTime))
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, vals]) => ({
      t,
      wait: vals.reduce((x, y) => x + y, 0) / vals.length,
    }))
}

function formatDetailChartTime(ts: number): string {
  return dt.formatDateTime(new Date(ts))
}

/** Cap coarsest major ticks on ECharts time axis so labels are not only local midnights (day-only look). */
function timeAxisMaxIntervalMs(spanMs: number): number {
  const ONE_H = 60 * 60 * 1000
  const SIX_H = 6 * ONE_H
  const TWELVE_H = 12 * ONE_H
  const ONE_D = 24 * ONE_H
  if (!Number.isFinite(spanMs) || spanMs <= 0) return TWELVE_H
  if (spanMs > 8 * ONE_D) return ONE_D
  if (spanMs > 1.5 * ONE_D) return TWELVE_H
  if (spanMs > 12 * ONE_H) return SIX_H
  return 2 * ONE_H
}

function weatherContextPerBucket(
  weather: Array<{ observedAt: string; temperatureC: number | null; rainMm: number | null }> | undefined,
  bucketStarts: number[],
  bucketWidthMs: number
): {
  bucketContext: Map<number, { temp: number | null; rain: number | null }>
  tempSeries: [number, number][]
} {
  const bucketContext = new Map<number, { temp: number | null; rain: number | null }>()
  const tempSeries: [number, number][] = []
  if (!weather?.length || !bucketStarts.length)
    return { bucketContext, tempSeries }

  const temps = new Map<number, number[]>()
  const rains = new Map<number, number[]>()
  for (const w of weather) {
    const ts = new Date(w.observedAt).getTime()
    if (!Number.isFinite(ts)) continue
    const k = Math.floor(ts / bucketWidthMs) * bucketWidthMs
    if (w.temperatureC != null && Number.isFinite(Number(w.temperatureC))) {
      if (!temps.has(k)) temps.set(k, [])
      temps.get(k)!.push(Number(w.temperatureC))
    }
    if (w.rainMm != null && Number.isFinite(Number(w.rainMm))) {
      if (!rains.has(k)) rains.set(k, [])
      rains.get(k)!.push(Number(w.rainMm))
    }
  }
  const avg = (arr: number[]) => Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10
  for (const t of bucketStarts) {
    const ta = temps.get(t)
    const ra = rains.get(t)
    const temp = ta?.length ? avg(ta) : null
    const rain = ra?.length ? avg(ra) : null
    bucketContext.set(t, { temp, rain })
    if (temp != null) tempSeries.push([t, temp])
  }
  return { bucketContext, tempSeries }
}

const detailChartPayload = computed(() => {
  const pts = detailSeries.value
  const row = detailRow.value
  if (pts.length < 2) return null

  const stepMin = detailBucketMin.value
  const stepMs = bucketMs(stepMin)
  const now = Date.now()

  const lastBucketStart = pts[pts.length - 1]!.t
  const lastHistEnd = lastBucketStart + stepMs

  const cur = row ? currentWaitForRow(row) : null
  const n15 =
    row?.summary?.forecast15Minutes != null && Number.isFinite(Number(row.summary.forecast15Minutes))
      ? Number(row.summary.forecast15Minutes)
      : null
  const n60 =
    row?.summary?.forecast60Minutes != null && Number.isFinite(Number(row.summary.forecast60Minutes))
      ? Number(row.summary.forecast60Minutes)
      : null

  const confRaw = row?.summary?.confidence
  const confidence01 =
    confRaw != null && Number.isFinite(Number(confRaw)) ? Math.min(1, Math.max(0, Number(confRaw))) : 0.55

  const projPts: { t: number; wait: number }[] = []
  let showProjection = false
  if (cur != null && Number.isFinite(Number(cur)) && (n15 != null || n60 != null)) {
    showProjection = true
    const cw = Number(cur)
    projPts.push({ t: now, wait: cw })
    if (n15 != null) projPts.push({ t: now + bucketMs(15), wait: n15 })
    if (n60 != null) projPts.push({ t: now + bucketMs(60), wait: n60 })
    projPts.sort((a, b) => a.t - b.t)
  }

  const tForecastEnd = now + bucketMs(60)
  const domainEnd = Math.max(lastHistEnd, showProjection ? tForecastEnd : lastHistEnd)

  const histData = pts.map((p) => [p.t, p.wait] as [number, number])
  const trendLineData = linearTrendEndpointsFromHist(histData)
  const bucketStarts = pts.map((p) => p.t)
  const wx = weatherContextPerBucket(detailContext.value?.weather, bucketStarts, stepMs)
  const hasWeatherOverlay = wx.tempSeries.length > 0

  let forecastData: [number, number][] | null = null
  let bandLower: [number, number][] | null = null
  let bandThickness: [number, number][] | null = null
  if (showProjection && projPts.length >= 2) {
    forecastData = projPts.map((p) => [p.t, p.wait])
    bandLower = projPts.map((p) => {
      const half = uncertaintyHalfSpread(p.wait, confidence01)
      return [p.t, p.wait - half]
    })
    bandThickness = projPts.map((p) => {
      const half = uncertaintyHalfSpread(p.wait, confidence01)
      return [p.t, 2 * half]
    })
  }

  return {
    histData,
    trendLineData,
    forecastData,
    bandLower,
    bandThickness,
    now,
    domainEnd,
    showProjection,
    confidence01,
    bucketContext: wx.bucketContext,
    tempSeries: wx.tempSeries,
    hasWeatherOverlay,
  }
})

const detailEChartsOption = computed((): EChartsOption | null => {
  void locale.value
  void detailShowPointLabels.value
  void detailShowTrendLine.value
  const p = detailChartPayload.value
  if (!p) return null

  const labelActual = t('aiRideGrid.chartSeriesActual')
  const labelTrend = t('aiRideGrid.chartSeriesTrend')
  const labelForecast = t('aiRideGrid.chartSeriesForecast')
  const labelUncertainty = t('aiRideGrid.chartSeriesUncertainty')
  const labelTemp = t('aiRideGrid.chartSeriesTemp')
  const showLabels = detailShowPointLabels.value
  const rainShort = t('aiRideGrid.chartRainShort')
  const bucketWeatherLbl = t('aiRideGrid.chartBucketWeather')

  const axisTime = (ms: number) => formatDetailChartTime(ms)
  const tFirst = Number(p.histData[0]?.[0])
  const spanMs = Math.max(0, Number(p.domainEnd) - tFirst)
  const xAxisMaxInterval = timeAxisMaxIntervalMs(spanMs)

  const pointLabelCfg = {
    show: showLabels,
    distance: 8,
    position: 'top' as const,
    color: '#cbd5e1',
    fontSize: 10,
    formatter: (prm: { value?: unknown }) => {
      const raw = prm.value as [number, number] | undefined
      const y = raw?.[1]
      const n = typeof y === 'number' ? y : Number(y)
      return Number.isFinite(n) ? String(Math.round(n)) : ''
    },
  }

  const series: EChartsOption['series'] = []
  const showTempAxis = p.tempSeries.length > 0

  if (p.showProjection && p.bandLower != null && p.bandThickness != null) {
    series.push({
      type: 'line',
      data: p.bandLower,
      stack: 'fcBand',
      symbol: 'none',
      lineStyle: { width: 0 },
      areaStyle: { opacity: 0 },
      silent: true,
      emphasis: { disabled: true },
      z: 1,
    })
    series.push({
      name: labelUncertainty,
      type: 'line',
      data: p.bandThickness,
      stack: 'fcBand',
      symbol: 'none',
      lineStyle: { width: 0 },
      areaStyle: {
        color: 'rgba(251, 191, 36, 0.22)',
      },
      silent: true,
      emphasis: { disabled: true },
      z: 2,
    })
  }

  if (showTempAxis) {
    series.push({
      name: labelTemp,
      type: 'line',
      yAxisIndex: 1,
      smooth: false,
      symbol: 'circle',
      symbolSize: 4,
      showSymbol: p.tempSeries.length <= 72,
      lineStyle: { width: 1.5, color: '#c4b5fd', type: 'dotted' },
      itemStyle: { color: '#ddd6fe' },
      data: p.tempSeries,
      z: 3,
    })
  }

  if (p.trendLineData && detailShowTrendLine.value) {
    series.push({
      name: labelTrend,
      type: 'line',
      smooth: false,
      symbol: 'none',
      lineStyle: { width: 1.75, color: '#2dd4bf', type: [6, 4] },
      data: p.trendLineData,
      z: 3.5,
    })
  }

  series.push({
    name: labelActual,
    type: 'line',
    smooth: false,
    symbol: 'circle',
    symbolSize: 5,
    showSymbol: showLabels || p.histData.length <= 48,
    lineStyle: { width: 2, color: '#38bdf8' },
    itemStyle: { color: '#38bdf8' },
    data: p.histData,
    label: { ...pointLabelCfg },
    labelLayout: { hideOverlap: true },
    z: 4,
    markLine: p.showProjection
      ? {
          symbol: 'none',
          silent: true,
          label: { show: true, formatter: t('aiRideGrid.chartNowMark'), color: '#94a3b8', fontSize: 10 },
          lineStyle: { color: '#64748b', width: 1, type: 'solid' },
          data: [{ xAxis: p.now }],
        }
      : undefined,
  })

  if (p.forecastData != null && p.forecastData.length >= 2) {
    series.push({
      name: labelForecast,
      type: 'line',
      smooth: false,
      symbol: 'diamond',
      symbolSize: 7,
      lineStyle: { width: 2.5, color: '#fbbf24', type: [6, 4] },
      itemStyle: { color: '#fcd34d' },
      data: p.forecastData,
      label: { ...pointLabelCfg },
      labelLayout: { hideOverlap: true },
      z: 5,
    })
  }

  const legendData = [labelActual]
  if (showTempAxis) legendData.push(labelTemp)
  if (p.trendLineData && detailShowTrendLine.value) legendData.push(labelTrend)
  if (p.showProjection) legendData.push(labelForecast, labelUncertainty)

  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8', fontSize: 11 },
    legend: {
      data: legendData,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      top: 2,
      itemGap: 16,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: '#475569', width: 1 } },
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      borderColor: '#334155',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter(params: unknown) {
        if (!Array.isArray(params) || !params.length) return ''
        const ax = params[0]?.axisValue
        const ts = typeof ax === 'number' ? ax : Number(ax)
        const head = Number.isFinite(ts) ? axisTime(ts) : ''
        const hasTempSeries = params.some((x) => x && x.seriesName === labelTemp)
        const lines = params
          .filter(
            (x) =>
              x &&
              (x.seriesName === labelActual ||
                x.seriesName === labelTrend ||
                x.seriesName === labelForecast ||
                x.seriesName === labelTemp)
          )
          .map((x) => {
            const data = x.data as [number, number] | undefined
            const v = Array.isArray(data) ? data[1] : x.value
            const num = Array.isArray(v) ? v[1] : v
            const n = typeof num === 'number' ? num : Number(num)
            const marker = typeof x.marker === 'string' ? x.marker : ''
            if (x.seriesName === labelTemp) {
              const shown = Number.isFinite(n) ? `${Math.round(n * 10) / 10}°C` : '—'
              return `${marker} ${x.seriesName}: ${shown}`
            }
            const shown = Number.isFinite(n) ? `${Math.round(n * 10) / 10} min` : '—'
            return `${marker} ${x.seriesName}: ${shown}`
          })

        const hp = params.find((x) => x && x.seriesName === labelActual)
        let bucketTs = ts
        if (hp && Array.isArray(hp.value)) bucketTs = Number(hp.value[0])
        const cx =
          Number.isFinite(bucketTs) && p.bucketContext.size
            ? p.bucketContext.get(bucketTs)
            : undefined
        if (cx && (cx.temp != null || cx.rain != null)) {
          const bits: string[] = []
          if (cx.temp != null && !hasTempSeries) bits.push(`${cx.temp}°C`)
          if (cx.rain != null) bits.push(`${rainShort} ${cx.rain} mm`)
          if (bits.length) lines.push(`${bucketWeatherLbl}: ${bits.join(' · ')}`)
        }

        return [`<div style="font-weight:600;margin-bottom:4px">${head}</div>`, ...lines].join('<br/>')
      },
    },
    grid: { left: 54, right: showTempAxis ? 52 : 18, top: 34, bottom: 76 },
    xAxis: {
      type: 'time',
      maxInterval: xAxisMaxInterval,
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: {
        color: '#94a3b8',
        fontSize: 10,
        hideOverlap: true,
        formatter: (v: number | string) => axisTime(typeof v === 'number' ? v : Number(v)),
      },
      splitLine: { show: true, lineStyle: { color: '#1e293b', type: 'dashed' } },
    },
    yAxis: showTempAxis
      ? [
          {
            type: 'value',
            name: t('aiRideGrid.chartYAxis'),
            position: 'left',
            nameTextStyle: { color: '#64748b', fontSize: 11 },
            min: 0,
            axisLabel: { color: '#94a3b8', fontSize: 10 },
            splitLine: { lineStyle: { color: '#334155', type: 'dashed' } },
          },
          {
            type: 'value',
            name: t('aiRideGrid.chartYAxisTemp'),
            position: 'right',
            nameTextStyle: { color: '#a78bfa', fontSize: 11 },
            axisLabel: { color: '#c4b5fd', fontSize: 10 },
            splitLine: { show: false },
            axisLine: { show: true, lineStyle: { color: '#6d28d9', opacity: 0.35 } },
          },
        ]
      : {
          type: 'value',
          name: t('aiRideGrid.chartYAxis'),
          nameTextStyle: { color: '#64748b', fontSize: 11 },
          min: 0,
          axisLabel: { color: '#94a3b8', fontSize: 10 },
          splitLine: { lineStyle: { color: '#334155', type: 'dashed' } },
        },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: 'shift',
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 22,
        bottom: 8,
        borderColor: '#475569',
        handleStyle: { color: '#38bdf8' },
        textStyle: { color: '#94a3b8', fontSize: 10 },
        moveHandleStyle: { color: '#64748b' },
        dataBackground: {
          lineStyle: { color: '#334155' },
          areaStyle: { color: 'rgba(51, 65, 85, 0.35)' },
        },
        selectedDataBackground: {
          lineStyle: { color: '#0ea5e9' },
          areaStyle: { color: 'rgba(14, 165, 233, 0.12)' },
        },
      },
    ],
    series,
  }
})

const bucketStepLabel = computed(() =>
  detailBucketMin.value >= 1440 ? t('aiRideGrid.bucketDay') : `${detailBucketMin.value} min`
)

/** Full window (first bucket start → last bucket end) for caption next to step label. */
const detailChartTimeBounds = computed(() => {
  const pts = detailSeries.value
  if (pts.length < 2) return null
  const stepMin = detailBucketMin.value
  const start = pts[0]!.t
  const payload = detailChartPayload.value
  const end = payload?.domainEnd ?? pts[pts.length - 1]!.t + bucketMs(stepMin)
  return { start: formatDetailChartTime(start), end: formatDetailChartTime(end) }
})

watch(
  () =>
    [
      detailOpen.value,
      detailLoading.value,
      detailEChartsOption.value,
      detailChartRef.value,
      locale.value,
      detailShowPointLabels.value,
      detailShowTrendLine.value,
    ] as const,
  async () => {
    await nextTick()
    if (!detailOpen.value) {
      disposeDetailChart()
      return
    }
    if (detailLoading.value) return
    const opt = detailEChartsOption.value
    const el = detailChartRef.value
    if (!el || !opt) return
    if (!detailChartInstance) {
      detailChartInstance = echarts.init(el, undefined, { renderer: 'canvas' })
      detailChartResizeObs = new ResizeObserver(() => detailChartInstance?.resize())
      detailChartResizeObs.observe(el)
    }
    detailChartInstance.setOption(opt, { notMerge: true })
  },
  { flush: 'post' }
)

onBeforeUnmount(() => disposeDetailChart())

const factorBars = computed(() => {
  const s = detailRow.value?.summary
  if (!s?.factors?.length) return []
  const facs = s.factors
  const max = Math.max(0.01, ...facs.map((f: { contribution: number }) => Math.abs(f.contribution)))
  return facs.map((f: { code: string; contribution: number }) => ({
    code: f.code,
    label: factorLabels.value.get(f.code) ?? f.code,
    contribution: f.contribution,
    pct: Math.min(100, (Math.abs(f.contribution) / max) * 100),
    sign: f.contribution >= 0 ? 1 : -1,
  }))
})

async function loadFactorLabels() {
  try {
    const cfg = await getAiFactorConfigs()
    const m = new Map<string, string>()
    for (const f of cfg as AiFactorConfig[]) {
      if (f.code) m.set(f.code, f.label || f.code)
    }
    factorLabels.value = m
  } catch {
    factorLabels.value = new Map()
  }
}

async function loadGrid() {
  const park = parkCtx.activePark
  const extPark = park?.externalEntityId
  if (!parkCtx.activeParkId || !extPark) {
    assets.value = []
    summaries.value = []
    canonicalWaitByExtId.value = new Map()
    return
  }
  loading.value = true
  try {
    const [rideAssets, sum, currentRows, settings] = await Promise.all([
      getPlatformAssets({ parkId: parkCtx.activeParkId, assetTypeCode: 'RIDE', limit: 500 }),
      getParkRideForecastSummaries(String(extPark), { limit: 200 }),
      getRideCurrentWaits({ hours: 24 }),
      getIntegrationSettings().catch(() => ({} as Record<string, unknown>)),
    ])
    assets.value = rideAssets
    const sel = settings?.selectedProvider as { provider?: string } | undefined
    const provider = sel?.provider || 'themeparks_wiki'
    const extParkStr = String(extPark)
    const byEntity = new Map<string, ParkForecastSummary>()
    for (const s of sum) {
      const id = s.externalEntityId != null ? String(s.externalEntityId) : ''
      if (id) byEntity.set(id, s)
    }
    const missingIds = [
      ...new Set(
        rideAssets
          .map((a) => String(a.externalEntityId ?? ''))
          .filter((id) => id && !byEntity.has(id))
      ),
    ].slice(0, MAX_ENTITY_FORECAST_FETCH)
    for (let i = 0; i < missingIds.length; i += ENTITY_FETCH_CONCURRENCY) {
      const chunk = missingIds.slice(i, i + ENTITY_FETCH_CONCURRENCY)
      await Promise.all(
        chunk.map(async (extId) => {
          const asset = rideAssets.find((a) => String(a.externalEntityId) === extId)
          const entityTypeRaw = asset?.entityType ?? asset?.assetTypeCode
          const entityType = typeof entityTypeRaw === 'string' && entityTypeRaw.trim() ? entityTypeRaw.trim() : undefined
          try {
            const s = await getEntityForecastSummary(extId, {
              externalParkId: extParkStr,
              provider,
              entityType,
            })
            if (s?.externalEntityId) byEntity.set(String(s.externalEntityId), s)
          } catch {
            /* missing snapshots / permissions */
          }
        })
      )
    }
    summaries.value = [...byEntity.values()]
    const m = new Map<string, { waitTime: number | null; sampledAt: string }>()
    for (const row of currentRows) {
      if (row?.assetId && row.current) {
        m.set(String(row.assetId), {
          waitTime: row.current.waitTime ?? null,
          sampledAt: row.current.sampledAt,
        })
      }
    }
    currentByAssetId.value = m

    const canon = new Map<string, number>()
    try {
      const messages = await getCanonicalMessages({
        provider,
        externalParkId: String(extPark),
        messageType: 'WAIT_TIME_UPDATED',
        limit: 500,
      })
      for (const msg of messages) {
        if (!msg.externalEntityId) continue
        const ext = String(msg.externalEntityId)
        if (canon.has(ext)) continue
        const payload = (msg.payload || {}) as Record<string, unknown>
        const wt = parsePayloadWaitMinutes(payload)
        if (wt != null) canon.set(ext, wt)
      }
    } catch {
      /* integrations.read / canonical list may be forbidden in some roles */
    }
    canonicalWaitByExtId.value = canon
  } catch (e) {
    assets.value = []
    summaries.value = []
    currentByAssetId.value = new Map()
    canonicalWaitByExtId.value = new Map()
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadDetailSeries() {
  const r = detailRow.value
  if (!r?.assetId || !parkCtx.activeParkId) return
  detailLoading.value = true
  try {
    const to = new Date()
    const from = new Date(to.getTime() - detailDays.value * 24 * 60 * 60 * 1000)
    const raw = await getRideWaitTimeseries(r.assetId, {
      from: from.toISOString(),
      to: to.toISOString(),
      includeContext: true,
    })
    detailContext.value = raw
    detailSeries.value = aggregateWaits(raw.waitSamples, detailBucketMin.value)
  } catch (e) {
    detailContext.value = null
    detailSeries.value = []
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    detailLoading.value = false
  }
}

watch(
  () => parkCtx.activeParkId,
  () => {
    void loadGrid()
  },
  { immediate: true }
)

watch([detailBucketMin, detailDays], () => {
  if (detailOpen.value) void loadDetailSeries()
})

void loadFactorLabels()
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiRideGrid.back') }}</RouterLink>

    <div>
      <h1 :class="ui.title">{{ t('aiRideGrid.title') }}</h1>
      <p :class="ui.subtitle">{{ t('aiRideGrid.subtitle') }}</p>
    </div>

    <div v-if="!parkCtx.activePark?.externalEntityId" :class="ui.card" class="text-amber-600 dark:text-amber-400">
      {{ t('aiRideGrid.needExternalPark') }}
    </div>

    <template v-else>
      <div :class="ui.card" class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="loading"
          @click="loadGrid()"
        >
          {{ t('btn.refresh') }}
        </button>
        <span v-if="loading" :class="ui.muted">{{ t('aiRideGrid.loading') }}</span>
      </div>

      <div :class="ui.card" class="overflow-x-auto">
        <div class="flex flex-wrap items-end gap-3 border-b border-slate-700/50 px-1 pb-3 pt-1">
          <div class="min-w-[12rem] flex-1">
            <label class="mb-1 block text-xs font-medium text-slate-400" for="ride-wait-search">{{
              t('aiRideGrid.searchLabel')
            }}</label>
            <input
              id="ride-wait-search"
              v-model="searchQ"
              type="search"
              autocomplete="off"
              :placeholder="t('aiRideGrid.searchPlaceholder')"
              class="w-full rounded-md border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            type="button"
            class="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/80"
            @click="resetFilters"
          >
            {{ t('aiRideGrid.resetFilters') }}
          </button>
        </div>
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr :class="ui.muted">
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('name')">
                {{ t('aiRideGrid.colRide') }}
                <span v-if="sortBy === 'name'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('current')">
                {{ t('aiRideGrid.colCurrent') }}
                <span v-if="sortBy === 'current'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('f15')">
                {{ t('aiRideGrid.colF15') }}
                <span v-if="sortBy === 'f15'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('f60')">
                {{ t('aiRideGrid.colF60') }}
                <span v-if="sortBy === 'f60'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('trend')">
                {{ t('aiRideGrid.colTrend') }}
                <span v-if="sortBy === 'trend'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('confidence')">
                {{ t('aiRideGrid.colConfidence') }}
                <span v-if="sortBy === 'confidence'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('source')">
                {{ t('aiRideGrid.colSource') }}
                <span v-if="sortBy === 'source'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="max-w-[12rem] cursor-pointer py-2 pr-3 select-none hover:text-slate-200" @click="setSort('factors')">
                {{ t('aiRideGrid.colFactors') }}
                <span v-if="sortBy === 'factors'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th
                class="max-w-[14rem] cursor-pointer py-2 pr-3 select-none hover:text-slate-200"
                :title="t('aiRideGrid.colBasisHint')"
                @click="setSort('basis')"
              >
                {{ t('aiRideGrid.colBasis') }}
                <span v-if="sortBy === 'basis'" class="ml-0.5 text-xs opacity-70">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
              </th>
              <th class="py-2 pr-2 text-right">{{ t('aiRideGrid.colAction') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in displayRows" :key="r.assetId" class="border-t border-slate-700/50">
              <td class="py-2 pr-3 font-medium">{{ r.name }}</td>
              <td class="py-2 pr-3">
                {{ formatForecastOutputMinutes(currentWaitForRow(r)) }}
                <span v-if="currentIsFromAdapter(r)" class="text-xs opacity-70"> {{ t('aiRideGrid.tagAdapter') }}</span>
                <span
                  v-else-if="r.summary == null && r.snapshotWait != null"
                  class="text-xs opacity-70"
                >
                  {{ t('aiRideGrid.tagSync') }}</span>
              </td>
              <td class="py-2 pr-3">{{ r.summary?.forecast15Minutes ?? '—' }}</td>
              <td class="py-2 pr-3">{{ r.summary?.forecast60Minutes ?? '—' }}</td>
              <td class="py-2 pr-3">{{ trendDisplay(r) }}</td>
              <td class="py-2 pr-3 text-xs">{{ formatConfidence(r.summary) }}</td>
              <td class="max-w-[8rem] truncate py-2 pr-3 font-mono text-xs" :title="r.summary?.forecastSource ?? ''">
                {{ r.summary?.forecastSource ?? '—' }}
              </td>
              <td class="max-w-[12rem] truncate py-2 pr-3 text-xs" :title="formatFactorsShort(r.summary)">
                {{ formatFactorsShort(r.summary) }}
              </td>
              <td class="max-w-[14rem] truncate py-2 pr-3 text-xs" :title="formatModelBasis(r)">
                {{ formatModelBasis(r) || '—' }}
              </td>
              <td class="py-2 pr-2 text-right">
                <button
                  type="button"
                  class="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-800/80"
                  @click="openDetail(r)"
                >
                  {{ t('aiRideGrid.details') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && !rows.length" :class="ui.muted" class="mt-2">{{ t('aiRideGrid.emptyRides') }}</p>
        <p v-else-if="!loading && rows.length && !displayRows.length" :class="ui.muted" class="mt-2">
          {{ t('aiRideGrid.noFilterMatches') }}
        </p>
      </div>
    </template>

    <!-- Detail modal -->
    <div
      v-if="detailOpen && detailRow"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-2 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      @click.self="closeDetail()"
    >
      <div
        class="flex max-h-[90vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-2xl"
        @click.stop
      >
        <header class="flex shrink-0 items-start justify-between gap-2 border-b border-slate-700 bg-slate-950 px-3 py-2 sm:px-4">
          <div class="min-w-0">
            <h2 class="truncate text-lg font-semibold text-slate-50">{{ detailRow.name }}</h2>
            <p class="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-400">
              {{ t('aiRideGrid.detailHint') }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800"
            @click="closeDetail()"
          >
            ✕
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-3">
          <!-- A) Forecast output -->
          <section v-if="detailRow" class="border-b border-slate-700/70 pb-3">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {{ t('aiRideGrid.forecastOutputTitle') }}
              </h3>
              <span
                v-if="detailRow.summary?.forecastDataQualityStatus === 'WARNING'"
                class="rounded border border-amber-500/45 bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-100"
              >
                {{ t('aiRideGrid.forecastOutputQualityWarning') }}
              </span>
            </div>

            <div
              class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:flex lg:flex-nowrap lg:gap-2 lg:overflow-x-auto lg:pb-0.5"
            >
              <div
                class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 lg:min-w-[4.75rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.currentWait') }}
                </div>
                <div class="text-base font-semibold tabular-nums leading-tight text-slate-50">
                  {{ formatForecastOutputMinutes(currentWaitForRow(detailRow)) }}
                </div>
                <div class="mt-0.5 min-h-[1rem] space-y-0.5 text-[10px] leading-tight text-slate-500">
                  <span v-if="currentIsFromAdapter(detailRow)">{{ t('aiRideGrid.tagAdapter').trim() }}</span>
                  <span v-else-if="currentIsSyncSnapshotOnly(detailRow)">{{ t('aiRideGrid.tagSync').trim() }}</span>
                  <span v-if="detailBaselineMismatchHint" class="block text-slate-500">{{ detailBaselineMismatchHint }}</span>
                </div>
              </div>
              <div
                class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 lg:min-w-[4.75rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.forecast15') }}
                </div>
                <div class="text-base font-semibold tabular-nums leading-tight text-slate-50">
                  {{ formatForecastOutputMinutes(detailRow.summary?.forecast15Minutes) }}
                </div>
              </div>
              <div
                class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 lg:min-w-[4.75rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.forecast60') }}
                </div>
                <div class="text-base font-semibold tabular-nums leading-tight text-slate-50">
                  {{ formatForecastOutputMinutes(detailRow.summary?.forecast60Minutes) }}
                </div>
              </div>
              <div
                class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 lg:min-w-[4.75rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.colTrend') }}
                </div>
                <div class="text-base font-semibold leading-tight text-slate-50">
                  {{ trendDisplay(detailRow) }}
                </div>
              </div>
              <div
                class="min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 lg:min-w-[5.5rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.confidence') }}
                </div>
                <div class="text-sm font-semibold leading-tight text-slate-50">
                  {{ formatConfidence(detailRow.summary) }}
                </div>
              </div>
              <div
                class="col-span-2 min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 sm:col-span-2 lg:min-w-[7rem] lg:flex-[1.35]"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.forecastSource') }}
                </div>
                <div
                  class="truncate text-sm font-semibold leading-tight text-slate-50 font-mono"
                  :title="detailRow.summary?.forecastSource ?? ''"
                >
                  {{ detailRow.summary?.forecastSource?.trim() ? detailRow.summary.forecastSource : '—' }}
                </div>
              </div>
              <div
                class="col-span-2 min-w-0 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 sm:col-span-2 lg:min-w-[5rem] lg:flex-1"
              >
                <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.mlProfile') }}
                </div>
                <div
                  class="truncate text-sm font-semibold leading-tight text-slate-50 font-mono"
                  :title="detailRow.summary?.mlProfileCode ? String(detailRow.summary.mlProfileCode) : ''"
                >
                  {{
                    detailRow.summary?.mlProfileCode != null &&
                    String(detailRow.summary.mlProfileCode).trim() !== ''
                      ? String(detailRow.summary.mlProfileCode)
                      : '—'
                  }}
                </div>
              </div>
            </div>

            <div v-if="detailForecastMainDrivers.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="(inf, i) in detailForecastMainDrivers"
                :key="i"
                class="rounded-full border border-slate-600 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200"
              >
                {{ inf.feature }}
                <span class="font-mono text-amber-300/90">{{ inf.impact }}</span>
              </span>
            </div>

            <p
              v-if="
                detailRow.summary?.forecastDataQualityStatus === 'WARNING' &&
                (detailRow.summary?.forecast15Minutes != null ||
                  detailRow.summary?.forecast60Minutes != null)
              "
              class="mt-2 rounded border border-sky-700/40 bg-sky-950/60 px-2 py-1.5 text-[11px] leading-snug text-sky-100/95"
            >
              {{ t('aiRideGrid.forecastExternalIncomplete') }}
            </p>
          </section>

          <!-- B) Chart controls -->
          <div class="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label :class="ui.label" class="!text-[11px]" for="det-bucket">{{ t('aiRideGrid.bucket') }}</label>
              <select id="det-bucket" v-model.number="detailBucketMin" :class="ui.control" class="!mt-0.5 text-sm">
                <option :value="15">15 min</option>
                <option :value="30">30 min</option>
                <option :value="60">60 min</option>
                <option :value="1440">{{ t('aiRideGrid.bucketDay') }}</option>
              </select>
            </div>
            <div>
              <label :class="ui.label" class="!text-[11px]" for="det-days">{{ t('aiRideGrid.historyDays') }}</label>
              <select id="det-days" v-model.number="detailDays" :class="ui.control" class="!mt-0.5 text-sm">
                <option :value="3">3</option>
                <option :value="7">7</option>
                <option :value="14">14</option>
                <option :value="30">30</option>
              </select>
            </div>
            <label class="flex cursor-pointer items-center gap-2 pt-5 text-[11px] text-slate-300">
              <input
                id="det-point-labels"
                v-model="detailShowPointLabels"
                type="checkbox"
                class="rounded border-slate-500 bg-slate-900 text-brand-500 focus:ring-brand-500"
              />
              {{ t('aiRideGrid.chartPointLabels') }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 pt-5 text-[11px] text-slate-300">
              <input
                id="det-trend-line"
                v-model="detailShowTrendLine"
                type="checkbox"
                class="rounded border-slate-500 bg-slate-900 text-brand-500 focus:ring-brand-500"
              />
              {{ t('aiRideGrid.chartShowTrendLine') }}
            </label>
          </div>

          <!-- C) Wait time chart -->
          <section class="mt-2 space-y-1">
            <h3 class="text-xs font-semibold text-slate-400">{{ t('aiRideGrid.chartWait') }}</h3>
            <p class="text-[10px] leading-snug text-slate-500">{{ t('aiRideGrid.chartWaitHint') }}</p>
            <p class="text-[10px] leading-snug text-slate-500">{{ t('aiRideGrid.chartZoomHint') }}</p>
            <p class="text-[10px] leading-snug text-slate-500">{{ t('aiRideGrid.chartFactorTimeHint') }}</p>
            <p v-if="detailChartPayload?.trendLineData" class="text-[10px] leading-snug text-slate-500">
              {{ t('aiRideGrid.chartTrendHint') }}
            </p>
            <p v-if="detailChartPayload?.hasWeatherOverlay" class="text-[10px] leading-snug text-slate-500">
              {{ t('aiRideGrid.chartContextOverlayHint') }}
            </p>
            <div v-if="detailLoading" class="text-xs text-slate-500">{{ t('aiRideGrid.loading') }}</div>
            <div
              v-else-if="detailChartPayload"
              class="overflow-hidden rounded border border-slate-700 bg-slate-900"
            >
              <div
                ref="detailChartRef"
                class="h-[min(22rem,48vh)] w-full min-h-[240px]"
                role="img"
                :aria-label="t('aiRideGrid.chartAria')"
              />
              <p class="px-2 pb-1 pt-1 text-[11px] text-slate-500">
                <template v-if="detailChartTimeBounds">
                  {{
                    t('aiRideGrid.bucketsWithRange', {
                      n: detailSeries.length,
                      step: bucketStepLabel,
                      start: detailChartTimeBounds.start,
                      end: detailChartTimeBounds.end,
                    })
                  }}
                </template>
                <template v-else>
                  {{ t('aiRideGrid.buckets', { n: detailSeries.length, step: bucketStepLabel }) }}
                </template>
              </p>
              <p v-if="detailChartPayload.showProjection" class="px-2 pb-0.5 text-[10px] text-slate-500">
                {{ t('aiRideGrid.chartForecastLegend') }}
              </p>
              <p v-if="detailChartPayload.showProjection" class="px-2 pb-0.5 text-[10px] text-slate-500">
                {{ t('aiRideGrid.chartUncertaintyHint') }}
              </p>
              <p class="px-2 pb-2 text-[10px] text-slate-600">{{ chartZoneNote }}</p>
            </div>
            <p v-else class="text-xs text-slate-500">{{ t('aiRideGrid.chartEmpty') }}</p>
          </section>

          <!-- D) Influencing factors -->
          <section
            v-if="detailRow.summary?.topInfluencingFactors?.length"
            class="mt-4 space-y-1.5 rounded-md border border-slate-700 bg-slate-900 p-2.5"
          >
            <h3 class="text-xs font-semibold text-slate-300">{{ t('aiRideGrid.influencingTitle') }}</h3>
            <p class="text-[11px] leading-snug text-slate-500">{{ t('aiRideGrid.influencingHint') }}</p>
            <ul class="flex flex-wrap gap-1.5">
              <li
                v-for="(inf, i) in detailRow.summary.topInfluencingFactors"
                :key="i"
                class="rounded-full border border-brand-500/35 bg-brand-950/40 px-2 py-0.5 text-[11px] text-brand-100"
              >
                {{ inf.feature }} <span class="font-mono text-amber-300/90">{{ inf.impact }}</span>
              </li>
            </ul>
            <p
              v-if="detailRow.summary.snapshotContext"
              class="mt-2 grid gap-1 text-[11px] text-slate-400 sm:grid-cols-2"
            >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflWeather') }}:</span>
                {{ detailRow.summary.snapshotContext.weather?.temperatureC ?? '—' }}°C · rain
                {{ detailRow.summary.snapshotContext.weather?.precipitationMm ?? '—' }} mm</span
              >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflCalendar') }}:</span>
                <template v-if="detailRow.summary.snapshotContext.calendar?.calendarRowConfigured">
                  <template
                    v-if="
                      detailRow.summary.snapshotContext.calendar?.isPublicHoliday ||
                      detailRow.summary.snapshotContext.calendar?.isSchoolHoliday ||
                      (detailRow.summary.snapshotContext.calendar?.holidayName &&
                        String(detailRow.summary.snapshotContext.calendar.holidayName).trim())
                    "
                  >
                    {{ detailRow.summary.snapshotContext.calendar?.isPublicHoliday ? 'PH ' : '' }}
                    {{ detailRow.summary.snapshotContext.calendar?.isSchoolHoliday ? 'School ' : '' }}
                    {{
                      detailRow.summary.snapshotContext.calendar?.holidayName &&
                      String(detailRow.summary.snapshotContext.calendar.holidayName).trim()
                        ? detailRow.summary.snapshotContext.calendar.holidayName
                        : ''
                    }}
                  </template>
                  <template v-else>{{ t('aiRideGrid.calendarRegularDay') }}</template>
                </template>
                <template v-else>—</template></span
              >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflTraffic') }}:</span>
                {{ detailRow.summary.snapshotContext.traffic?.trafficIndex ?? '—' }}</span
              >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflStaffing') }}:</span>
                {{ detailRow.summary.snapshotContext.staffing?.staffingGapNormal ?? '—' }}</span
              >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflCapacity') }}:</span>
                {{ detailRow.summary.snapshotContext.capacity?.theoreticalCapacityPph ?? '—' }}</span
              >
              <span
                ><span class="text-slate-500">{{ t('aiRideGrid.inflCrowd') }}:</span>
                {{ detailRow.summary.snapshotContext.parkCrowdIndex ?? '—' }}</span
              >
            </p>
          </section>

          <!-- E) Data quality (accordion): warnings vs informational notes -->
          <section
            v-if="
              (detailRow.summary?.featureDataQuality?.length ?? 0) > 0 ||
              (detailRow.summary?.featureDataQualityNotes?.length ?? 0) > 0
            "
            class="mt-3 overflow-hidden rounded-md border"
            :class="
              (detailRow.summary?.featureDataQuality?.length ?? 0) > 0
                ? 'border-amber-800/50 bg-amber-950/25'
                : 'border-slate-600/45 bg-slate-900/40'
            "
          >
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium hover:bg-black/10"
              :class="
                (detailRow.summary?.featureDataQuality?.length ?? 0) > 0
                  ? 'text-amber-100'
                  : 'text-slate-300'
              "
              :aria-expanded="detailQualityExpanded"
              @click="detailQualityExpanded = !detailQualityExpanded"
            >
              <span>{{ t('aiRideGrid.qualityTitle') }}</span>
              <span class="shrink-0 text-slate-400" aria-hidden="true">{{
                detailQualityExpanded ? '▾' : '▸'
              }}</span>
            </button>
            <p
              class="px-2.5 pb-2 text-[10px] leading-snug"
              :class="
                (detailRow.summary?.featureDataQuality?.length ?? 0) > 0
                  ? 'text-amber-100/75'
                  : 'text-slate-400'
              "
            >
              {{ t('aiRideGrid.qualityFootnote') }}
            </p>
            <div
              v-show="detailQualityExpanded"
              class="border-t px-2.5 pb-2 pt-1 text-[11px]"
              :class="
                (detailRow.summary?.featureDataQuality?.length ?? 0) > 0
                  ? 'border-amber-800/30 text-amber-100/90'
                  : 'border-slate-600/35 text-slate-300'
              "
            >
              <template v-if="(detailRow.summary?.featureDataQualityNotes?.length ?? 0) > 0">
                <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {{ t('aiRideGrid.qualityNotesHeading') }}
                </p>
                <ul class="mb-3 list-inside list-disc space-y-0.5 text-slate-400">
                  <li v-for="(n, ni) in detailRow.summary?.featureDataQualityNotes ?? []" :key="'n' + ni">{{ n }}</li>
                </ul>
              </template>
              <template v-if="(detailRow.summary?.featureDataQuality?.length ?? 0) > 0">
                <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-200/85">
                  {{ t('aiRideGrid.qualityWarningsHeading') }}
                </p>
                <ul class="list-inside list-disc space-y-0.5">
                  <li v-for="(q, qi) in detailRow.summary?.featureDataQuality ?? []" :key="qi">{{ q }}</li>
                </ul>
              </template>
              <p
                v-if="detailRow.summary?.snapshotCompletenessScore != null"
                class="mt-2 font-mono text-[10px] opacity-80"
              >
                completeness: {{ detailRow.summary.snapshotCompletenessScore }}
              </p>
            </div>
          </section>

          <!-- F) Model factors (accordion) -->
          <section class="mt-3 overflow-hidden rounded-md border border-slate-700 bg-slate-900">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-slate-300 hover:bg-slate-800/80"
              :aria-expanded="detailFactorsExpanded"
              @click="detailFactorsExpanded = !detailFactorsExpanded"
            >
              <span>{{ t('aiRideGrid.factorsTitle') }}</span>
              <span class="shrink-0 text-slate-500" aria-hidden="true">{{
                detailFactorsExpanded ? '▾' : '▸'
              }}</span>
            </button>
            <div
              v-show="detailFactorsExpanded"
              class="border-t border-slate-700 px-2.5 pb-2.5 pt-2"
            >
              <p class="text-[11px] leading-snug text-slate-500">{{ t('aiRideGrid.factorsHint') }}</p>
              <div v-if="!factorBars.length" class="mt-2 text-xs text-slate-500">
                {{ t('aiRideGrid.noFactors') }}
              </div>
              <ul v-else class="mt-2 space-y-1.5">
                <li v-for="f in factorBars" :key="f.code" class="text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="text-slate-200">{{ f.label }}</span>
                    <span class="font-mono text-xs" :class="f.sign >= 0 ? 'text-amber-400' : 'text-emerald-400'">
                      {{ f.contribution >= 0 ? '+' : '' }}{{ f.contribution.toFixed(3) }}
                    </span>
                  </div>
                  <div class="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-800">
                    <div class="h-full rounded bg-brand-500/80" :style="{ width: `${f.pct}%` }" />
                  </div>
                </li>
              </ul>
            </div>
          </section>

          <p
            v-if="detailContext?.weather?.length"
            class="mt-3 text-[11px] text-slate-500"
          >
            {{ t('aiRideGrid.contextWeather', { n: detailContext.weather.length }) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
