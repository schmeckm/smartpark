<script setup lang="ts">
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MLSignalSourcePicker from '@/components/ml/MLSignalSourcePicker.vue'
import {
  getAiStudioCatalog,
  getAiStudioDatasetStats,
  getAiStudioFeatureDraft,
  getAiStudioModel,
  getMdmRides,
  getPlatformAssets,
  listAiStudioModels,
  patchAiStudioModelActivate,
  postAiStudioPredict,
  postAiStudioTrain,
  putAiStudioFeatureDraft,
  type AiStudioCatalog,
  type AiStudioDatasetStats,
  type AiStudioFeatureDraft,
  type AiStudioModelRow,
} from '@/api/client'
import type { MdmRideMaster } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { formatDateTime } = useRegionalDateTime()
const { surfaces: ui } = usePageSurfaces()

const canTrain = computed(() => auth.hasPermission('ai', 'refresh'))

type TabId =
  | 'overview'
  | 'datasets'
  | 'training'
  | 'importance'
  | 'registry'
  | 'predictions'

const tabs: { id: TabId; labelKey: string }[] = [
  { id: 'overview', labelKey: 'aiStudio.tabOverview' },
  { id: 'datasets', labelKey: 'aiStudio.tabDatasets' },
  { id: 'training', labelKey: 'aiStudio.tabTraining' },
  { id: 'importance', labelKey: 'aiStudio.tabImportance' },
  { id: 'registry', labelKey: 'aiStudio.tabRegistry' },
  { id: 'predictions', labelKey: 'aiStudio.tabPredictions' },
]

const activeTab = ref<TabId>('overview')
const catalog = shallowRef<AiStudioCatalog | null>(null)
const catalogLoading = ref(false)

const models = ref<AiStudioModelRow[]>([])
const modelsLoading = ref(false)
const detailModel = shallowRef<AiStudioModelRow | null>(null)
const detailLoading = ref(false)

const datasetStats = shallowRef<AiStudioDatasetStats | null>(null)
const datasetLoading = ref(false)

/** Same 30-day window as dataset-stats park snapshot count → Feature Data Quality park rows. */
const parkSnapshotsInspectLink = computed(() => {
  if (!parkCtx.activeParkId) return null
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    name: 'ai-feature-data-quality',
    query: { from: from.toISOString(), to: to.toISOString() },
    hash: '#park-snapshots',
  }
})

const DEFAULT_FEATURE_STORE_FEATURES = [
  'weather',
  'holiday',
  'school_break',
  'time_of_day',
  'day_of_week',
  'staffing',
  'capacity',
  'historical_demand',
] as const

const trainEntityType = ref('RIDE')
const trainTarget = ref('wait_time_minutes')
const trainEntityMode = ref<'all' | 'one'>('all')
const trainEntityId = ref<string | null>(null)
const studioDataset = ref<'SANDBOX' | 'FEATURE_STORE'>('SANDBOX')
const trainFeatures = ref<string[]>([
  'weather',
  'historical_demand',
  'time_of_day',
  'day_of_week',
  'capacity',
])
const trainStrategy = ref<'AUTO' | 'MANUAL'>('AUTO')
const trainAlgorithm = ref('gradient_boosting')
const trainSubmitting = ref(false)

const predictEntityType = ref('RIDE')
const predictTarget = ref('wait_time_minutes')
const predictEntityId = ref<string | null>(null)
const predictFeatures = ref<Record<string, number>>({
  weather: 0.55,
  traffic: 0.42,
  holiday: 0,
  school_break: 0,
  time_of_day: 14,
  day_of_week: 4,
  staffing: 0.75,
  capacity: 120,
  historical_demand: 28,
  neighbor_wait_times: 22,
})
const predictResult = ref<unknown>(null)
const predictLoading = ref(false)
const predictUseLatestSnapshot = ref(false)

const assets = ref<Array<Record<string, unknown>>>([])
const assetsLoading = ref(false)

/** Phase O/P — ML Studio extension signal candidates + persisted feature draft. */
const ML_FEATURE_DATASET_SCOPE = 'single_asset' as const
const mdmRidesForMl = ref<MdmRideMaster[]>([])
const mdmRidesForMlLoading = ref(false)
const mlExtKind = ref<'ride' | 'park_asset'>('park_asset')
const mlExtRideId = ref<string | null>(null)
const mlDraftSignalKeys = ref<string[]>([])
const mlPersistedDraft = shallowRef<AiStudioFeatureDraft | null>(null)
const mlDraftLoadBusy = ref(false)
const mlDraftSaveBusy = ref(false)
const predictAssets = ref<Array<Record<string, unknown>>>([])
const predictAssetsLoading = ref(false)

const metricChartRef = ref<HTMLDivElement | null>(null)
const fiChartRef = ref<HTMLDivElement | null>(null)
const paChartRef = ref<HTMLDivElement | null>(null)
let metricChart: echarts.ECharts | null = null
let fiChart: echarts.ECharts | null = null
let paChart: echarts.ECharts | null = null
let metricRo: ResizeObserver | null = null
let fiRo: ResizeObserver | null = null
let paRo: ResizeObserver | null = null

function disposeCharts() {
  metricRo?.disconnect()
  fiRo?.disconnect()
  paRo?.disconnect()
  metricRo = fiRo = paRo = null
  metricChart?.dispose()
  fiChart?.dispose()
  paChart?.dispose()
  metricChart = fiChart = paChart = null
}

const targetsForEntity = computed(() => {
  const et = catalog.value?.entityTypes.find((x) => x.code === trainEntityType.value)
  return et?.targets ?? []
})

const targetsForPredict = computed(() => {
  const et = catalog.value?.entityTypes.find((x) => x.code === predictEntityType.value)
  return et?.targets ?? []
})

const predictFeatureKeys = computed(() => Object.keys(predictFeatures.value))

const assetTypeForTrain = computed(() => {
  const et = catalog.value?.entityTypes.find((x) => x.code === trainEntityType.value)
  return et?.assetTypeCode
})

const assetTypeForPredict = computed(() => {
  const et = catalog.value?.entityTypes.find((x) => x.code === predictEntityType.value)
  return et?.assetTypeCode
})

const catalogFeaturesForTraining = computed(() => {
  const all = catalog.value?.features ?? []
  if (studioDataset.value !== 'FEATURE_STORE') return all
  const allow = new Set(catalog.value?.featureStoreTrainFeatures ?? [...DEFAULT_FEATURE_STORE_FEATURES])
  return all.filter((f) => allow.has(f.code))
})

function modelTrainingKind(m: AiStudioModelRow | null): 'real' | 'stub' | 'unknown' {
  if (!m?.modelPayload || typeof m.modelPayload !== 'object') return 'unknown'
  const stub = (m.modelPayload as { stub?: boolean }).stub
  return stub === false ? 'real' : 'stub'
}

function formatTrainingMeta(m: AiStudioModelRow | null): string {
  if (!m?.datasetSnapshotJson || typeof m.datasetSnapshotJson !== 'object') return ''
  const j = m.datasetSnapshotJson as Record<string, unknown>
  const ds = j.dataset
  const rows = j.trainingRowsUsed ?? j.completeRowsTotal
  const from = j.trainDateFrom ?? j.labelDateFrom
  const to = j.trainDateTo ?? j.labelDateTo
  const bits: string[] = []
  if (ds) bits.push(String(ds))
  if (rows != null) bits.push(`rows: ${rows}`)
  if (from && to) bits.push(`${String(from).slice(0, 10)}…${String(to).slice(0, 10)}`)
  return bits.join(' · ')
}

/** Platform assets may expose `assetId` (camelCase) or `asset_id` (raw JSON). */
function assetRowId(a: Record<string, unknown>): string {
  const v = a.assetId ?? a.asset_id
  return v != null && String(v).trim() !== '' ? String(v).trim() : ''
}

watch(trainEntityType, () => {
  trainEntityId.value = null
  if (trainEntityType.value !== 'RIDE' && studioDataset.value === 'FEATURE_STORE') {
    studioDataset.value = 'SANDBOX'
  }
  const ts = targetsForEntity.value
  if (ts.length && !ts.includes(trainTarget.value)) trainTarget.value = ts[0] ?? 'wait_time_minutes'
})

watch(studioDataset, (d) => {
  if (d === 'FEATURE_STORE') {
    trainEntityMode.value = 'one'
    trainEntityType.value = 'RIDE'
    trainTarget.value = 'wait_time_plus_15'
    trainStrategy.value = 'MANUAL'
    trainAlgorithm.value = 'linear_regression'
    trainFeatures.value = [...DEFAULT_FEATURE_STORE_FEATURES]
  }
})

watch(trainEntityMode, (mode) => {
  if (mode === 'all') trainEntityId.value = null
})

watch(predictEntityType, async () => {
  predictEntityId.value = null
  const ts = targetsForPredict.value
  if (ts.length && !ts.includes(predictTarget.value)) predictTarget.value = ts[0] ?? 'wait_time_minutes'
  await loadAssetsForPredict()
})

async function loadCatalog() {
  catalogLoading.value = true
  try {
    catalog.value = await getAiStudioCatalog()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Catalog failed', 'error')
    catalog.value = null
  } finally {
    catalogLoading.value = false
  }
}

async function loadModels() {
  if (!parkCtx.activeParkId) {
    models.value = []
    return
  }
  modelsLoading.value = true
  try {
    models.value = await listAiStudioModels({ limit: 300 })
    if (models.value.length && !detailModel.value) {
      await selectModelDetail(models.value[0].id)
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Models failed', 'error')
    models.value = []
  } finally {
    modelsLoading.value = false
  }
}

async function selectModelDetail(id: string) {
  if (!parkCtx.activeParkId) return
  if (!id) {
    detailModel.value = null
    return
  }
  detailLoading.value = true
  try {
    detailModel.value = await getAiStudioModel(id)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Model load failed', 'error')
    detailModel.value = null
  } finally {
    detailLoading.value = false
  }
}

async function loadDatasetStats() {
  if (!parkCtx.activeParkId) return
  datasetLoading.value = true
  try {
    const fsPreview =
      studioDataset.value === 'FEATURE_STORE' &&
      trainEntityType.value === 'RIDE' &&
      trainEntityMode.value === 'one' &&
      trainEntityId.value
    datasetStats.value = await getAiStudioDatasetStats({
      entityType: trainEntityType.value,
      entityId: trainEntityMode.value === 'one' ? trainEntityId.value : null,
      dataset: fsPreview ? 'FEATURE_STORE' : undefined,
    })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Dataset stats failed', 'error')
    datasetStats.value = null
  } finally {
    datasetLoading.value = false
  }
}

async function loadMdmRidesForMl() {
  const pid = parkCtx.activeParkId
  if (!pid) {
    mdmRidesForMl.value = []
    return
  }
  mdmRidesForMlLoading.value = true
  try {
    mdmRidesForMl.value = await getMdmRides({ parkId: pid, activeFlag: true })
  } catch {
    mdmRidesForMl.value = []
  } finally {
    mdmRidesForMlLoading.value = false
    const ok = new Set(mdmRidesForMl.value.map((r) => r.id))
    if (mlExtRideId.value && !ok.has(mlExtRideId.value)) mlExtRideId.value = null
  }
}

async function loadAssetsForTrain() {
  const pid = parkCtx.activeParkId
  const code = assetTypeForTrain.value
  if (!pid || !code || trainEntityType.value === 'WHOLE_PARK') {
    assets.value = []
    return
  }
  assetsLoading.value = true
  try {
    assets.value = (await getPlatformAssets({
      parkId: pid,
      assetTypeCode: code,
      limit: 500,
    })) as Array<Record<string, unknown>>
  } catch {
    assets.value = []
  } finally {
    assetsLoading.value = false
    const ok = new Set(assets.value.map((row) => assetRowId(row)).filter(Boolean))
    if (trainEntityId.value && !ok.has(trainEntityId.value)) trainEntityId.value = null
  }
}

async function loadAssetsForPredict() {
  const pid = parkCtx.activeParkId
  const code = assetTypeForPredict.value
  if (!pid || !code || predictEntityType.value === 'WHOLE_PARK') {
    predictAssets.value = []
    return
  }
  predictAssetsLoading.value = true
  try {
    predictAssets.value = (await getPlatformAssets({
      parkId: pid,
      assetTypeCode: code,
      limit: 500,
    })) as Array<Record<string, unknown>>
  } catch {
    predictAssets.value = []
  } finally {
    predictAssetsLoading.value = false
    const ok = new Set(predictAssets.value.map((row) => assetRowId(row)).filter(Boolean))
    if (predictEntityId.value && !ok.has(predictEntityId.value)) predictEntityId.value = null
  }
}

async function submitTrain() {
  if (!parkCtx.activeParkId || !canTrain.value) return
  if (
    trainEntityType.value !== 'WHOLE_PARK' &&
    trainEntityMode.value === 'one' &&
    !trainEntityId.value
  ) {
    push(t('aiStudio.needAsset'), 'error')
    return
  }
  if (studioDataset.value === 'FEATURE_STORE') {
    if (trainEntityType.value !== 'RIDE' || trainEntityMode.value !== 'one' || !trainEntityId.value) {
      push(t('aiStudio.needAsset'), 'error')
      return
    }
    if (trainTarget.value !== 'wait_time_plus_15') {
      push('FEATURE_STORE requires target wait_time_plus_15', 'error')
      return
    }
  }
  trainSubmitting.value = true
  try {
    const body = {
      entityType: trainEntityType.value,
      entityId:
        trainEntityType.value === 'WHOLE_PARK'
          ? null
          : trainEntityMode.value === 'one'
            ? trainEntityId.value
            : null,
      targetVariable: trainTarget.value,
      features: trainFeatures.value,
      strategy: trainStrategy.value,
      algorithm: trainStrategy.value === 'MANUAL' ? trainAlgorithm.value : null,
      dataset: studioDataset.value,
      ...(studioDataset.value === 'FEATURE_STORE' ? { horizonMinutes: 15 } : {}),
    }
    await postAiStudioTrain(body)
    push(t('aiStudio.trainOk'), 'success')
    await loadModels()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Train failed', 'error')
  } finally {
    trainSubmitting.value = false
  }
}

async function activateRow(row: AiStudioModelRow, on: boolean) {
  if (!canTrain.value) return
  try {
    await patchAiStudioModelActivate(row.id, on)
    push(on ? t('aiStudio.activated') : t('aiStudio.deactivated'), 'success')
    await loadModels()
    if (detailModel.value?.id === row.id) await selectModelDetail(row.id)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Activate failed', 'error')
  }
}

async function runPredict() {
  if (!parkCtx.activeParkId) return
  if (predictUseLatestSnapshot.value && predictEntityType.value === 'RIDE' && !predictEntityId.value) {
    push(t('aiStudio.predictPickAsset'), 'error')
    return
  }
  predictLoading.value = true
  try {
    const rawId = predictEntityId.value ? String(predictEntityId.value).trim() : ''
    predictResult.value = await postAiStudioPredict({
      entityType: predictEntityType.value,
      entityId: rawId || null,
      targetVariable: predictTarget.value,
      features: predictUseLatestSnapshot.value ? {} : predictFeatures.value,
      featureSource: predictUseLatestSnapshot.value ? 'latest_snapshot' : 'manual',
    })
  } catch (e) {
    predictResult.value = null
    push(e instanceof Error ? e.message : 'Predict failed', 'error')
  } finally {
    predictLoading.value = false
  }
}

function metricOption(m: AiStudioModelRow): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: ['MAE', 'RMSE', 'R²'] },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#334155' } } },
    series: [
      {
        type: 'bar',
        data: [m.mae ?? 0, m.rmse ?? 0, m.r2 ?? 0],
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#6366f1' },
            { offset: 1, color: '#4f46e5' },
          ]),
        },
      },
    ],
  }
}

function fiOption(fi: Record<string, number>): EChartsOption {
  const entries = Object.entries(fi).sort((a, b) => b[1] - a[1])
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: '#334155' } } },
    yAxis: { type: 'category', data: entries.map(([k]) => k) },
    series: [
      {
        type: 'bar',
        data: entries.map(([, v]) => v),
        itemStyle: { color: '#22d3ee' },
      },
    ],
  }
}

function paOption(points: Array<{ i: number; actual: number; predicted: number }>): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: '#94a3b8' },
    legend: { textStyle: { color: '#94a3b8' }, data: ['Actual', 'Predicted'] },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: points.map((p) => String(p.i)),
      name: 'Holdout row',
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#334155' } } },
    series: [
      { name: 'Actual', type: 'line', smooth: true, data: points.map((p) => p.actual) },
      { name: 'Predicted', type: 'line', smooth: true, data: points.map((p) => p.predicted) },
    ],
  }
}

async function refreshCharts() {
  await nextTick()
  const m = detailModel.value
  if (!m) return

  if (activeTab.value === 'training') {
    const el = metricChartRef.value
    if (el) {
      if (!metricChart) {
        metricChart = echarts.init(el, undefined, { renderer: 'canvas' })
        metricRo = new ResizeObserver(() => metricChart?.resize())
        metricRo.observe(el)
      }
      metricChart.setOption(metricOption(m), { notMerge: true })
    }
  }

  if (activeTab.value === 'importance') {
    const el = fiChartRef.value
    const fi = m.featureImportanceJson || {}
    if (el && Object.keys(fi).length) {
      if (!fiChart) {
        fiChart = echarts.init(el, undefined, { renderer: 'canvas' })
        fiRo = new ResizeObserver(() => fiChart?.resize())
        fiRo.observe(el)
      }
      fiChart.setOption(fiOption(fi), { notMerge: true })
    }
  }

  if (activeTab.value === 'training') {
    const el = paChartRef.value
    const pts = m.evalHoldoutJson?.points || []
    if (el && pts.length) {
      if (!paChart) {
        paChart = echarts.init(el, undefined, { renderer: 'canvas' })
        paRo = new ResizeObserver(() => paChart?.resize())
        paRo.observe(el)
      }
      paChart.setOption(paOption(pts), { notMerge: true })
    }
  }
}

watch(
  () => [activeTab.value, detailModel.value?.id, detailLoading.value] as const,
  async () => {
    if (detailLoading.value || !detailModel.value) return
    await refreshCharts()
  },
  { flush: 'post' }
)

watch(
  () => parkCtx.activeParkId,
  async () => {
    await loadModels()
    await loadAssetsForTrain()
    await loadAssetsForPredict()
    await loadMdmRidesForMl()
  }
)

watch(activeTab, (tab) => {
  if (tab === 'predictions') void loadAssetsForPredict()
  if (tab === 'datasets') void loadMdmRidesForMl()
})

watch(
  () => [trainEntityType.value, trainEntityMode.value, trainEntityId.value] as const,
  async () => {
    await loadAssetsForTrain()
  }
)

const mlPickerEntityId = computed(() => {
  if (mlExtKind.value === 'ride') return mlExtRideId.value?.trim() || ''
  if (trainEntityMode.value === 'one' && trainEntityId.value) return String(trainEntityId.value).trim()
  return ''
})

async function loadMlFeatureDraft() {
  const id = mlPickerEntityId.value
  const et = mlExtKind.value
  if (!parkCtx.activeParkId || !id) {
    mlPersistedDraft.value = null
    mlDraftSignalKeys.value = []
    return
  }
  mlDraftLoadBusy.value = true
  try {
    const d = await getAiStudioFeatureDraft({
      entityType: et,
      entityId: id,
      datasetScope: ML_FEATURE_DATASET_SCOPE,
    })
    mlPersistedDraft.value = d
    mlDraftSignalKeys.value = d?.selectedSignalKeys?.length ? [...d.selectedSignalKeys] : []
  } catch {
    mlPersistedDraft.value = null
    mlDraftSignalKeys.value = []
  } finally {
    mlDraftLoadBusy.value = false
  }
}

async function saveMlFeatureDraft() {
  if (!canTrain.value || !parkCtx.activeParkId || !mlPickerEntityId.value) return
  mlDraftSaveBusy.value = true
  try {
    const d = await putAiStudioFeatureDraft({
      entityType: mlExtKind.value,
      entityId: mlPickerEntityId.value,
      datasetScope: ML_FEATURE_DATASET_SCOPE,
      selectedSignalKeys: [...mlDraftSignalKeys.value],
    })
    mlPersistedDraft.value = d
    push(t('aiStudio.mlFeatureDraftSaved'), 'success')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    mlDraftSaveBusy.value = false
  }
}

watch(
  () => [mlExtKind.value, mlPickerEntityId.value, parkCtx.activeParkId] as const,
  () => void loadMlFeatureDraft(),
  { flush: 'post' }
)

onMounted(async () => {
  await loadCatalog()
  await loadModels()
  await loadAssetsForTrain()
  await loadAssetsForPredict()
  await loadMdmRidesForMl()
})

onBeforeUnmount(() => disposeCharts())

function toggleFeature(code: string) {
  const fsAllow = DEFAULT_FEATURE_STORE_FEATURES as readonly string[]
  if (studioDataset.value === 'FEATURE_STORE' && !fsAllow.includes(code)) {
    return
  }
  const i = trainFeatures.value.indexOf(code)
  if (i >= 0) trainFeatures.value = trainFeatures.value.filter((c) => c !== code)
  else trainFeatures.value = [...trainFeatures.value, code]
}

function setPredictFeature(key: string, raw: string) {
  const n = Number(raw)
  predictFeatures.value = { ...predictFeatures.value, [key]: Number.isFinite(n) ? n : 0 }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">{{
          t('aiMl.back')
        }}</RouterLink>
        <h1 class="mt-2 font-display text-2xl font-semibold text-white">{{ t('aiStudio.title') }}</h1>
        <p :class="ui.subtitle">{{ t('aiStudio.subtitle') }}</p>
      </div>
      <div v-if="!parkCtx.activeParkId" class="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
        {{ t('aiMl.needPark') }}
      </div>
    </div>

    <div class="mt-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
      <button
        v-for="tb in tabs"
        :key="tb.id"
        type="button"
        class="rounded-lg px-3 py-1.5 text-sm transition"
        :class="
          activeTab === tb.id
            ? 'bg-brand-600 text-white'
            : 'border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
        "
        @click="activeTab = tb.id"
      >
        {{ t(tb.labelKey) }}
      </button>
    </div>

    <div class="mt-6 space-y-6">
      <section v-show="activeTab === 'overview'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.overviewTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.overviewBody') }}</p>
        <div v-if="catalogLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <ul v-else class="mt-4 list-inside list-disc space-y-2 text-sm text-slate-300">
          <li v-for="h in catalog?.hierarchy || []" :key="h.scope">
            <span class="font-mono text-brand-300">{{ h.scope }}</span>
            — {{ h.description }}
          </li>
        </ul>
        <p class="mt-4 text-xs text-slate-500">
          {{ t('aiStudio.predictionOrder') }}:
          <span class="font-mono text-slate-400">{{ (catalog?.predictionOrder || []).join(' → ') }}</span>
        </p>
        <div v-if="detailModel && !detailLoading" class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.colTrainingKind') }}</div>
            <div :class="ui.statValue">
              {{
                modelTrainingKind(detailModel) === 'real'
                  ? t('aiStudio.trainingKindReal')
                  : modelTrainingKind(detailModel) === 'stub'
                    ? t('aiStudio.trainingKindStub')
                    : '—'
              }}
            </div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">MAE</div>
            <div :class="ui.statValue">{{ detailModel.mae ?? '—' }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">RMSE</div>
            <div :class="ui.statValue">{{ detailModel.rmse ?? '—' }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">R²</div>
            <div :class="ui.statValue">{{ detailModel.r2 ?? '—' }}</div>
          </div>
          <div v-if="formatTrainingMeta(detailModel)" class="sm:col-span-3 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
            {{ formatTrainingMeta(detailModel) }}
          </div>
        </div>
        <label v-if="models.length" class="mt-4 block">
          <span class="text-xs text-slate-500">{{ t('aiStudio.modelPick') }}</span>
          <select
            :class="[ui.control, 'mt-1 max-w-xl']"
            :value="detailModel?.id || ''"
            @change="selectModelDetail(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('aiStudio.chooseModel') }}</option>
            <option v-for="m in models" :key="m.id" :value="m.id">
              {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }} v{{ m.version }}
            </option>
          </select>
        </label>
        <p v-else-if="parkCtx.activeParkId" class="mt-4 text-sm text-slate-500">{{ t('aiStudio.pickModelHint') }}</p>
      </section>

      <section v-show="activeTab === 'datasets'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.datasetsTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.datasetsHint') }}</p>
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label class="block text-xs text-slate-500">{{ t('aiStudio.datasetSource') }}</label>
          <select v-model="studioDataset" :class="[ui.control, 'max-w-xs']">
            <option value="SANDBOX">{{ t('aiStudio.datasetSandbox') }}</option>
            <option value="FEATURE_STORE">{{ t('aiStudio.datasetFeatureStore') }}</option>
          </select>
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <label class="block text-xs text-slate-500">{{ t('aiStudio.entityType') }}</label>
          <select v-model="trainEntityType" :class="[ui.control, 'max-w-xs']">
            <option v-for="et in catalog?.entityTypes || []" :key="et.code" :value="et.code">{{ et.code }}</option>
          </select>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="trainEntityMode" type="radio" value="all" class="accent-brand-500" />
            {{ t('aiStudio.allEntities') }}
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="trainEntityMode" type="radio" value="one" class="accent-brand-500" />
            {{ t('aiStudio.oneEntity') }}
          </label>
          <select
            v-if="trainEntityMode === 'one' && assetTypeForTrain"
            v-model="trainEntityId"
            :class="[ui.control, 'max-w-md']"
          >
            <option :value="null">{{ t('aiStudio.chooseAsset') }}</option>
            <option
              v-for="(a, idx) in assets"
              :key="assetRowId(a) || `asset-${idx}`"
              :value="assetRowId(a)"
            >
              {{ String(a.name || a.short_name || a.shortName || assetRowId(a)) }}
            </option>
          </select>
          <button
            type="button"
            class="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            :disabled="!parkCtx.activeParkId || datasetLoading"
            @click="loadDatasetStats"
          >
            {{ t('aiStudio.refreshStats') }}
          </button>
        </div>

        <div
          v-if="parkCtx.activeParkId"
          class="mt-8 rounded-lg border border-slate-700 bg-slate-950/35 p-4"
          data-testid="ai-studio-ml-signal-picker-section"
        >
          <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.mlSignalPickerSectionTitle') }}</h3>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.mlSignalPickerSectionHint') }}</p>
          <div class="mt-3 flex flex-wrap gap-4">
            <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input v-model="mlExtKind" type="radio" value="park_asset" class="accent-brand-500" />
              {{ t('aiStudio.mlSignalPickerScopeAsset') }}
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input v-model="mlExtKind" type="radio" value="ride" class="accent-brand-500" />
              {{ t('aiStudio.mlSignalPickerScopeRide') }}
            </label>
          </div>
          <p v-if="mlExtKind === 'park_asset'" class="mt-2 text-xs text-slate-500">
            {{ t('aiStudio.mlSignalPickerAssetScopeHint') }}
          </p>
          <div v-if="mlExtKind === 'ride'" class="mt-3 max-w-xl">
            <label class="block text-xs text-slate-500">{{ t('aiStudio.mlSignalPickerChooseRide') }}</label>
            <select
              v-model="mlExtRideId"
              :disabled="mdmRidesForMlLoading"
              :class="[ui.control, 'mt-1 w-full']"
            >
              <option :value="null">{{ t('aiStudio.mlSignalPickerRidePlaceholder') }}</option>
              <option v-for="r in mdmRidesForMl" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
          <p
            v-if="mlExtKind === 'park_asset' && (trainEntityMode !== 'one' || !trainEntityId)"
            class="mt-3 rounded border border-amber-900/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/90"
          >
            {{ t('aiStudio.mlSignalPickerNeedSpecificAsset') }}
          </p>
          <div v-else-if="mlPickerEntityId" class="mt-4 max-w-3xl space-y-3">
            <p v-if="mlDraftLoadBusy" class="text-xs text-slate-500">{{ t('aiStudio.mlFeatureDraftLoading') }}</p>
            <MLSignalSourcePicker
              :key="`${mlExtKind}-${mlPickerEntityId}`"
              :entity-type="mlExtKind"
              :entity-id="mlPickerEntityId"
              v-model="mlDraftSignalKeys"
            />
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                :disabled="!canTrain || mlDraftSaveBusy || mlDraftLoadBusy"
                data-testid="ai-studio-ml-feature-draft-save"
                @click="saveMlFeatureDraft"
              >
                {{ t('aiStudio.mlFeatureDraftSave') }}
              </button>
              <span v-if="!canTrain" class="text-xs text-slate-500">{{ t('aiStudio.mlFeatureDraftSaveNeedRefresh') }}</span>
            </div>
            <div
              class="rounded-md border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs text-slate-400"
              data-testid="ai-studio-ml-feature-draft-saved"
            >
              <p class="font-medium text-slate-300">{{ t('aiStudio.mlFeatureDraftSavedLabel') }}</p>
              <p v-if="!mlPersistedDraft" class="mt-1">{{ t('aiStudio.mlFeatureDraftNone') }}</p>
              <template v-else>
                <p class="mt-1 font-mono text-[11px] text-slate-300">{{ mlPersistedDraft.selectedSignalKeys.join(', ') || '—' }}</p>
                <p v-if="mlPersistedDraft.updatedAt" class="mt-1 text-[11px] text-slate-500">
                  {{ t('aiStudio.mlFeatureDraftUpdatedAt') }} {{ formatDateTime(mlPersistedDraft.updatedAt) }}
                </p>
              </template>
            </div>
          </div>
        </div>

        <div v-if="datasetLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <div v-else-if="datasetStats" class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.rowCount') }}</div>
            <div :class="ui.statValue">{{ datasetStats.rowCount }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.missingRate') }}</div>
            <div :class="ui.statValue">{{ (datasetStats.missingRate * 100).toFixed(1) }}%</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.seasonality') }}</div>
            <div :class="ui.statValue">{{ datasetStats.seasonalityScore.toFixed(2) }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.volatility') }}</div>
            <div :class="ui.statValue">{{ datasetStats.volatilityScore.toFixed(2) }}</div>
          </div>
          <div :class="ui.infoBox">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div :class="ui.statLabel">{{ t('aiStudio.parkSnapshots') }}</div>
              <RouterLink
                v-if="parkSnapshotsInspectLink"
                :to="parkSnapshotsInspectLink"
                class="text-xs font-medium text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
              >
                {{ t('aiStudio.viewParkSnapshotRows') }}
              </RouterLink>
            </div>
            <div :class="ui.statValue">{{ datasetStats.parkSnapshotCount }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.entitySamples') }}</div>
            <div :class="ui.statValue">{{ datasetStats.entitySampleCount }}</div>
          </div>
        </div>
        <div
          v-if="datasetStats?.featureStorePreview && studioDataset === 'FEATURE_STORE'"
          class="mt-6 rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300"
        >
          <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {{ t('aiStudio.featureStorePreviewTitle') }}
          </h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.snapshotBuckets') }}</div>
              <div class="font-mono text-slate-200">{{ datasetStats.featureStorePreview.snapshotBucketRows }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.labeledHorizonRows') }}</div>
              <div class="font-mono text-slate-200">{{ datasetStats.featureStorePreview.labeledHorizonRows }}</div>
            </div>
            <div class="sm:col-span-2">
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.fsDateRange') }}</div>
              <div class="text-[11px] text-slate-200">
                {{
                  datasetStats.featureStorePreview.dateFrom
                    ? formatDateTime(datasetStats.featureStorePreview.dateFrom)
                    : '—'
                }}
                →
                {{
                  datasetStats.featureStorePreview.dateTo
                    ? formatDateTime(datasetStats.featureStorePreview.dateTo)
                    : '—'
                }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'training'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.trainingTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.trainingHint') }}</p>

        <div class="mt-4 flex flex-wrap items-end gap-3">
          <label :class="ui.label">{{ t('aiStudio.datasetSource') }}</label>
          <select v-model="studioDataset" :class="[ui.control, 'max-w-md']">
            <option value="SANDBOX">{{ t('aiStudio.datasetSandbox') }}</option>
            <option value="FEATURE_STORE">{{ t('aiStudio.datasetFeatureStore') }}</option>
          </select>
        </div>
        <p v-if="studioDataset === 'FEATURE_STORE'" class="mt-2 text-xs text-amber-200/90">
          {{ t('aiStudio.horizon15Note') }}
          {{ t('aiStudio.featureStoreFeaturesHint') }}
        </p>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label :class="ui.label">{{ t('aiStudio.entityType') }}</label>
            <select v-model="trainEntityType" :class="ui.control">
              <option v-for="et in catalog?.entityTypes || []" :key="et.code" :value="et.code">{{ et.code }}</option>
            </select>
            <label :class="ui.label">{{ t('aiStudio.targetY') }}</label>
            <select v-model="trainTarget" :class="ui.control">
              <option v-for="tg in targetsForEntity" :key="tg" :value="tg">{{ tg }}</option>
            </select>
            <label :class="ui.label">{{ t('aiStudio.scope') }}</label>
            <div class="flex flex-wrap gap-4">
              <label :class="ui.choice">
                <input
                  v-model="trainEntityMode"
                  type="radio"
                  value="all"
                  class="accent-brand-500"
                  :disabled="studioDataset === 'FEATURE_STORE'"
                />
                {{ t('aiStudio.categoryScope') }}
              </label>
              <label :class="ui.choice">
                <input v-model="trainEntityMode" type="radio" value="one" class="accent-brand-500" />
                {{ t('aiStudio.entityScope') }}
              </label>
            </div>
            <select
              v-if="trainEntityMode === 'one' && assetTypeForTrain"
              v-model="trainEntityId"
              :class="ui.control"
            >
              <option :value="null">{{ t('aiStudio.chooseAsset') }}</option>
              <option
                v-for="(a, idx) in assets"
                :key="assetRowId(a) || `asset-${idx}`"
                :value="assetRowId(a)"
              >
                {{ String(a.name || a.short_name || a.shortName || assetRowId(a)) }}
              </option>
            </select>
          </div>
          <div>
            <label :class="ui.label">{{ t('aiStudio.strategy') }}</label>
            <div class="flex gap-4">
              <label :class="ui.choice">
                <input
                  v-model="trainStrategy"
                  type="radio"
                  value="AUTO"
                  class="accent-brand-500"
                  :disabled="studioDataset === 'FEATURE_STORE'"
                />
                Auto
              </label>
              <label :class="ui.choice">
                <input
                  v-model="trainStrategy"
                  type="radio"
                  value="MANUAL"
                  class="accent-brand-500"
                  :disabled="studioDataset === 'FEATURE_STORE'"
                />
                Manual
              </label>
            </div>
            <label v-if="trainStrategy === 'MANUAL' || studioDataset === 'FEATURE_STORE'" :class="ui.label">{{
              t('aiStudio.algorithm')
            }}</label>
            <select
              v-if="trainStrategy === 'MANUAL' || studioDataset === 'FEATURE_STORE'"
              v-model="trainAlgorithm"
              :class="ui.control"
              :disabled="studioDataset === 'FEATURE_STORE'"
            >
              <option v-for="alg in catalog?.manualAlgorithms || []" :key="alg.code" :value="alg.code">
                {{ alg.label }}
              </option>
            </select>
            <label :class="ui.label">{{ t('aiStudio.featuresX') }}</label>
            <div class="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded border border-slate-800 p-2">
              <label
                v-for="f in catalogFeaturesForTraining"
                :key="f.code"
                class="flex cursor-pointer items-center gap-1 rounded bg-slate-950 px-2 py-1 text-xs text-slate-300"
              >
                <input
                  type="checkbox"
                  class="accent-brand-500"
                  :checked="trainFeatures.includes(f.code)"
                  @change="toggleFeature(f.code)"
                />
                {{ f.code }}
              </label>
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!parkCtx.activeParkId || !canTrain || trainSubmitting || trainFeatures.length === 0"
            @click="submitTrain"
          >
            {{ trainSubmitting ? t('aiStudio.training') : t('aiStudio.runTrain') }}
          </button>
          <span v-if="!canTrain" class="text-xs text-slate-500">{{ t('aiStudio.needRefresh') }}</span>
        </div>

        <label class="mt-6 block">
          <span class="text-xs text-slate-500">{{ t('aiStudio.modelPick') }}</span>
          <select
            :class="[ui.control, 'mt-1 max-w-xl']"
            :value="detailModel?.id || ''"
            @change="selectModelDetail(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('aiStudio.chooseModel') }}</option>
            <option v-for="m in models" :key="m.id" :value="m.id">
              {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }} v{{ m.version }}
            </option>
          </select>
        </label>
        <div v-if="detailModel && !detailLoading" class="mt-8 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.metricsChart') }}</h3>
            <div ref="metricChartRef" class="mt-2 h-56 w-full min-w-0" />
          </div>
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.predVsActual') }}</h3>
            <div ref="paChartRef" class="mt-2 h-56 w-full min-w-0" />
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'importance'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.importanceTitle') }}</h2>
        <label :class="ui.label">{{ t('aiStudio.modelPick') }}</label>
        <select
          :class="[ui.control, 'max-w-xl']"
          :value="detailModel?.id || ''"
          @change="selectModelDetail(($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('aiStudio.chooseModel') }}</option>
          <option v-for="m in models" :key="m.id" :value="m.id">
            {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }} v{{ m.version }}
            {{ m.activeFlag ? '★' : '' }}
          </option>
        </select>
        <div v-if="detailLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <div ref="fiChartRef" class="mt-6 h-80 w-full min-w-0" />
      </section>

      <section v-show="activeTab === 'registry'" :class="ui.card">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 :class="ui.h2">{{ t('aiStudio.registryTitle') }}</h2>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            :disabled="modelsLoading || !parkCtx.activeParkId"
            @click="loadModels"
          >
            {{ t('btn.refresh') }}
          </button>
        </div>
        <div v-if="modelsLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <div v-else class="mt-4 overflow-x-auto">
          <table class="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr :class="ui.tableHead">
                <th class="py-2 pr-3">{{ t('aiStudio.colVersion') }}</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colScope') }}</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colEntity') }}</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colTarget') }}</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colAlgo') }}</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colTrainingKind') }}</th>
                <th class="py-2 pr-3">MAE</th>
                <th class="py-2 pr-3">RMSE</th>
                <th class="py-2 pr-3">R²</th>
                <th class="py-2 pr-3">{{ t('aiStudio.colActive') }}</th>
                <th class="py-2">{{ t('aiStudio.colActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in models" :key="row.id" :class="ui.tableRow">
                <td :class="ui.tableCell">v{{ row.version }}</td>
                <td :class="ui.tableCellMuted">{{ row.modelScope }}</td>
                <td :class="ui.tableCellMuted">{{ row.entityType }} {{ row.entityId ? row.entityId.slice(0, 8) + '…' : '*' }}</td>
                <td :class="ui.tableCell">{{ row.targetVariable }}</td>
                <td :class="ui.tableCellMuted">{{ row.algorithm }}</td>
                <td :class="ui.tableCellMuted">
                  {{
                    modelTrainingKind(row) === 'real'
                      ? t('aiStudio.trainingKindReal')
                      : modelTrainingKind(row) === 'stub'
                        ? t('aiStudio.trainingKindStub')
                        : '—'
                  }}
                </td>
                <td :class="ui.tableCell">{{ row.mae ?? '—' }}</td>
                <td :class="ui.tableCell">{{ row.rmse ?? '—' }}</td>
                <td :class="ui.tableCell">{{ row.r2 ?? '—' }}</td>
                <td :class="ui.tableCell">{{ row.activeFlag ? '✓' : '—' }}</td>
                <td :class="ui.tableCell">
                  <button
                    v-if="canTrain"
                    type="button"
                    class="text-brand-400 hover:text-brand-300"
                    @click="activateRow(row, !row.activeFlag)"
                  >
                    {{ row.activeFlag ? t('aiStudio.deactivate') : t('aiStudio.activate') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!models.length && parkCtx.activeParkId" class="mt-4 text-sm text-slate-500">{{ t('aiStudio.emptyRegistry') }}</p>
        </div>
      </section>

      <section v-show="activeTab === 'predictions'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.predictTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.predictHint') }}</p>
        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label :class="ui.label">{{ t('aiStudio.entityType') }}</label>
            <select v-model="predictEntityType" :class="ui.control">
              <option v-for="et in catalog?.entityTypes || []" :key="et.code" :value="et.code">{{ et.code }}</option>
            </select>
            <label :class="ui.label">{{ t('aiStudio.targetY') }}</label>
            <select v-model="predictTarget" :class="ui.control">
              <option v-for="tg in targetsForPredict" :key="tg" :value="tg">{{ tg }}</option>
            </select>
            <label :class="ui.label">{{ t('aiStudio.predictPickAsset') }}</label>
            <p :class="ui.muted">{{ t('aiStudio.predictAssetHint') }}</p>
            <select
              :class="[ui.control, 'mt-1']"
              :value="predictEntityId ?? ''"
              :disabled="predictEntityType === 'WHOLE_PARK' || predictAssetsLoading"
              @change="
                predictEntityId =
                  ($event.target as HTMLSelectElement).value.trim() || null
              "
            >
              <option value="">{{ t('aiStudio.predictNoAsset') }}</option>
              <option
                v-for="(a, idx) in predictAssets"
                :key="assetRowId(a) || `p-${idx}`"
                :value="assetRowId(a)"
              >
                {{ String(a.name || a.short_name || a.shortName || assetRowId(a)) }}
              </option>
            </select>
            <p v-if="predictAssetsLoading" class="mt-1 text-xs text-slate-500">{{ t('aiStudio.loading') }}</p>
            <label v-if="predictEntityType === 'RIDE'" class="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
              <input v-model="predictUseLatestSnapshot" type="checkbox" class="accent-brand-500 mt-0.5" />
              <span>
                {{ t('aiStudio.useLatestSnapshot') }}
                <span class="block text-[11px] font-normal text-slate-500">{{ t('aiStudio.useLatestSnapshotHint') }}</span>
              </span>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <template v-for="key in predictFeatureKeys" :key="key">
              <label class="block text-[11px] uppercase text-slate-500">{{ key }}</label>
              <input
                :model-value="predictFeatures[key]"
                type="number"
                step="any"
                :disabled="predictUseLatestSnapshot"
                :class="[ui.control, predictUseLatestSnapshot ? 'opacity-40' : '']"
                @input="setPredictFeature(key, ($event.target as HTMLInputElement).value)"
              />
            </template>
          </div>
        </div>
        <button
          type="button"
          class="mt-4 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          :disabled="!parkCtx.activeParkId || predictLoading"
          @click="runPredict"
        >
          {{ predictLoading ? '…' : t('aiStudio.runPredict') }}
        </button>
        <pre v-if="predictResult" class="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">{{
          JSON.stringify(predictResult, null, 2)
        }}</pre>
      </section>
    </div>
  </div>
</template>
