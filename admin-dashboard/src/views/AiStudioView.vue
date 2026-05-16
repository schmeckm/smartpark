<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AiStudioFeatureImportanceBarChart from '@/components/ai/AiStudioFeatureImportanceBarChart.vue'
import AiStudioHoldoutLineChart from '@/components/ai/AiStudioHoldoutLineChart.vue'
import AiStudioMetricsBarChart from '@/components/ai/AiStudioMetricsBarChart.vue'
import MLSignalSourcePicker from '@/components/ml/MLSignalSourcePicker.vue'
import {
  getAiStudioBatchTrainStatus,
  getAiStudioCatalog,
  getAiStudioDatasetStats,
  getAiStudioFeatureDraft,
  getAiStudioModel,
  getPlatformAssets,
  listAiStudioModels,
  patchAiStudioModelActivate,
  deleteAiStudioModelArchive,
  deleteAiStudioModelPermanent,
  postAiStudioModelRestore,
  postAiStudioPredict,
  postAiStudioTrain,
  postAiStudioRuntimeResolution,
  postAiStudioBatchTrainRides,
  postAiStudioBatchApply,
  postAiStudioValidateFeatures,
  putAiStudioFeatureDraft,
  type AiStudioBatchTrainStatus,
  type AiStudioBatchTrainResultRow,
  type AiStudioCatalog,
  type AiStudioDatasetStats,
  type AiStudioFeatureDraft,
  type AiStudioModelRow,
  type AiStudioRuntimeResolution,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useInstalledAdaptersStore, PREDICTIVE_MAINTENANCE_ADAPTER_KEY } from '@/stores/installedAdapters'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { ML_TRAINING_FEATURE_NAMES } from '@/constants/mlTrainingFeatureNames'

const { t, tm } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const installedAdapters = useInstalledAdaptersStore()
const { push } = useToast()
const { formatDateTime } = useRegionalDateTime()
const { surfaces: ui } = usePageSurfaces()

const canTrain = computed(() => auth.hasPermission('ai', 'refresh'))
const pdmAdapterInstalled = computed(() => installedAdapters.isInstalled(PREDICTIVE_MAINTENANCE_ADAPTER_KEY))

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
const catalogError = ref<string | null>(null)

const models = ref<AiStudioModelRow[]>([])
const modelsLoading = ref(false)
const modelsError = ref<string | null>(null)
const detailModel = shallowRef<AiStudioModelRow | null>(null)
const detailLoading = ref(false)

const datasetStats = shallowRef<AiStudioDatasetStats | null>(null)
const datasetLoading = ref(false)
const datasetError = ref<string | null>(null)

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

/** % of ride snapshot buckets that have a usable +horizon wait label (FEATURE_STORE preview). */
const featureStoreLabeledPct = computed(() => {
  const p = datasetStats.value?.featureStorePreview
  if (!p || p.snapshotBucketRows <= 0) return null
  return (100 * (p.labeledHorizonRows / p.snapshotBucketRows)).toFixed(1)
})

const mlDataFlowLines = computed((): string[] => {
  const raw = tm('aiStudio.mlDataFlowLines' as never) as unknown
  return Array.isArray(raw) ? raw.map(String) : []
})

/** FEATURE_STORE ride preview was not requested (e.g. category scope or missing asset). */
const showFeatureStorePreviewHint = computed(
  () =>
    studioDataset.value === 'FEATURE_STORE' &&
    trainEntityType.value === 'RIDE' &&
    (!trainEntityId.value || trainEntityMode.value !== 'one') &&
    Boolean(datasetStats.value) &&
    !datasetLoading.value
)

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
const trainingStep = ref<1 | 2 | 3 | 4>(1)

/** FEATURE_STORE manual train only — string fields '' = omit (server defaults). Matches API `featureStoreTrainingOptions`. */
const featureStoreTrainingOptions = ref({
  ridgeLambda: '',
  randomForest: {
    nTrees: '',
    maxDepth: '',
  },
  gradientBoosting: {
    rounds: '',
    treeDepth: '',
    shrinkage: '',
  },
  neuralNetwork: {
    epochs: '',
    lr: '',
  },
})
const lastTrainStatus = ref<'idle' | 'queued' | 'running' | 'done' | 'failed'>('idle')
const lastTrainStatusAt = ref<string | null>(null)
const lastTrainStatusMessage = ref<string>('')

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

const runtimeResolution = shallowRef<AiStudioRuntimeResolution | null>(null)
const runtimeResolutionLoading = ref(false)
const runtimeResolutionError = ref<string | null>(null)
/** Coalesces overlapping runtime-resolution requests (rapid asset changes). */
let runtimeResolutionRequestGen = 0
let runtimeResolutionInFlight = 0

const assets = ref<Array<Record<string, unknown>>>([])
const assetsLoading = ref(false)

/** Phase O/P — ML Studio extension signal candidates + persisted feature draft. */
const ML_FEATURE_DATASET_SCOPE = 'single_asset' as const
const ML_EXT_ENTITY_TYPE = 'park_asset' as const
const mlDraftSignalKeys = ref<string[]>([])
const mlPersistedDraft = shallowRef<AiStudioFeatureDraft | null>(null)
const mlDraftLoadBusy = ref(false)
const mlDraftSaveBusy = ref(false)
const predictAssets = ref<Array<Record<string, unknown>>>([])
const predictAssetsLoading = ref(false)
const compareModelAId = ref<string>('')
const compareModelBId = ref<string>('')
type AuditEvent = {
  at: string
  action: string
  detail: string
}
const auditEvents = ref<AuditEvent[]>([])
const archiveConfirmRow = ref<AiStudioModelRow | null>(null)
const purgeConfirmRow = ref<AiStudioModelRow | null>(null)

const registryBulkSelectMode = ref(false)
const registrySelectedIds = ref<string[]>([])
/** Ride `assetId` → Anzeigename (GET /assets?parkId&assetTypeCode=RIDE) für die Registry-Spalte „Entität“. */
const registryRideNameById = ref<Record<string, string>>({})
type BulkActionModal =
  | { type: 'archive'; rows: AiStudioModelRow[]; skipped: number }
  | { type: 'restore'; rows: AiStudioModelRow[] }
  | { type: 'purge'; rows: AiStudioModelRow[]; skipped: number }
const bulkActionModal = shallowRef<BulkActionModal | null>(null)
const bulkActionBusy = ref(false)

function rowGovernanceStatus(m: AiStudioModelRow): 'ACTIVE' | 'CANDIDATE' | 'ARCHIVED' {
  if (m.governanceStatus) return m.governanceStatus
  if (m.archivedAt) return 'ARCHIVED'
  if (m.activeFlag) return 'ACTIVE'
  return 'CANDIDATE'
}

function registrySlotKey(row: AiStudioModelRow): string {
  return `${row.modelScope}|${row.entityType}|${row.entityId ?? ''}|${row.targetVariable}`
}

function registryAssetDisplayName(row: AiStudioModelRow): string {
  if (row.entityType !== 'RIDE' || !row.entityId) return ''
  const id = String(row.entityId).trim()
  if (!id) return ''
  const nm = registryRideNameById.value[id]
  return nm && nm !== id ? nm : ''
}

function registryEntityTitle(row: AiStudioModelRow): string {
  const parts: string[] = [row.entityType]
  if (row.entityId) parts.push(String(row.entityId))
  const name = registryAssetDisplayName(row)
  if (name) parts.push(name)
  return parts.join(' — ')
}

async function fetchRegistryRideNameMap(): Promise<Record<string, string>> {
  if (!parkCtx.activeParkId) return {}
  try {
    const rides = await getPlatformAssets({
      parkId: parkCtx.activeParkId,
      assetTypeCode: 'RIDE',
      limit: 2000,
    })
    const map: Record<string, string> = {}
    for (const raw of rides) {
      const a = raw as Record<string, unknown>
      const id = String(a.assetId ?? '').trim()
      if (!id) continue
      const name = String(a.name ?? a.shortName ?? a.short_name ?? '').trim()
      map[id] = name || id
    }
    return map
  } catch {
    return {}
  }
}

function isRegistryRowArchivable(row: AiStudioModelRow): boolean {
  return rowGovernanceStatus(row) === 'CANDIDATE' && !row.activeFlag
}

function isRegistryRowArchivedGovernance(row: AiStudioModelRow): boolean {
  return rowGovernanceStatus(row) === 'ARCHIVED'
}

type RegistrySortColumn =
  | 'version'
  | 'modelScope'
  | 'entity'
  | 'targetVariable'
  | 'algorithm'
  | 'trainingKind'
  | 'mae'
  | 'rmse'
  | 'r2'
  | 'active'
  | 'governance'
  | 'bestEvalSlot'
  | 'deployment'

const registrySortColumn = ref<RegistrySortColumn>('version')
const registrySortDir = ref<'asc' | 'desc'>('desc')

function compareNullableNumber(a: number | null | undefined, b: number | null | undefined): number {
  const na = a == null || !Number.isFinite(Number(a)) ? null : Number(a)
  const nb = b == null || !Number.isFinite(Number(b)) ? null : Number(b)
  if (na === null && nb === null) return 0
  if (na === null) return 1
  if (nb === null) return -1
  return na - nb
}

function governanceSortRank(m: AiStudioModelRow): number {
  const s = rowGovernanceStatus(m)
  if (s === 'ACTIVE') return 0
  if (s === 'CANDIDATE') return 1
  return 2
}

/** Aligns with API deploymentStatus when present (registry transparency). */
function deploymentSortKey(m: AiStudioModelRow): number {
  if (m.deploymentStatus === 'active_deployment') return 0
  if (m.deploymentStatus === 'candidate') return 1
  if (m.deploymentStatus === 'archived') return 2
  return governanceSortRank(m)
}

function registryDeploymentLabel(m: AiStudioModelRow): string {
  if (m.deploymentStatus === 'active_deployment') return t('aiStudio.deploymentStatusActive')
  if (m.deploymentStatus === 'candidate') return t('aiStudio.deploymentStatusCandidate')
  if (m.deploymentStatus === 'archived') return t('aiStudio.deploymentStatusArchived')
  const g = rowGovernanceStatus(m)
  if (g === 'ACTIVE') return t('aiStudio.deploymentStatusActive')
  if (g === 'CANDIDATE') return t('aiStudio.deploymentStatusCandidate')
  return t('aiStudio.deploymentStatusArchived')
}

function toggleRegistrySort(col: RegistrySortColumn) {
  if (registrySortColumn.value === col) {
    registrySortDir.value = registrySortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    registrySortColumn.value = col
    if (col === 'version' || col === 'governance') registrySortDir.value = 'desc'
    else if (col === 'mae' || col === 'rmse' || col === 'r2') registrySortDir.value = 'asc'
    else if (col === 'bestEvalSlot') registrySortDir.value = 'desc'
    else registrySortDir.value = 'asc'
  }
}

function registrySortIndicator(col: RegistrySortColumn): string {
  if (registrySortColumn.value !== col) return ''
  return registrySortDir.value === 'asc' ? ' \u2191' : ' \u2193'
}

const registrySortThClass =
  'group cursor-pointer select-none py-2 pr-3 text-left font-semibold text-slate-400 transition hover:text-slate-200'

/** Respects “leave ≥1 version per slot”: archives newest-first among selection until slot limit. */
function computeBulkArchiveRows(selected: AiStudioModelRow[]): {
  rows: AiStudioModelRow[]
  skippedSlotLimit: number
} {
  const archivable = selected.filter(isRegistryRowArchivable)
  const bySlot = new Map<string, AiStudioModelRow[]>()
  for (const r of archivable) {
    const k = registrySlotKey(r)
    const arr = bySlot.get(k) ?? []
    arr.push(r)
    bySlot.set(k, arr)
  }
  const out: AiStudioModelRow[] = []
  for (const [k, sel] of bySlot) {
    const countInSlot = models.value.filter(
      (m) => rowGovernanceStatus(m) !== 'ARCHIVED' && registrySlotKey(m) === k
    ).length
    const maxArchive = Math.max(0, countInSlot - 1)
    const sorted = [...sel].sort((a, b) => b.version - a.version)
    out.push(...sorted.slice(0, maxArchive))
  }
  return { rows: out, skippedSlotLimit: archivable.length - out.length }
}

const modelsNonArchived = computed(() => models.value.filter((m) => rowGovernanceStatus(m) !== 'ARCHIVED'))

const modelsForSelector = computed(() => {
  const base = modelsNonArchived.value
  const d = detailModel.value
  if (d && rowGovernanceStatus(d) === 'ARCHIVED' && !base.some((x) => x.id === d.id)) {
    return [d, ...base]
  }
  return base
})

const lastTrainingModel = computed(() =>
  [...modelsNonArchived.value].sort((a, b) => Date.parse(b.lastTrainingAt) - Date.parse(a.lastTrainingAt))[0] ??
  null
)
const bestModel = computed(() => {
  const withMae = modelsNonArchived.value.filter((m) => m.mae != null)
  return [...withMae].sort((a, b) => Number(a.mae) - Number(b.mae))[0] ?? null
})
const activeModelCount = computed(() => modelsNonArchived.value.filter((m) => m.activeFlag).length)
const activeModelVersionText = computed(() => {
  const active = models.value.filter((m) => m.activeFlag)
  if (!active.length) return '—'
  if (active.length === 1) return `v${active[0]?.version ?? '—'}`
  return t('aiStudio.kpiActiveMany', { n: active.length })
})
const dataQualityState = computed(() => {
  const missing = datasetStats.value?.missingRate
  if (missing == null) return t('aiStudio.kpiDataQualityUnknown')
  if (missing <= 0.05) return t('aiStudio.kpiDataQualityGood')
  if (missing <= 0.15) return t('aiStudio.kpiDataQualityFair')
  return t('aiStudio.kpiDataQualityPoor')
})
const canGoTrainingStep2 = computed(() => Boolean(trainEntityType.value) && Boolean(trainTarget.value))
const canGoTrainingStep3 = computed(() => {
  if (trainEntityType.value === 'WHOLE_PARK') return true
  if (trainEntityMode.value === 'all') return true
  return Boolean(trainEntityId.value)
})
const canGoTrainingStep4 = computed(() => trainFeatures.value.length > 0)

/** FEATURE_STORE step 3 — raw field coverage per selected X (from dataset-stats or validate-features). */
const fsQualityCoverageMap = shallowRef<Record<string, number> | null>(null)
const fsQualityRowsAnalyzed = ref(0)
const fsQualityLoading = ref(false)
let fsQualityDebounce: ReturnType<typeof setTimeout> | null = null

function ingestFeatureCoverageFromDatasetStats() {
  const st = datasetStats.value
  if (!st) return false
  const map = st.featureCompleteness ?? st.featureStoreFeatureCoverage
  if (
    !map ||
    studioDataset.value !== 'FEATURE_STORE' ||
    trainEntityMode.value !== 'one' ||
    !trainEntityId.value
  ) {
    return false
  }
  if (!st.entityId || String(st.entityId) !== String(trainEntityId.value)) return false
  fsQualityCoverageMap.value = map
  fsQualityRowsAnalyzed.value =
    st.featureCompletenessRowsAnalyzed ?? st.featureStoreCoverageRowsAnalyzed ?? 0
  return true
}

function clearFsQualityLocal() {
  fsQualityCoverageMap.value = null
  fsQualityRowsAnalyzed.value = 0
}

async function runFeatureQualityRefresh() {
  if (
    trainingStep.value !== 3 ||
    studioDataset.value !== 'FEATURE_STORE' ||
    trainEntityMode.value !== 'one' ||
    !trainEntityId.value ||
    !parkCtx.activeParkId ||
    trainFeatures.value.length === 0
  ) {
    return
  }
  if (ingestFeatureCoverageFromDatasetStats()) return
  fsQualityLoading.value = true
  try {
    const data = await postAiStudioValidateFeatures({
      entityType: 'RIDE',
      entityId: trainEntityId.value,
      features: [...trainFeatures.value],
    })
    fsQualityCoverageMap.value = data.featureCompleteness ?? data.featureCoverage
    fsQualityRowsAnalyzed.value = data.featureCompletenessRowsAnalyzed ?? data.rowsAnalyzed
  } catch {
    clearFsQualityLocal()
  } finally {
    fsQualityLoading.value = false
  }
}

function scheduleFeatureQualityRefresh() {
  if (fsQualityDebounce) clearTimeout(fsQualityDebounce)
  fsQualityDebounce = setTimeout(() => {
    fsQualityDebounce = null
    void runFeatureQualityRefresh()
  }, 300)
}

/** Thresholds: green ≥95%, yellow [75%, 95%), red below 75% for selected X. Training is never blocked. */
const FS_QUALITY_EXCELLENT_MIN = 0.95
const FS_QUALITY_WARN_MIN = 0.75

const fsQualitySelectedCompleteness = computed(() => {
  const map = fsQualityCoverageMap.value
  if (!map || trainFeatures.value.length === 0) return []
  return trainFeatures.value.map((f) => ({ feature: f, coverage: map[f] ?? 0 }))
})

const fsQualityWorstCritical = computed(() => {
  const rows = fsQualitySelectedCompleteness.value.filter((r) => r.coverage < FS_QUALITY_WARN_MIN)
  if (!rows.length) return null
  return rows.reduce((a, b) => (b.coverage < a.coverage ? b : a))
})

const fsQualityWorstWarning = computed(() => {
  const rows = fsQualitySelectedCompleteness.value.filter(
    (r) => r.coverage >= FS_QUALITY_WARN_MIN && r.coverage < FS_QUALITY_EXCELLENT_MIN,
  )
  if (!rows.length) return null
  return rows.reduce((a, b) => (b.coverage < a.coverage ? b : a))
})

const fsQualityLevel = computed(
  (): 'loading' | 'pending' | 'empty' | 'excellent' | 'warning' | 'critical' => {
    if (trainingStep.value !== 3 || studioDataset.value !== 'FEATURE_STORE') return 'pending'
    if (fsQualityLoading.value) return 'loading'
    if (trainFeatures.value.length === 0) return 'pending'
    if (!fsQualityCoverageMap.value) return 'pending'
    if (fsQualityRowsAnalyzed.value === 0) return 'empty'
    if (fsQualityWorstCritical.value) return 'critical'
    if (fsQualityWorstWarning.value) return 'warning'
    return 'excellent'
  },
)

/** Phase 3 — park-wide FEATURE_STORE batch training (all RIDE assets). */
const batchTrainStatus = shallowRef<AiStudioBatchTrainStatus | null>(null)
const batchPollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const batchStarting = ref(false)
const batchApplying = ref(false)

const isBatchRunning = computed(() => batchTrainStatus.value?.isRunning === true)

const batchSuccessfulApplyCount = computed(
  () => (batchTrainStatus.value?.results ?? []).filter((r) => r.ok && r.algorithm).length,
)

function resetBatchTrainUi() {
  stopBatchPolling()
  batchTrainStatus.value = null
}

function batchR2DisplayClass(row: AiStudioBatchTrainResultRow) {
  if (!row.ok || row.r2 == null || !Number.isFinite(Number(row.r2))) return 'text-slate-400'
  const n = Number(row.r2)
  if (row.previousR2 == null || !Number.isFinite(Number(row.previousR2))) return 'text-slate-200'
  const p = Number(row.previousR2)
  if (n > p + 1e-6) return 'text-emerald-400 font-semibold'
  if (n < p - 1e-6) return 'text-rose-300 font-semibold'
  return 'text-slate-200'
}

async function promptApplyBatchAlgorithms() {
  if (!parkCtx.activeParkId || !canTrain.value) return
  const st = batchTrainStatus.value
  const bid = st?.batchId
  const n = batchSuccessfulApplyCount.value
  if (!st || !bid || n === 0) return
  const ok = window.confirm(
    `${t('aiStudio.fsBatchConfirmTitle')}\n\n${t('aiStudio.fsBatchConfirmText', { count: n })}`,
  )
  if (!ok) return
  batchApplying.value = true
  try {
    const res = await postAiStudioBatchApply({ batchId: bid })
    push(
      t('aiStudio.fsBatchUpdateSuccess', {
        activated: res.modelsActivated ?? 0,
        skipped: res.modelsActivateSkipped ?? 0,
      }),
      'success',
    )
    resetBatchTrainUi()
    await loadModels()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    push(msg, 'error')
  } finally {
    batchApplying.value = false
  }
}

const batchProgressPct = computed(() => {
  const s = batchTrainStatus.value
  if (!s || s.total <= 0) return 0
  return Math.min(100, Math.round((s.current / s.total) * 100))
})

function stopBatchPolling() {
  if (batchPollTimer.value != null) {
    clearInterval(batchPollTimer.value)
    batchPollTimer.value = null
  }
}

async function refreshBatchTrainStatus() {
  try {
    const data = await getAiStudioBatchTrainStatus()
    batchTrainStatus.value = data
    if (!data.isRunning && batchPollTimer.value != null) {
      stopBatchPolling()
      await loadModels()
    }
  } catch {
    /* non-fatal */
  }
}

function startBatchPolling() {
  stopBatchPolling()
  void refreshBatchTrainStatus()
  batchPollTimer.value = setInterval(() => void refreshBatchTrainStatus(), 1500)
}

async function startBatchTrainAllRides() {
  if (!parkCtx.activeParkId || !canTrain.value) return
  batchStarting.value = true
  try {
    await postAiStudioBatchTrainRides({ strategy: 'AUTO' })
    await refreshBatchTrainStatus()
    if (batchTrainStatus.value?.isRunning) startBatchPolling()
    else if ((batchTrainStatus.value?.total ?? 0) === 0) {
      push(t('aiStudio.fsBatchNoRides'), 'warning')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    push(msg, 'error')
  } finally {
    batchStarting.value = false
  }
}

const compareModelA = computed(() => models.value.find((m) => m.id === compareModelAId.value) ?? null)
const compareModelB = computed(() => models.value.find((m) => m.id === compareModelBId.value) ?? null)
const driftState = computed<'ok' | 'warn' | 'bad' | 'na'>(() => {
  if (!detailModel.value) return 'na'
  const r2 = detailModel.value.r2
  const mae = detailModel.value.mae
  if (r2 == null || mae == null) return 'na'
  if (r2 >= 0.65 && mae <= 6) return 'ok'
  if (r2 >= 0.4 && mae <= 12) return 'warn'
  return 'bad'
})
const driftStateLabel = computed(() => {
  if (driftState.value === 'ok') return t('aiStudio.driftOk')
  if (driftState.value === 'warn') return t('aiStudio.driftWarn')
  if (driftState.value === 'bad') return t('aiStudio.driftBad')
  return t('aiStudio.driftUnknown')
})
const topDrivers = computed(() => {
  const m = detailModel.value
  const raw = m?.modelPayload?.featureImportances
  if (Array.isArray(raw) && raw.length) {
    const rows = raw as Array<{ feature?: string; importance?: number }>
    return rows
      .filter((x) => x.feature != null && Number.isFinite(Number(x.importance)))
      .slice(0, 5)
      .map((x) => [String(x.feature), Number(x.importance)] as [string, number])
  }
  const fi = m?.featureImportanceJson ?? {}
  return Object.entries(fi)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
})

const detailFeatureImportanceChartData = computed((): Record<string, number> => {
  const m = detailModel.value
  if (!m) return {}
  const raw = m.modelPayload?.featureImportances
  if (Array.isArray(raw) && raw.length) {
    const out: Record<string, number> = {}
    for (const row of raw as Array<{ feature?: string; importance?: number }>) {
      if (row.feature != null && Number.isFinite(Number(row.importance))) {
        out[String(row.feature)] = Number(row.importance)
      }
    }
    if (Object.keys(out).length) return out
  }
  const fi = m.featureImportanceJson
  return fi && typeof fi === 'object' ? { ...(fi as Record<string, number>) } : {}
})

const detailFeatureStoreParamsSummary = computed(() => {
  const m = detailModel.value
  if (!m) return null
  const p = m.modelPayload as Record<string, unknown> | undefined
  if (!p || p.dataset !== 'FEATURE_STORE') return null
  const tou = p.trainingOptionsUsed
  if (!tou || typeof tou !== 'object' || !Object.keys(tou as object).length) {
    return t('aiStudio.fsStandardParams')
  }
  const line = formatFeatureStoreTrainingOptionsUsed(tou as Record<string, unknown>)
  return line.trim() !== '' ? line : t('aiStudio.fsStandardParams')
})

const holdoutPoints = computed(
  () =>
    (detailModel.value?.evalHoldoutJson as { points?: Array<{ i: number; actual: number; predicted: number }> } | null)
      ?.points ?? []
)

const trainingScopeSummary = computed(() =>
  trainEntityMode.value === 'all' ? t('aiStudio.categoryScope') : t('aiStudio.entityScope')
)

const trainingSelectedAssetLabel = computed(() => {
  if (trainEntityType.value === 'WHOLE_PARK') return '—'
  if (trainEntityMode.value === 'all') return '—'
  const id = trainEntityId.value
  if (!id) return t('aiStudio.chooseAsset')
  const a = assets.value.find((x) => assetRowId(x) === id)
  return String(a?.name ?? a?.short_name ?? a?.shortName ?? id)
})

type StudioTrainAlgOption = { code: string; label: string; locked?: boolean; lockReason?: string }

const trainingAlgorithmOptions = computed((): StudioTrainAlgOption[] => {
  const sup = catalog.value?.algorithmSupport
  if (studioDataset.value === 'FEATURE_STORE') {
    return (sup?.FEATURE_STORE?.selectableAlgorithms as StudioTrainAlgOption[]) ?? []
  }
  const fromSupport = sup?.SANDBOX?.selectableAlgorithms as StudioTrainAlgOption[] | undefined
  if (fromSupport?.length) return fromSupport
  return (catalog.value?.manualAlgorithms ?? []).map((m) => ({ code: m.code, label: m.label }))
})

const featureStoreAlgorithmHelp = computed(() => {
  if (studioDataset.value !== 'FEATURE_STORE') return ''
  const opts = trainingAlgorithmOptions.value
  const locked = opts.find((o) => o.locked && o.lockReason)
  if (locked?.lockReason) return locked.lockReason
  return catalog.value?.algorithmSupport?.FEATURE_STORE?.implementationNote ?? ''
})

const trainingModeSummary = computed(() => {
  if (trainStrategy.value === 'AUTO') return t('aiStudio.summaryModeAuto')
  const alg = trainingAlgorithmOptions.value.find((x) => x.code === trainAlgorithm.value)
  return t('aiStudio.summaryModeManual', { label: alg?.label ?? trainAlgorithm.value })
})

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
  const allow = new Set(catalog.value?.featureStoreTrainFeatures ?? [...ML_TRAINING_FEATURE_NAMES])
  return all.filter((f) => allow.has(f.code))
})

function modelTrainingKind(m: AiStudioModelRow | null): 'real' | 'stub' | 'unknown' {
  if (!m?.modelPayload || typeof m.modelPayload !== 'object') return 'unknown'
  const stub = (m.modelPayload as { stub?: boolean }).stub
  return stub === false ? 'real' : 'stub'
}

function formatFsHpNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Math.abs(n) >= 0.0001 && Math.abs(n) < 1000) return String(Number(n.toFixed(4)))
  return n.toExponential(2)
}

/** Human-readable FEATURE_STORE hyperparameters from `modelPayload.trainingOptionsUsed`. */
function formatFeatureStoreTrainingOptionsUsed(tou: Record<string, unknown>): string {
  const bits: string[] = []
  if (typeof tou.ridgeLambda === 'number' && Number.isFinite(tou.ridgeLambda)) {
    bits.push(t('aiStudio.fsUsedParamsRidge', { lambda: formatFsHpNumber(tou.ridgeLambda) }))
  }
  const rf = tou.randomForest as Record<string, unknown> | undefined
  if (rf && typeof rf === 'object') {
    bits.push(
      t('aiStudio.fsUsedParamsRf', {
        n: typeof rf.nTrees === 'number' ? rf.nTrees : '—',
        d: typeof rf.maxDepth === 'number' ? rf.maxDepth : '—',
      }),
    )
  }
  const gb = tou.gradientBoosting as Record<string, unknown> | undefined
  if (gb && typeof gb === 'object') {
    bits.push(
      t('aiStudio.fsUsedParamsGb', {
        rounds: typeof gb.rounds === 'number' ? gb.rounds : '—',
        depth: typeof gb.treeDepth === 'number' ? gb.treeDepth : '—',
        shrink:
          gb.shrinkage != null && Number.isFinite(Number(gb.shrinkage))
            ? formatFsHpNumber(Number(gb.shrinkage))
            : '—',
      }),
    )
  }
  const nn = tou.neuralNetwork as Record<string, unknown> | undefined
  if (nn && typeof nn === 'object') {
    bits.push(
      t('aiStudio.fsUsedParamsNn', {
        epochs: typeof nn.epochs === 'number' ? nn.epochs : '—',
        lr: nn.lr != null && Number.isFinite(Number(nn.lr)) ? formatFsHpNumber(Number(nn.lr)) : '—',
        hidden: typeof nn.hidden === 'number' ? nn.hidden : '—',
      }),
    )
  }
  return bits.length ? bits.join(' · ') : ''
}

const sortedRegistryModels = computed(() => {
  const list = [...models.value]
  const col = registrySortColumn.value
  const dir = registrySortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    let cmp = 0
    switch (col) {
      case 'version':
        cmp = a.version - b.version
        break
      case 'modelScope':
        cmp = String(a.modelScope).localeCompare(String(b.modelScope), undefined, { sensitivity: 'base' })
        break
      case 'entity': {
        cmp = String(a.entityType).localeCompare(String(b.entityType), undefined, { sensitivity: 'base' })
        if (cmp === 0) {
          const na = registryAssetDisplayName(a) || ''
          const nb = registryAssetDisplayName(b) || ''
          cmp = na.localeCompare(nb, undefined, { sensitivity: 'base' })
        }
        if (cmp === 0) {
          cmp = String(a.entityId ?? '').localeCompare(String(b.entityId ?? ''), undefined, {
            sensitivity: 'base',
          })
        }
        break
      }
      case 'targetVariable':
        cmp = String(a.targetVariable).localeCompare(String(b.targetVariable), undefined, { sensitivity: 'base' })
        break
      case 'algorithm':
        cmp = String(a.algorithm).localeCompare(String(b.algorithm), undefined, { sensitivity: 'base' })
        break
      case 'trainingKind':
        cmp = modelTrainingKind(a).localeCompare(modelTrainingKind(b))
        break
      case 'mae':
        cmp = compareNullableNumber(a.mae, b.mae)
        break
      case 'rmse':
        cmp = compareNullableNumber(a.rmse, b.rmse)
        break
      case 'r2':
        cmp = compareNullableNumber(a.r2, b.r2)
        break
      case 'active':
        cmp = Number(a.activeFlag) - Number(b.activeFlag)
        break
      case 'governance':
        cmp = governanceSortRank(a) - governanceSortRank(b)
        break
      case 'bestEvalSlot':
        cmp = Number(!!a.bestMaeInSlot) - Number(!!b.bestMaeInSlot)
        break
      case 'deployment':
        cmp = deploymentSortKey(a) - deploymentSortKey(b)
        break
      default:
        cmp = 0
    }
    if (cmp !== 0) return cmp * dir
    return String(a.id).localeCompare(String(b.id))
  })
  return list
})

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
    trainAlgorithm.value = 'linear_regression'
    trainFeatures.value = [...ML_TRAINING_FEATURE_NAMES]
  } else {
    featureStoreTrainingOptions.value = {
      ridgeLambda: '',
      randomForest: { nTrees: '', maxDepth: '' },
      gradientBoosting: { rounds: '', treeDepth: '', shrinkage: '' },
      neuralNetwork: { epochs: '', lr: '' },
    }
  }
})

watch(
  () => [catalog.value, studioDataset.value, trainStrategy.value] as const,
  () => {
    const codes = trainingAlgorithmOptions.value.map((o) => o.code)
    if (!codes.length) return
    if (trainStrategy.value === 'MANUAL' && !codes.includes(trainAlgorithm.value)) {
      trainAlgorithm.value = codes[0] ?? trainAlgorithm.value
    }
  },
  { flush: 'post' }
)

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
  catalogError.value = null
  try {
    catalog.value = await getAiStudioCatalog()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Catalog failed'
    catalogError.value = msg
    push(msg, 'error')
    catalog.value = null
  } finally {
    catalogLoading.value = false
  }
}

async function loadModels() {
  if (!parkCtx.activeParkId) {
    models.value = []
    modelsError.value = null
    registryRideNameById.value = {}
    return
  }
  modelsLoading.value = true
  modelsError.value = null
  try {
    const [nextModels, rideNames] = await Promise.all([
      listAiStudioModels({ limit: 300, includeArchived: true }),
      fetchRegistryRideNameMap(),
    ])
    models.value = nextModels
    registryRideNameById.value = rideNames
    if (models.value.length && !detailModel.value) {
      await selectModelDetail(models.value[0].id)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Models failed'
    modelsError.value = msg
    push(msg, 'error')
    models.value = []
    registryRideNameById.value = {}
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
  datasetError.value = null
  try {
    const fsPreview = Boolean(
      studioDataset.value === 'FEATURE_STORE' &&
        trainEntityType.value === 'RIDE' &&
        trainEntityMode.value === 'one' &&
        trainEntityId.value,
    )
    datasetStats.value = await getAiStudioDatasetStats({
      entityType: trainEntityType.value,
      entityId: trainEntityMode.value === 'one' ? trainEntityId.value : null,
      dataset: fsPreview ? 'FEATURE_STORE' : undefined,
    })
    ingestFeatureCoverageFromDatasetStats()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Dataset stats failed'
    datasetError.value = msg
    push(msg, 'error')
    datasetStats.value = null
  } finally {
    datasetLoading.value = false
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

type FeatureStoreTrainingOptsPayload = NonNullable<
  Parameters<typeof postAiStudioTrain>[0]['featureStoreTrainingOptions']
>

function parseOptionalInt(
  raw: string,
  fieldLabel: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  const s = String(raw).trim()
  if (!s) return undefined
  const n = Number.parseInt(s, 10)
  if (!Number.isFinite(n) || n < min || n > max) {
    push(t('aiStudio.fsAdvFieldInvalid', { field: fieldLabel, min, max }), 'error')
    return 'invalid'
  }
  return n
}

function parseOptionalFloat(
  raw: string,
  fieldLabel: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  const s = String(raw).trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n < min || n > max) {
    push(t('aiStudio.fsAdvFieldInvalid', { field: fieldLabel, min, max }), 'error')
    return 'invalid'
  }
  return n
}

async function submitTrain() {
  /** MANUAL + FEATURE_STORE only; returns payload if any field set, else undefined. */
  function buildFeatureStoreTrainingOptionsForRequest():
    | undefined
    | FeatureStoreTrainingOptsPayload
    | 'invalid' {
    if (studioDataset.value !== 'FEATURE_STORE' || trainStrategy.value !== 'MANUAL') return undefined

    const f = featureStoreTrainingOptions.value
    const alg = trainAlgorithm.value
    const out: FeatureStoreTrainingOptsPayload = {}

    if (alg === 'linear_regression') {
      const v = parseOptionalFloat(f.ridgeLambda, t('aiStudio.fsAdvRidgeLambda'), 1e-12, 1)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) out.ridgeLambda = v
      return Object.keys(out).length ? out : undefined
    }

    if (alg === 'random_forest') {
      const rf: NonNullable<FeatureStoreTrainingOptsPayload['randomForest']> = {}
      let v = parseOptionalInt(f.randomForest.nTrees, t('aiStudio.fsAdvRfNTrees'), 8, 256)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) rf.nTrees = v
      v = parseOptionalInt(f.randomForest.maxDepth, t('aiStudio.fsAdvRfMaxDepth'), 2, 24)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) rf.maxDepth = v
      if (Object.keys(rf).length) out.randomForest = rf
      return Object.keys(out).length ? out : undefined
    }

    if (alg === 'gradient_boosting') {
      const gb: NonNullable<FeatureStoreTrainingOptsPayload['gradientBoosting']> = {}
      let v = parseOptionalInt(f.gradientBoosting.rounds, t('aiStudio.fsAdvGbRounds'), 8, 400)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) gb.rounds = v
      v = parseOptionalInt(f.gradientBoosting.treeDepth, t('aiStudio.fsAdvGbTreeDepth'), 1, 12)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) gb.treeDepth = v
      const vf = parseOptionalFloat(f.gradientBoosting.shrinkage, t('aiStudio.fsAdvGbShrinkage'), 0.01, 0.5)
      if (vf === 'invalid') return 'invalid'
      if (vf !== undefined) gb.shrinkage = vf
      if (Object.keys(gb).length) out.gradientBoosting = gb
      return Object.keys(out).length ? out : undefined
    }

    if (alg === 'neural_network') {
      const nn: NonNullable<FeatureStoreTrainingOptsPayload['neuralNetwork']> = {}
      let v = parseOptionalInt(f.neuralNetwork.epochs, t('aiStudio.fsAdvNnEpochs'), 50, 2000)
      if (v === 'invalid') return 'invalid'
      if (v !== undefined) nn.epochs = v
      const vf = parseOptionalFloat(f.neuralNetwork.lr, t('aiStudio.fsAdvNnLr'), 0.001, 0.5)
      if (vf === 'invalid') return 'invalid'
      if (vf !== undefined) nn.lr = vf
      if (Object.keys(nn).length) out.neuralNetwork = nn
      return Object.keys(out).length ? out : undefined
    }

    return undefined
  }

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
  let fsTrainOpts: FeatureStoreTrainingOptsPayload | undefined
  if (studioDataset.value === 'FEATURE_STORE' && trainStrategy.value === 'MANUAL') {
    const built = buildFeatureStoreTrainingOptionsForRequest()
    if (built === 'invalid') return
    fsTrainOpts = built
  }
  trainSubmitting.value = true
  lastTrainStatus.value = 'queued'
  lastTrainStatusAt.value = new Date().toISOString()
  lastTrainStatusMessage.value = t('aiStudio.jobQueued')
  try {
    lastTrainStatus.value = 'running'
    lastTrainStatusAt.value = new Date().toISOString()
    lastTrainStatusMessage.value = t('aiStudio.jobRunning')
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
      ...(fsTrainOpts ? { featureStoreTrainingOptions: fsTrainOpts } : {}),
    }
    const trained = await postAiStudioTrain(body)
    lastTrainStatus.value = 'done'
    lastTrainStatusAt.value = new Date().toISOString()
    lastTrainStatusMessage.value = t('aiStudio.jobDone')
    auditEvents.value = [
      {
        at: new Date().toISOString(),
        action: t('aiStudio.auditTrain'),
        detail: `${trainEntityType.value} / ${trainTarget.value} / ${studioDataset.value}`,
      },
      ...auditEvents.value,
    ].slice(0, 30)
    push(t('aiStudio.trainOk'), 'success')
    await loadModels()
    const pickId = trained?.id ?? lastTrainingModel.value?.id
    if (pickId) {
      await selectModelDetail(pickId)
    }
  } catch (e) {
    lastTrainStatus.value = 'failed'
    lastTrainStatusAt.value = new Date().toISOString()
    lastTrainStatusMessage.value = e instanceof Error ? e.message : t('aiStudio.jobFailed')
    push(e instanceof Error ? e.message : 'Train failed', 'error')
  } finally {
    trainSubmitting.value = false
  }
}

async function activateRow(row: AiStudioModelRow, on: boolean) {
  if (!canTrain.value) return
  try {
    await patchAiStudioModelActivate(row.id, on)
    auditEvents.value = [
      {
        at: new Date().toISOString(),
        action: on ? t('aiStudio.auditActivate') : t('aiStudio.auditDeactivate'),
        detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
      },
      ...auditEvents.value,
    ].slice(0, 30)
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

async function loadRuntimeResolution() {
  if (!parkCtx.activeParkId) return
  const myGen = ++runtimeResolutionRequestGen
  runtimeResolutionInFlight += 1
  runtimeResolutionLoading.value = true
  runtimeResolutionError.value = null
  try {
    const rawId = predictEntityId.value ? String(predictEntityId.value).trim() : ''
    const data = await postAiStudioRuntimeResolution({
      entityType: predictEntityType.value,
      entityId: predictEntityType.value === 'WHOLE_PARK' ? null : rawId || null,
      targetVariable: predictTarget.value,
    })
    if (myGen !== runtimeResolutionRequestGen) return
    runtimeResolution.value = data
  } catch (e) {
    if (myGen !== runtimeResolutionRequestGen) return
    runtimeResolution.value = null
    const msg = e instanceof Error ? e.message : t('aiStudio.runtimeResolutionFailed')
    runtimeResolutionError.value = msg
    push(msg, 'error')
  } finally {
    runtimeResolutionInFlight -= 1
    if (runtimeResolutionInFlight <= 0) {
      runtimeResolutionInFlight = 0
      runtimeResolutionLoading.value = false
    }
  }
}

const PREDICT_FEATURE_STORE_TARGET = 'wait_time_plus_15'

/** Vorhersagen: FEATURE_STORE + RIDE — Ziel auf +15 setzen, nach nextTick Auflösung laden (kein rules_fallback durch falsches Y). */
async function applyPredictFeatureStoreSlotFromSelection() {
  if (activeTab.value !== 'predictions') return
  if (studioDataset.value !== 'FEATURE_STORE' || predictEntityType.value !== 'RIDE') return
  const ts = targetsForPredict.value
  if (ts.includes(PREDICT_FEATURE_STORE_TARGET)) predictTarget.value = PREDICT_FEATURE_STORE_TARGET
  const rawId =
    predictEntityId.value != null && String(predictEntityId.value).trim() !== ''
      ? String(predictEntityId.value).trim()
      : ''
  if (!rawId || !parkCtx.activeParkId) {
    runtimeResolutionRequestGen += 1
    runtimeResolution.value = null
    runtimeResolutionError.value = null
    return
  }
  await nextTick()
  await loadRuntimeResolution()
}

function resetPredictionsUiForNonFeatureStore() {
  if (activeTab.value !== 'predictions') return
  runtimeResolutionRequestGen += 1
  runtimeResolution.value = null
  runtimeResolutionError.value = null
  const ts = targetsForPredict.value
  if (ts.length && !ts.includes(predictTarget.value)) {
    predictTarget.value = ts[0] ?? 'wait_time_minutes'
  }
}

/** 1+2: Nur bei FEATURE_STORE + RIDE — Asset → Y = wait_time_plus_15, dann nextTick + Auflösung. */
watch(predictEntityId, () => {
  if (activeTab.value !== 'predictions') return
  if (studioDataset.value !== 'FEATURE_STORE' || predictEntityType.value !== 'RIDE') {
    runtimeResolutionRequestGen += 1
    runtimeResolution.value = null
    runtimeResolutionError.value = null
    return
  }
  void applyPredictFeatureStoreSlotFromSelection()
}, { flush: 'post' })

/** Tab / Dataset / Entitätstyp: erneut auflösen wenn Slot gültig; SANDBOX → Panel leeren, Default-Y. */
watch(
  () => [activeTab.value, studioDataset.value, predictEntityType.value] as const,
  () => {
    if (activeTab.value !== 'predictions') return
    if (studioDataset.value !== 'FEATURE_STORE') {
      resetPredictionsUiForNonFeatureStore()
      return
    }
    if (predictEntityType.value !== 'RIDE') {
      runtimeResolutionRequestGen += 1
      runtimeResolution.value = null
      runtimeResolutionError.value = null
      return
    }
    void applyPredictFeatureStoreSlotFromSelection()
  },
  { flush: 'post' },
)

/** Katalog nachgeladen: Ziele verfügbar → Slot erneut anwenden (nur Vorhersagen + FEATURE_STORE). */
watch(catalog, () => {
  if (activeTab.value !== 'predictions') return
  if (studioDataset.value !== 'FEATURE_STORE') return
  void applyPredictFeatureStoreSlotFromSelection()
})

watch(
  () => parkCtx.activeParkId,
  async () => {
    await loadModels()
    await loadAssetsForTrain()
    await loadAssetsForPredict()
  }
)

watch(
  () => [trainEntityId.value, trainEntityMode.value, studioDataset.value, parkCtx.activeParkId] as const,
  () => {
    if (!ingestFeatureCoverageFromDatasetStats()) clearFsQualityLocal()
  },
  { flush: 'post' },
)

watch(
  () =>
    [
      trainingStep.value,
      studioDataset.value,
      trainEntityMode.value,
      trainEntityId.value,
      trainFeatures.value.join(','),
      parkCtx.activeParkId,
    ] as const,
  () => {
    if (trainingStep.value !== 3 || studioDataset.value !== 'FEATURE_STORE') return
    scheduleFeatureQualityRefresh()
  },
  { flush: 'post' },
)

watch(
  () => datasetStats.value?.featureCompleteness ?? datasetStats.value?.featureStoreFeatureCoverage,
  () => {
    if (trainingStep.value === 3) ingestFeatureCoverageFromDatasetStats()
  },
)

watch(activeTab, (tab) => {
  if (tab === 'predictions') void loadAssetsForPredict()
  if (tab !== 'registry') registryBulkSelectMode.value = false
  if (tab !== 'training') stopBatchPolling()
  if (tab === 'training') {
    void (async () => {
      try {
        const d = await getAiStudioBatchTrainStatus()
        batchTrainStatus.value = d
        if (d.isRunning) startBatchPolling()
      } catch {
        /* ignore */
      }
    })()
  }
})

watch(registryBulkSelectMode, (on) => {
  if (!on) registrySelectedIds.value = []
})

watch(canTrain, (ok) => {
  if (!ok) registryBulkSelectMode.value = false
})

watch(
  () => [trainEntityType.value, trainEntityMode.value, trainEntityId.value] as const,
  async () => {
    await loadAssetsForTrain()
  }
)

const mlPickerEntityId = computed(() => {
  if (trainEntityMode.value === 'one' && trainEntityId.value) return String(trainEntityId.value).trim()
  return ''
})

async function loadMlFeatureDraft() {
  const id = mlPickerEntityId.value
  const et = ML_EXT_ENTITY_TYPE
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
      entityType: ML_EXT_ENTITY_TYPE,
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
  () => [mlPickerEntityId.value, parkCtx.activeParkId] as const,
  () => void loadMlFeatureDraft(),
  { flush: 'post' }
)

onMounted(async () => {
  try {
    if (!installedAdapters.loaded) {
      await installedAdapters.hydrate()
    }
  } catch {
    /* non-fatal: adapter bridge may stay hidden until navigation */
  }
  await loadCatalog()
  await loadModels()
  await loadAssetsForTrain()
  await loadAssetsForPredict()
})

onBeforeUnmount(() => {
  stopBatchPolling()
})

function toggleFeature(code: string) {
  const fsAllow = ML_TRAINING_FEATURE_NAMES as readonly string[]
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

function openDatasetConfiguration() {
  activeTab.value = 'datasets'
}

function openTrainingAssistant() {
  trainingStep.value = 1
  lastTrainStatus.value = 'idle'
  lastTrainStatusAt.value = null
  lastTrainStatusMessage.value = ''
  activeTab.value = 'training'
}

function goTrainingStep(step: 1 | 2 | 3 | 4) {
  trainingStep.value = step
}

function governanceBadgeLabel(row: AiStudioModelRow): string {
  const s = rowGovernanceStatus(row)
  if (s === 'ACTIVE') return t('aiStudio.governanceBadgeActive')
  if (s === 'ARCHIVED') return t('aiStudio.governanceBadgeArchived')
  return t('aiStudio.governanceBadgeCandidate')
}

async function confirmArchiveModel() {
  const row = archiveConfirmRow.value
  if (!row || !canTrain.value) return
  try {
    await deleteAiStudioModelArchive(row.id)
    auditEvents.value = [
      {
        at: new Date().toISOString(),
        action: t('aiStudio.auditArchive'),
        detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
      },
      ...auditEvents.value,
    ].slice(0, 30)
    push(t('aiStudio.archiveOk'), 'success')
    archiveConfirmRow.value = null
    await loadModels()
    if (detailModel.value?.id === row.id) await selectModelDetail('')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Archive failed', 'error')
  }
}

async function restoreRow(row: AiStudioModelRow) {
  if (!canTrain.value) return
  try {
    await postAiStudioModelRestore(row.id)
    auditEvents.value = [
      {
        at: new Date().toISOString(),
        action: t('aiStudio.auditRestore'),
        detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
      },
      ...auditEvents.value,
    ].slice(0, 30)
    push(t('aiStudio.restoreOk'), 'success')
    await loadModels()
    if (detailModel.value?.id === row.id) await selectModelDetail(row.id)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Restore failed', 'error')
  }
}

async function confirmPurgeModel() {
  const row = purgeConfirmRow.value
  if (!row || !canTrain.value) return
  const rid = row.id
  try {
    await deleteAiStudioModelPermanent(rid)
    auditEvents.value = [
      {
        at: new Date().toISOString(),
        action: t('aiStudio.auditDeletePermanent'),
        detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
      },
      ...auditEvents.value,
    ].slice(0, 30)
    push(t('aiStudio.purgeOk'), 'success')
    purgeConfirmRow.value = null
    models.value = models.value.filter((m) => m.id !== rid)
    registrySelectedIds.value = registrySelectedIds.value.filter((x) => x !== rid)
    await loadModels()
    if (detailModel.value?.id === rid) await selectModelDetail('')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

function selectedRegistryModels(): AiStudioModelRow[] {
  const idSet = new Set(registrySelectedIds.value)
  return models.value.filter((m) => idSet.has(m.id))
}

function toggleRegistryRowSelection(row: AiStudioModelRow) {
  if (!registryBulkSelectMode.value || rowGovernanceStatus(row) === 'ACTIVE') return
  const id = row.id
  const set = new Set(registrySelectedIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  registrySelectedIds.value = [...set]
}

function selectAllRegistryEligible() {
  registrySelectedIds.value = models.value.filter((m) => rowGovernanceStatus(m) !== 'ACTIVE').map((m) => m.id)
}

function clearRegistryBulkSelection() {
  registrySelectedIds.value = []
}

function openBulkArchiveConfirm() {
  const selected = selectedRegistryModels()
  const { rows, skippedSlotLimit } = computeBulkArchiveRows(selected)
  const ineligible = selected.filter((r) => !isRegistryRowArchivable(r)).length
  const skipped = ineligible + skippedSlotLimit
  if (!rows.length) {
    push(t('aiStudio.bulkArchiveNothing'), 'warning')
    return
  }
  bulkActionModal.value = { type: 'archive', rows, skipped }
}

function openBulkRestoreConfirm() {
  const rows = selectedRegistryModels().filter(isRegistryRowArchivedGovernance)
  if (!rows.length) {
    push(t('aiStudio.bulkRestoreNothing'), 'warning')
    return
  }
  bulkActionModal.value = { type: 'restore', rows }
}

function openBulkPurgeConfirm() {
  const selected = selectedRegistryModels()
  const rows = selected.filter(isRegistryRowArchivedGovernance)
  const skipped = selected.length - rows.length
  if (!rows.length) {
    push(t('aiStudio.bulkPurgeNothing'), 'warning')
    return
  }
  bulkActionModal.value = { type: 'purge', rows, skipped }
}

function cancelBulkActionModal() {
  bulkActionModal.value = null
}

async function confirmBulkActionModal() {
  const modal = bulkActionModal.value
  if (!modal || !canTrain.value) return
  bulkActionBusy.value = true
  try {
    if (modal.type === 'archive') {
      for (const row of modal.rows) {
        await deleteAiStudioModelArchive(row.id)
        auditEvents.value = [
          {
            at: new Date().toISOString(),
            action: t('aiStudio.auditArchive'),
            detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
          },
          ...auditEvents.value,
        ].slice(0, 30)
      }
      push(t('aiStudio.bulkArchiveOk', { n: modal.rows.length }), 'success')
    } else if (modal.type === 'restore') {
      for (const row of modal.rows) {
        await postAiStudioModelRestore(row.id)
        auditEvents.value = [
          {
            at: new Date().toISOString(),
            action: t('aiStudio.auditRestore'),
            detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
          },
          ...auditEvents.value,
        ].slice(0, 30)
      }
      push(t('aiStudio.bulkRestoreOk', { n: modal.rows.length }), 'success')
    } else {
      const purgeIds = new Set(modal.rows.map((r) => r.id))
      for (const row of modal.rows) {
        await deleteAiStudioModelPermanent(row.id)
        auditEvents.value = [
          {
            at: new Date().toISOString(),
            action: t('aiStudio.auditDeletePermanent'),
            detail: `${row.entityType} / ${row.modelScope} / ${row.targetVariable} v${row.version}`,
          },
          ...auditEvents.value,
        ].slice(0, 30)
      }
      push(t('aiStudio.bulkPurgeOk', { n: modal.rows.length }), 'success')
      models.value = models.value.filter((m) => !purgeIds.has(m.id))
      registrySelectedIds.value = registrySelectedIds.value.filter((x) => !purgeIds.has(x))
    }
    bulkActionModal.value = null
    registrySelectedIds.value = []
    await loadModels()
    const dId = detailModel.value?.id
    if (dId && !models.value.some((m) => m.id === dId)) await selectModelDetail('')
  } catch (e) {
    push(e instanceof Error ? e.message : 'Bulk action failed', 'error')
    await loadModels()
  } finally {
    bulkActionBusy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">{{
          t('aiMl.back')
        }}</RouterLink>
        <h1 class="mt-2 font-display text-2xl font-semibold text-white">{{ t('aiStudio.title') }}</h1>
        <p :class="ui.subtitle">{{ t('aiStudio.subtitle') }}</p>
      </div>
      <div
        v-if="!parkCtx.activeParkId"
        class="shrink-0 rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2 text-sm text-amber-200"
      >
        {{ t('aiMl.needPark') }}
      </div>
      <button
        v-else
        type="button"
        data-testid="ai-studio-training-assistant"
        class="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="!canTrain"
        @click="openTrainingAssistant"
      >
        {{ t('aiStudio.startTraining') }}
      </button>
    </div>

    <details
      class="group mt-4 rounded-lg border border-amber-800/50 bg-amber-950/25 px-4 py-2 text-sm text-amber-100 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        class="cursor-pointer select-none list-none font-medium text-amber-100/95 underline-offset-2 hover:underline"
      >
        {{ t('aiStudio.experimentalBannerSummary') }}
      </summary>
      <p class="mt-3 border-t border-amber-800/40 pt-3 leading-snug" role="note">
        {{ t('aiStudio.experimentalBanner') }}
      </p>
    </details>

    <div class="mt-6 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
      <button
        v-for="tb in tabs"
        :key="tb.id"
        type="button"
        :data-testid="'ai-studio-tab-' + tb.id"
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

    <div
      v-if="parkCtx.activeParkId"
      class="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3"
      data-testid="ai-studio-active-model-row"
    >
      <div class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('aiStudio.activeRegistryModel') }}</div>
      <select
        :class="[ui.control, 'mt-2 max-w-2xl']"
        :value="detailModel?.id || ''"
        :disabled="modelsLoading || !modelsForSelector.length"
        @change="selectModelDetail(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('aiStudio.chooseModel') }}</option>
        <option v-for="m in modelsForSelector" :key="m.id" :value="m.id">
          {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }} v{{ m.version }}
          {{ m.activeFlag ? '★' : '' }}
        </option>
      </select>
      <p v-if="detailLoading" class="mt-2 text-xs text-slate-500">{{ t('aiStudio.loading') }}</p>
    </div>

    <div class="mt-6 space-y-6">
      <section v-show="activeTab === 'overview'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.overviewTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.overviewBody') }}</p>
        <p class="mt-2 text-sm text-slate-400">{{ t('aiStudio.deploymentChain') }}</p>
        <p class="mt-3 rounded border border-slate-800/80 bg-slate-950/35 px-3 py-2 text-sm text-slate-300">
          {{ t('aiStudio.bestVsActiveHelp') }}
        </p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.kpiLatestTrained') }}</div>
            <div :class="ui.statValue">
              {{ lastTrainingModel?.lastTrainingAt ? formatDateTime(lastTrainingModel.lastTrainingAt) : '—' }}
            </div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.kpiBestEvaluated') }}</div>
            <div :class="ui.statValue">
              {{ bestModel ? `v${bestModel.version} · MAE ${bestModel.mae?.toFixed(3) ?? '—'}` : '—' }}
            </div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.kpiActiveDeployment') }}</div>
            <div :class="ui.statValue">{{ activeModelVersionText }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ activeModelCount }} {{ t('aiStudio.kpiModels') }}</div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.kpiDataQuality') }}</div>
            <div :class="ui.statValue">{{ dataQualityState }}</div>
            <div class="mt-1 text-xs text-slate-500">
              {{
                datasetStats?.missingRate != null
                  ? t('aiStudio.kpiMissingRate', { pct: (datasetStats.missingRate * 100).toFixed(1) })
                  : t('aiStudio.kpiDataQualityNoStats')
              }}
            </div>
          </div>
          <div :class="ui.infoBox">
            <div :class="ui.statLabel">{{ t('aiStudio.kpiDrift') }}</div>
            <template v-if="!detailModel">
              <div class="text-sm text-slate-500">{{ t('aiStudio.selectModelForDrift') }}</div>
            </template>
            <template v-else>
              <div
                class="inline-flex w-fit rounded px-2 py-0.5 text-xs font-medium"
                :class="
                  driftState === 'ok'
                    ? 'bg-emerald-950/40 text-emerald-300'
                    : driftState === 'warn'
                      ? 'bg-amber-950/40 text-amber-300'
                      : driftState === 'bad'
                        ? 'bg-rose-950/40 text-rose-300'
                        : 'bg-slate-900 text-slate-300'
                "
              >
                {{ driftStateLabel }}
              </div>
              <div class="mt-1 text-xs text-slate-500">{{ t('aiStudio.driftHint') }}</div>
            </template>
          </div>
        </div>
        <div class="mt-6 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.explainabilityTitle') }}</h3>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.explainabilityHint') }}</p>
          <ul v-if="topDrivers.length" class="mt-3 space-y-1 text-sm text-slate-200">
            <li v-for="[name, score] in topDrivers" :key="name" class="flex items-center justify-between gap-3">
              <span class="font-mono text-xs text-brand-300">{{ name }}</span>
              <span class="text-xs text-slate-400">{{ score.toFixed(4) }}</span>
            </li>
          </ul>
          <p v-else class="mt-3 text-sm text-slate-500">{{ t('aiStudio.explainabilityEmpty') }}</p>
        </div>
        <div v-if="catalogLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <p v-else-if="catalogError" class="mt-4 rounded border border-rose-700/50 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
          {{ t('aiStudio.catalogLoadError') }}
        </p>
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
          <div
            v-if="detailFeatureStoreParamsSummary != null"
            class="sm:col-span-2 lg:col-span-4 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
          >
            <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {{ t('aiStudio.fsUsedParamsTitle') }}
            </div>
            <p class="mt-1 text-sm text-slate-200">{{ detailFeatureStoreParamsSummary }}</p>
          </div>
          <div
            v-if="Object.keys(detailFeatureImportanceChartData).length > 0"
            class="sm:col-span-2 lg:col-span-4 rounded border border-slate-800 bg-slate-950/40 px-3 py-2"
          >
            <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {{ t('aiStudio.fsFeatureImportanceTitle') }}
            </h3>
            <p class="mt-1 text-[11px] text-slate-500">{{ t('aiStudio.fsFeatureImportanceHint') }}</p>
            <AiStudioFeatureImportanceBarChart
              :key="`${detailModel.id}-overview-fi`"
              class="mt-2 block h-72 min-h-[12rem] w-full min-w-0"
              :data="detailFeatureImportanceChartData"
              display-as-percent
            />
          </div>
          <div v-if="formatTrainingMeta(detailModel)" class="sm:col-span-3 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
            {{ formatTrainingMeta(detailModel) }}
          </div>
        </div>
        <p v-else-if="parkCtx.activeParkId" class="mt-4 text-sm text-slate-500">{{ t('aiStudio.pickModelHint') }}</p>
      </section>

      <section v-show="activeTab === 'datasets'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.datasetsTitle') }}</h2>
        <p :class="[ui.muted, 'max-w-3xl']">{{ t('aiStudio.datasetsHint') }}</p>
        <div class="mt-4 flex flex-wrap items-end gap-3">
          <div class="block text-xs text-slate-500">{{ t('aiStudio.datasetSource') }}</div>
          <select v-model="studioDataset" data-testid="ai-studio-dataset-source" :class="[ui.control, 'max-w-xs']">
            <option value="SANDBOX">{{ t('aiStudio.datasetSandbox') }}</option>
            <option value="FEATURE_STORE">{{ t('aiStudio.datasetFeatureStore') }}</option>
          </select>
          <span
            v-if="studioDataset === 'FEATURE_STORE'"
            class="rounded-full border border-emerald-600/45 bg-emerald-950/35 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100/95"
          >
            {{ t('aiStudio.badgeDirectSnapshot') }}
          </span>
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <div class="block text-xs text-slate-500">{{ t('aiStudio.entityType') }}</div>
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

        <details
          v-if="parkCtx.activeParkId"
          class="group mt-6 rounded-lg border border-slate-700/80 bg-slate-950/50 p-4 [&_summary::-webkit-details-marker]:hidden"
          data-testid="ai-studio-ml-data-flow"
        >
          <summary class="cursor-pointer select-none list-none text-sm font-semibold text-white underline-offset-2 hover:underline">
            {{ t('aiStudio.technicalMlPipelineToggle') }}
          </summary>
          <h3 class="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.mlDataFlowTitle') }}</h3>
          <div v-if="mlDataFlowLines.length" class="mt-2 space-y-1.5">
            <div
              v-for="(line, idx) in mlDataFlowLines"
              :key="idx"
              class="border-l-2 border-slate-600 pl-2.5 text-xs leading-snug text-slate-300"
            >
              {{ line }}
            </div>
          </div>
          <p v-else class="mt-2 whitespace-pre-line text-xs text-slate-400">{{ t('aiStudio.mlDataFlowFallback') }}</p>
          <p class="mt-3 border-t border-slate-800 pt-2 text-[11px] leading-relaxed text-slate-500">
            {{ t('aiStudio.mlDataFlowFooter') }}
          </p>
        </details>

        <div v-if="datasetLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <p v-else-if="datasetError" class="mt-4 rounded border border-rose-700/50 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
          {{ t('aiStudio.datasetLoadError') }}
        </p>
        <div v-else-if="datasetStats" class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div :class="ui.infoBox" :title="t('aiStudio.datasetHeuristicTooltip')">
            <div class="flex items-center gap-1.5">
              <div :class="ui.statLabel">{{ t('aiStudio.datasetHeuristicLabel') }}</div>
              <abbr
                class="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-slate-600 text-[9px] font-bold text-slate-400 no-underline"
                :title="t('aiStudio.datasetHeuristicTooltip')"
                >i</abbr>
            </div>
            <template v-if="datasetStats.heuristicRowsSelectedEntity != null">
              <div :class="ui.statValue">{{ datasetStats.heuristicRowsSelectedEntity }}</div>
              <div class="mt-1 text-[11px] leading-snug text-slate-500" :title="t('aiStudio.datasetHeuristicAggregateHint')">
                {{ t('aiStudio.datasetHeuristicAggregateLine', { total: datasetStats.rowCount }) }}
              </div>
            </template>
            <div v-else :class="ui.statValue">{{ datasetStats.rowCount }}</div>
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
                :title="t('aiStudio.viewParkSnapshotRowsTooltip')"
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
            <p
              v-if="studioDataset === 'FEATURE_STORE' && trainEntityMode === 'one' && trainEntityId"
              class="mt-1 text-[10px] leading-snug text-slate-500"
            >
              {{ t('aiStudio.entitySamplesFeatureStoreFootnote') }}
            </p>
          </div>
        </div>

        <p
          v-if="showFeatureStorePreviewHint"
          class="mt-4 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90"
        >
          {{ t('aiStudio.featureStorePreviewSelectAssetHint') }}
        </p>

        <div
          v-if="datasetStats?.featureStorePreview && studioDataset === 'FEATURE_STORE'"
          class="mt-6 rounded-lg border border-emerald-800/35 bg-emerald-950/15 px-4 py-3 text-sm text-slate-200"
          data-testid="ai-studio-feature-store-training-preview"
        >
          <h3 class="text-xs font-semibold uppercase tracking-wide text-emerald-200/90">
            {{ t('aiStudio.featureStoreTrainingPreviewTitle') }}
          </h3>
          <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.featureStoreRideSnapshotsLoaded') }}</div>
              <div class="font-mono text-base text-slate-100">{{ datasetStats.featureStorePreview.snapshotBucketRows }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.featureStoreTrainingRowsLabeled') }}</div>
              <div class="font-mono text-base text-slate-100">{{ datasetStats.featureStorePreview.labeledHorizonRows }}</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.featureStoreLabeledPctLabel') }}</div>
              <div class="font-mono text-base text-slate-100">
                {{ featureStoreLabeledPct != null ? `${featureStoreLabeledPct}%` : '—' }}
              </div>
            </div>
            <div class="sm:col-span-1">
              <div class="text-[11px] text-slate-500">{{ t('aiStudio.fsDateRange') }}</div>
              <div class="text-[11px] leading-snug text-slate-200">
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
          <details class="group mt-4 border-t border-emerald-900/30 pt-3 [&_summary::-webkit-details-marker]:hidden">
            <summary class="cursor-pointer select-none list-none text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline">
              {{ t('aiStudio.technicalFeatureVectorToggle') }}
            </summary>
            <p class="mt-3 text-xs leading-relaxed text-slate-400">{{ t('aiStudio.featureStoreTrainingPreviewHint') }}</p>
            <div class="mt-3">
              <div class="text-[11px] font-medium text-slate-400">{{ t('aiStudio.featureStoreVectorSourceLabel') }}</div>
              <div class="mt-1 font-mono text-[11px] text-emerald-100/85">ride_feature_snapshots_5m</div>
              <div class="mt-2 text-[11px] text-slate-500">{{ t('aiStudio.featureStoreXKeysIntro') }}</div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <span
                  v-for="k in ML_TRAINING_FEATURE_NAMES"
                  :key="k"
                  class="rounded border border-slate-700/90 bg-slate-900/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                  >{{ k }}</span>
              </div>
            </div>
          </details>
        </div>

        <details
          v-if="parkCtx.activeParkId"
          class="group mt-8 rounded-lg border border-slate-700 bg-slate-950/35 p-4 [&_summary::-webkit-details-marker]:hidden"
          data-testid="ai-studio-ml-signal-picker-section"
        >
          <summary class="cursor-pointer select-none list-none text-sm font-semibold text-white underline-offset-2 hover:underline">
            {{ t('aiStudio.advancedExtensionSignalsToggle') }}
          </summary>
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.extensionSignalSectionTitle') }}</h3>
            <span
              class="rounded-full border border-violet-600/40 bg-violet-950/35 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100/95"
            >
              {{ t('aiStudio.badgeMetadataSignals') }}
            </span>
          </div>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.extensionSignalSectionHint') }}</p>
          <p class="mt-2 text-xs text-slate-500">{{ t('aiStudio.mlSignalPickerAssetScopeHint') }}</p>
          <p
            v-if="trainEntityMode !== 'one' || !trainEntityId"
            class="mt-3 rounded border border-amber-900/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/90"
          >
            {{ t('aiStudio.mlSignalPickerNeedSpecificAsset') }}
          </p>
          <div v-else-if="mlPickerEntityId" class="mt-4 max-w-3xl space-y-3">
            <p v-if="mlDraftLoadBusy" class="text-xs text-slate-500">{{ t('aiStudio.mlFeatureDraftLoading') }}</p>
            <MLSignalSourcePicker
              :key="mlPickerEntityId"
              entity-type="park_asset"
              :entity-id="mlPickerEntityId"
              :empty-hint="t('aiStudio.extensionSignalsEmpty')"
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
        </details>
      </section>

      <section v-show="activeTab === 'training'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.trainingTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.trainingHint') }}</p>
        <div
          v-if="pdmAdapterInstalled"
          class="mt-4 rounded-lg border border-sky-800/55 bg-sky-950/20 px-3 py-2 text-sm text-sky-100"
        >
          <div class="font-medium text-sky-100/95">{{ t('aiStudio.pdmAdapterTrainingBridgeTitle') }}</div>
          <p class="mt-1 text-xs leading-snug text-sky-200/90">{{ t('aiStudio.pdmAdapterTrainingBridgeBody') }}</p>
          <RouterLink
            :to="{ name: 'predictive-maintenance' }"
            class="mt-2 inline-block text-xs font-medium text-sky-300 underline-offset-2 hover:underline"
          >
            {{ t('aiStudio.pdmAdapterTrainingBridgeCta') }}
          </RouterLink>
        </div>
        <div class="mt-4 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded px-2.5 py-1 text-xs"
              :class="trainingStep === 1 ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-300'"
              @click="goTrainingStep(1)"
            >
              1. {{ t('aiStudio.wizardData') }}
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1 text-xs"
              :class="trainingStep === 2 ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-300'"
              :disabled="!canGoTrainingStep2"
              @click="goTrainingStep(2)"
            >
              2. {{ t('aiStudio.wizardScope') }}
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1 text-xs"
              :class="trainingStep === 3 ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-300'"
              :disabled="!canGoTrainingStep3"
              @click="goTrainingStep(3)"
            >
              3. {{ t('aiStudio.wizardFeatures') }}
            </button>
            <button
              type="button"
              class="rounded px-2.5 py-1 text-xs"
              :class="trainingStep === 4 ? 'bg-brand-600 text-white' : 'border border-slate-700 text-slate-300'"
              :disabled="!canGoTrainingStep4"
              @click="goTrainingStep(4)"
            >
              4. {{ t('aiStudio.wizardRun') }}
            </button>
          </div>
        </div>

        <div
          class="mt-6 rounded-lg border border-slate-700 bg-slate-950/35 px-4 py-3"
          data-testid="ai-studio-batch-train-section"
        >
          <h3 class="text-sm font-semibold text-slate-200">{{ t('aiStudio.fsBatchTitle') }}</h3>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.fsBatchHint') }}</p>
          <button
            type="button"
            class="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!parkCtx.activeParkId || !canTrain || batchStarting || isBatchRunning"
            @click="startBatchTrainAllRides"
          >
            {{
              batchStarting
                ? t('aiStudio.fsBatchStarting')
                : isBatchRunning
                  ? t('aiStudio.fsBatchRunning')
                  : t('aiStudio.fsBatchTrainAll')
            }}
          </button>
          <p v-if="batchTrainStatus?.error" class="mt-2 text-xs text-rose-300">{{ batchTrainStatus.error }}</p>
          <div v-if="batchTrainStatus && (batchTrainStatus.total > 0 || isBatchRunning)" class="mt-4 space-y-2">
            <progress
              class="h-2 w-full overflow-hidden rounded bg-slate-800 accent-brand-500 [&::-webkit-progress-bar]:rounded [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:rounded [&::-webkit-progress-value]:bg-brand-500"
              :value="batchProgressPct"
              max="100"
            />
            <p class="text-xs text-slate-400">
              <template v-if="isBatchRunning && (batchTrainStatus.currentEntityId || batchTrainStatus.currentEntityLabel)">
                {{
                  t('aiStudio.fsBatchProgress', {
                    asset: batchTrainStatus.currentEntityLabel || batchTrainStatus.currentEntityId,
                    current: Math.min(batchTrainStatus.current + 1, batchTrainStatus.total),
                    total: batchTrainStatus.total,
                  })
                }}
              </template>
              <template v-else-if="!isBatchRunning && batchTrainStatus.finishedAt">
                {{ t('aiStudio.fsBatchFinished', { ok: batchTrainStatus.current, total: batchTrainStatus.total }) }}
              </template>
              <template v-else>
                {{ t('aiStudio.fsBatchProgressIdle', { pct: batchProgressPct }) }}
              </template>
            </p>
          </div>

          <div
            v-if="
              batchTrainStatus &&
              !isBatchRunning &&
              batchTrainStatus.finishedAt &&
              batchTrainStatus.total > 0 &&
              batchTrainStatus.results.length > 0
            "
            class="mt-6 space-y-4 rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-4"
          >
            <h4 class="text-sm font-semibold text-slate-200">{{ t('aiStudio.fsBatchSummaryTitle') }}</h4>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="
                  !parkCtx.activeParkId ||
                  !canTrain ||
                  !batchTrainStatus.batchId ||
                  batchSuccessfulApplyCount === 0 ||
                  batchApplying
                "
                @click="promptApplyBatchAlgorithms"
              >
                {{ batchApplying ? '…' : t('aiStudio.fsBatchApplyBtn') }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-rose-500/60 hover:text-rose-200"
                @click="resetBatchTrainUi"
              >
                {{ t('aiStudio.fsBatchDiscardBtn') }}
              </button>
            </div>
            <div class="overflow-x-auto rounded border border-slate-800">
              <table class="min-w-full divide-y divide-slate-800 text-left text-xs text-slate-300">
                <thead class="bg-slate-950/80 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th class="px-3 py-2">{{ t('aiStudio.fsBatchTableHeadAsset') }}</th>
                    <th class="px-3 py-2">{{ t('aiStudio.fsBatchTablePrevAlgo') }}</th>
                    <th class="px-3 py-2">{{ t('aiStudio.fsBatchTableNewAlgo') }}</th>
                    <th class="px-3 py-2">{{ t('aiStudio.fsBatchTableQuality') }}</th>
                    <th class="px-3 py-2">{{ t('aiStudio.fsBatchTableHeadStatus') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
                  <tr v-for="(row, idx) in batchTrainStatus.results" :key="`${row.entityId}-${idx}`">
                    <td class="px-3 py-2 font-mono text-[11px]">{{ row.assetLabel || row.entityId }}</td>
                    <td class="px-3 py-2 font-mono text-[11px]">{{ row.previousAlgorithm || '—' }}</td>
                    <td class="px-3 py-2 font-mono text-[11px]">{{ row.ok && row.algorithm ? row.algorithm : '—' }}</td>
                    <td class="px-3 py-2 font-mono" :class="batchR2DisplayClass(row)">
                      <template v-if="row.ok && row.r2 != null">{{ Number(row.r2).toFixed(4) }}</template>
                      <template v-else>—</template>
                    </td>
                    <td class="px-3 py-2">
                      <span v-if="row.ok" class="text-emerald-400">{{ t('aiStudio.fsBatchStatusSuccess') }}</span>
                      <span v-else class="text-amber-300/90">{{ t('aiStudio.fsBatchStatusSkipped') }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div v-show="trainingStep === 1" class="mt-4 rounded-lg border border-slate-700 bg-slate-950/50 p-4 text-sm">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.trainingContextTitle') }}</p>
          <dl class="mt-3 grid gap-2 sm:grid-cols-2">
            <dt class="text-slate-500">{{ t('aiStudio.summaryDataset') }}</dt>
            <dd class="text-slate-200">
              {{ studioDataset === 'FEATURE_STORE' ? t('aiStudio.datasetFeatureStore') : t('aiStudio.datasetSandbox') }}
            </dd>
            <dt class="text-slate-500">{{ t('aiStudio.summaryEntityType') }}</dt>
            <dd class="font-mono text-xs text-slate-200">{{ trainEntityType }}</dd>
            <dt class="text-slate-500">{{ t('aiStudio.summaryScope') }}</dt>
            <dd class="text-slate-200">{{ trainingScopeSummary }}</dd>
            <dt class="text-slate-500">{{ t('aiStudio.summaryAsset') }}</dt>
            <dd class="text-slate-200">{{ trainingSelectedAssetLabel }}</dd>
            <dt class="text-slate-500">{{ t('aiStudio.summaryTrainingMode') }}</dt>
            <dd class="text-slate-200">{{ trainingModeSummary }}</dd>
          </dl>
          <p v-if="studioDataset === 'FEATURE_STORE'" class="mt-3 text-xs text-amber-200/90">
            {{ t('aiStudio.horizon15Note') }} {{ t('aiStudio.featureStoreFeaturesHint') }}
          </p>
          <button
            type="button"
            class="mt-4 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            @click="openDatasetConfiguration"
          >
            {{ t('aiStudio.openDatasetConfig') }}
          </button>
        </div>

        <p v-if="trainingStep === 1 && showFeatureStorePreviewHint" class="mt-2 text-xs text-amber-200/80">
          {{ t('aiStudio.featureStorePreviewSelectAssetHint') }}
        </p>
        <div v-show="trainingStep === 2" data-testid="ai-studio-training-step-2" class="mt-4">
          <div class="grid gap-4 lg:grid-cols-2">
            <div :class="ui.label">{{ t('aiStudio.entityType') }}</div>
            <select v-model="trainEntityType" :class="ui.control">
              <option v-for="et in catalog?.entityTypes || []" :key="et.code" :value="et.code">{{ et.code }}</option>
            </select>
            <div :class="ui.label">{{ t('aiStudio.targetY') }}</div>
            <select v-model="trainTarget" :class="ui.control">
              <option v-for="tg in targetsForEntity" :key="tg" :value="tg">{{ tg }}</option>
            </select>
            <div :class="ui.label">{{ t('aiStudio.scope') }}</div>
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
        </div>
        <div v-show="trainingStep === 3" data-testid="ai-studio-training-step-3" class="mt-4">
          <div>
            <div :class="ui.label">{{ t('aiStudio.strategy') }}</div>
            <div class="flex gap-4">
              <label :class="ui.choice">
                <input
                  v-model="trainStrategy"
                  type="radio"
                  value="AUTO"
                  class="accent-brand-500"
                />
                Auto
              </label>
              <label :class="ui.choice">
                <input
                  v-model="trainStrategy"
                  type="radio"
                  value="MANUAL"
                  class="accent-brand-500"
                />
                Manual
              </label>
            </div>
            <div v-if="trainStrategy === 'MANUAL' || studioDataset === 'FEATURE_STORE'" :class="ui.label">{{
              t('aiStudio.algorithm')
            }}</div>
            <select
              v-if="trainStrategy === 'MANUAL' || studioDataset === 'FEATURE_STORE'"
              v-model="trainAlgorithm"
              data-testid="ai-studio-train-algorithm"
              :class="ui.control"
              :disabled="trainStrategy === 'AUTO'"
            >
              <option v-for="alg in trainingAlgorithmOptions" :key="alg.code" :value="alg.code">
                {{ alg.label }}
              </option>
            </select>
            <p
              v-if="studioDataset === 'FEATURE_STORE' && featureStoreAlgorithmHelp"
              class="mt-1 max-w-xl text-[11px] text-slate-500"
            >
              {{ featureStoreAlgorithmHelp }}
            </p>
            <details
              v-if="studioDataset === 'FEATURE_STORE'"
              class="group mt-3 rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 [&_summary::-webkit-details-marker]:hidden"
              data-testid="ai-studio-fs-advanced"
            >
              <summary
                class="cursor-pointer select-none list-none text-xs font-semibold text-slate-300 underline-offset-2 hover:text-slate-200 hover:underline"
              >
                {{ t('aiStudio.fsAdvSummary') }}
              </summary>
              <p class="mt-2 text-[11px] leading-relaxed text-slate-500">
                {{ t('aiStudio.fsAdvHint') }}
              </p>
              <p v-if="trainStrategy === 'AUTO'" class="mt-2 text-[11px] text-amber-200/85">
                {{ t('aiStudio.fsAdvAutoNote') }}
              </p>
              <div v-else class="mt-3 space-y-4 text-xs">
                <div v-show="trainAlgorithm === 'linear_regression'" class="space-y-2">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {{ t('aiStudio.fsAdvGroupRidge') }}
                  </div>
                  <div>
                    <div :class="ui.label">{{ t('aiStudio.fsAdvRidgeLambda') }}</div>
                    <input
                      v-model="featureStoreTrainingOptions.ridgeLambda"
                      type="number"
                      :min="1e-12"
                      :max="1"
                      step="any"
                      :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                      class="mt-1 w-full max-w-xs rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                </div>
                <div v-show="trainAlgorithm === 'random_forest'" class="space-y-2">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {{ t('aiStudio.fsAdvGroupRf') }}
                  </div>
                  <div class="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvRfNTrees') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.randomForest.nTrees"
                        type="number"
                        :min="8"
                        :max="256"
                        step="1"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvRfMaxDepth') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.randomForest.maxDepth"
                        type="number"
                        :min="2"
                        :max="24"
                        step="1"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>
                <div v-show="trainAlgorithm === 'gradient_boosting'" class="space-y-2">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {{ t('aiStudio.fsAdvGroupGb') }}
                  </div>
                  <div class="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvGbRounds') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.gradientBoosting.rounds"
                        type="number"
                        :min="8"
                        :max="400"
                        step="1"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvGbTreeDepth') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.gradientBoosting.treeDepth"
                        type="number"
                        :min="1"
                        :max="12"
                        step="1"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvGbShrinkage') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.gradientBoosting.shrinkage"
                        type="number"
                        :min="0.01"
                        :max="0.5"
                        step="0.01"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>
                <div v-show="trainAlgorithm === 'neural_network'" class="space-y-2">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {{ t('aiStudio.fsAdvGroupNn') }}
                  </div>
                  <div class="grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvNnEpochs') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.neuralNetwork.epochs"
                        type="number"
                        :min="50"
                        :max="2000"
                        step="1"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                    <div>
                      <div :class="ui.label">{{ t('aiStudio.fsAdvNnLr') }}</div>
                      <input
                        v-model="featureStoreTrainingOptions.neuralNetwork.lr"
                        type="number"
                        :min="0.001"
                        :max="0.5"
                        step="any"
                        :placeholder="t('aiStudio.fsAdvPlaceholderDefault')"
                        class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-200"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </details>
            <div :class="ui.label">{{ t('aiStudio.featuresX') }}</div>
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
            <div
              v-if="studioDataset === 'FEATURE_STORE' && trainingStep === 3"
              class="mt-3 space-y-2"
              data-testid="ai-studio-fs-feature-quality"
            >
              <div
                v-if="fsQualityLevel === 'loading'"
                class="rounded-md border border-slate-700 bg-slate-950/50 px-3 py-2 text-[11px] text-slate-400"
              >
                {{ t('aiStudio.fsQualityLoading') }}
              </div>
              <div
                v-else-if="fsQualityLevel === 'pending' && trainFeatures.length > 0"
                class="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500"
              >
                {{ t('aiStudio.fsQualityPending') }}
              </div>
              <div
                v-else-if="fsQualityLevel === 'empty'"
                class="rounded-md border border-rose-900/55 bg-rose-950/25 px-3 py-2 text-[11px] text-rose-100/90"
              >
                {{ t('aiStudio.fsQualityEmpty') }}
              </div>
              <div
                v-else-if="fsQualityLevel === 'excellent'"
                class="rounded-md border border-emerald-800/55 bg-emerald-950/25 px-3 py-2 text-[11px] text-emerald-100/95"
              >
                {{ t('aiStudio.fsQualityExcellent') }}
              </div>
              <div
                v-else-if="fsQualityLevel === 'warning' && fsQualityWorstWarning"
                class="rounded-md border border-amber-800/55 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100/95"
              >
                {{
                  t('aiStudio.fsQualityWarning', {
                    feature: fsQualityWorstWarning.feature,
                    presentPct: (100 * fsQualityWorstWarning.coverage).toFixed(1),
                  })
                }}
              </div>
              <div
                v-else-if="fsQualityLevel === 'critical' && fsQualityWorstCritical"
                class="rounded-md border border-rose-800/55 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-100/95"
              >
                <p>
                  {{
                    t('aiStudio.fsQualityCritical', {
                      feature: fsQualityWorstCritical.feature,
                      presentPct: (100 * fsQualityWorstCritical.coverage).toFixed(1),
                    })
                  }}
                </p>
                <p class="mt-1 font-medium">{{ t('aiStudio.fsQualityCriticalCurveHint') }}</p>
              </div>
            </div>
          </div>
        </div>

        <div v-show="trainingStep === 4" class="mt-6 space-y-3">
          <div class="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm">
            <div class="font-medium text-slate-200">{{ t('aiStudio.jobTitle') }}</div>
            <div class="mt-1 text-xs text-slate-400">{{ lastTrainStatusMessage || t('aiStudio.jobIdle') }}</div>
            <div v-if="lastTrainStatusAt" class="mt-1 text-[11px] text-slate-500">
              {{ formatDateTime(lastTrainStatusAt) }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
            :disabled="trainingStep === 1"
            @click="goTrainingStep((Math.max(1, trainingStep - 1) as 1 | 2 | 3 | 4))"
          >
            {{ t('aiStudio.wizardBack') }}
          </button>
          <button
            v-if="trainingStep < 4"
            type="button"
            class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
            :disabled="
              (trainingStep === 1 && !canGoTrainingStep2) ||
              (trainingStep === 2 && !canGoTrainingStep3) ||
              (trainingStep === 3 && !canGoTrainingStep4)
            "
            @click="goTrainingStep((Math.min(4, trainingStep + 1) as 1 | 2 | 3 | 4))"
          >
            {{ t('aiStudio.wizardNext') }}
          </button>
          <button
            v-if="trainingStep === 4"
            type="button"
            class="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!parkCtx.activeParkId || !canTrain || trainSubmitting || trainFeatures.length === 0"
            @click="submitTrain"
          >
            {{ trainSubmitting ? t('aiStudio.training') : t('aiStudio.runTrain') }}
          </button>
          <span v-if="!canTrain" class="text-xs text-slate-500">{{ t('aiStudio.needRefresh') }}</span>
        </div>

        <div v-if="detailModel && !detailLoading" class="mt-8 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.metricsChart') }}</h3>
            <AiStudioMetricsBarChart
              :key="detailModel.id"
              class="mt-2 block"
              :mae="detailModel.mae"
              :rmse="detailModel.rmse"
              :r2="detailModel.r2"
            />
            <div
              v-if="detailFeatureStoreParamsSummary != null"
              class="mt-4 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
            >
              <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {{ t('aiStudio.fsUsedParamsTitle') }}
              </div>
              <p class="mt-1 text-sm text-slate-200">{{ detailFeatureStoreParamsSummary }}</p>
            </div>
            <div v-if="Object.keys(detailFeatureImportanceChartData).length > 0" class="mt-4">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {{ t('aiStudio.fsFeatureImportanceTitle') }}
              </h3>
              <p class="mt-1 text-[11px] text-slate-500">{{ t('aiStudio.fsFeatureImportanceHint') }}</p>
              <AiStudioFeatureImportanceBarChart
                :key="`${detailModel.id}-train-fi`"
                class="mt-2 block h-72 min-h-[12rem] w-full min-w-0"
                :data="detailFeatureImportanceChartData"
                display-as-percent
              />
            </div>
          </div>
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('aiStudio.predVsActual') }}</h3>
            <AiStudioHoldoutLineChart
              v-if="holdoutPoints.length > 0"
              :key="detailModel.id"
              class="mt-2 block"
              :points="holdoutPoints"
            />
            <p
              v-else
              class="mt-2 rounded border border-slate-800 bg-slate-950/50 px-3 py-10 text-center text-sm text-slate-500"
            >
              {{ t('aiStudio.holdoutEmpty') }}
            </p>
          </div>
        </div>
      </section>

      <section v-show="activeTab === 'importance'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.importanceTitle') }}</h2>
        <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.importanceUsesActiveModel') }}</p>
        <div v-if="detailLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <AiStudioFeatureImportanceBarChart
          v-else-if="detailModel && Object.keys(detailFeatureImportanceChartData).length > 0"
          :key="detailModel.id"
          class="mt-6 block h-80 w-full min-w-0"
          :data="detailFeatureImportanceChartData"
          display-as-percent
        />
        <p v-else-if="detailModel" class="mt-6 text-sm text-slate-500">{{ t('aiStudio.explainabilityEmpty') }}</p>
        <p v-else class="mt-6 text-sm text-slate-500">{{ t('aiStudio.importanceRequiresModel') }}</p>
      </section>

      <section v-show="activeTab === 'registry'" :class="ui.card">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 :class="ui.h2">{{ t('aiStudio.registryTitle') }}</h2>
          <div class="flex flex-wrap items-center gap-2">
            <template v-if="registryBulkSelectMode && canTrain && models.length && !modelsLoading">
              <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                :disabled="bulkActionBusy"
                data-testid="ai-studio-registry-select-all-top"
                @click="selectAllRegistryEligible"
              >
                {{ t('aiStudio.registryBulkSelectAll') }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                :disabled="bulkActionBusy"
                data-testid="ai-studio-registry-deselect-all-top"
                @click="clearRegistryBulkSelection"
              >
                {{ t('aiStudio.registryBulkDeselectAll') }}
              </button>
            </template>
            <button
              type="button"
              class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
              :disabled="modelsLoading || !parkCtx.activeParkId"
              @click="loadModels"
            >
              {{ t('btn.refresh') }}
            </button>
          </div>
        </div>
        <p v-if="models.length && !modelsLoading" class="mt-2 text-[11px] text-slate-500">{{ t('aiStudio.registrySortHint') }}</p>
        <p
          v-if="!canTrain && parkCtx.activeParkId"
          class="mt-2 rounded border border-amber-500/35 bg-amber-950/45 px-3 py-2 text-xs text-amber-100"
        >
          {{ t('aiStudio.registryActionsNeedRefresh') }}
        </p>
        <div
          class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800/80 pt-3"
          data-testid="ai-studio-registry-bulk-toolbar"
        >
          <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              v-model="registryBulkSelectMode"
              type="checkbox"
              class="accent-brand-500"
              :disabled="!canTrain"
              data-testid="ai-studio-registry-bulk-mode"
            />
            {{ t('aiStudio.registryBulkMode') }}
          </label>
          <template v-if="registryBulkSelectMode">
            <span class="text-xs text-slate-500">{{ t('aiStudio.registryBulkSelectedCount', { n: registrySelectedIds.length }) }}</span>
            <button
              v-if="canTrain"
              type="button"
              class="rounded bg-amber-700/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              :disabled="registrySelectedIds.length === 0 || bulkActionBusy"
              data-testid="ai-studio-registry-bulk-archive"
              @click="openBulkArchiveConfirm"
            >
              {{ t('aiStudio.registryBulkArchiveSelected') }}
            </button>
            <button
              v-if="canTrain"
              type="button"
              class="rounded border border-slate-500 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              :disabled="registrySelectedIds.length === 0 || bulkActionBusy"
              data-testid="ai-studio-registry-bulk-restore"
              @click="openBulkRestoreConfirm"
            >
              {{ t('aiStudio.registryBulkRestoreSelected') }}
            </button>
            <button
              v-if="canTrain"
              type="button"
              class="rounded bg-rose-900/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              :disabled="registrySelectedIds.length === 0 || bulkActionBusy"
              data-testid="ai-studio-registry-bulk-purge"
              @click="openBulkPurgeConfirm"
            >
              {{ t('aiStudio.registryBulkPurgeSelected') }}
            </button>
          </template>
        </div>
        <div v-if="modelsLoading" class="mt-4 text-sm text-slate-400">{{ t('aiStudio.loading') }}</div>
        <p v-else-if="modelsError" class="mt-4 rounded border border-rose-700/50 bg-rose-950/20 px-3 py-2 text-sm text-rose-200">
          {{ t('aiStudio.registryLoadError') }}
        </p>
        <div v-else class="mt-4 space-y-4">
          <div class="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
            <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.compareTitle') }}</h3>
            <div class="mt-2 grid gap-3 lg:grid-cols-2">
              <select v-model="compareModelAId" :class="ui.control">
                <option value="">{{ t('aiStudio.compareModelA') }}</option>
                <option v-for="m in models" :key="`a-${m.id}`" :value="m.id">
                  v{{ m.version }} · {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }}
                </option>
              </select>
              <select v-model="compareModelBId" :class="ui.control">
                <option value="">{{ t('aiStudio.compareModelB') }}</option>
                <option v-for="m in models" :key="`b-${m.id}`" :value="m.id">
                  v{{ m.version }} · {{ m.entityType }} / {{ m.modelScope }} / {{ m.targetVariable }}
                </option>
              </select>
            </div>
            <table v-if="compareModelA && compareModelB" class="mt-3 w-full text-sm">
              <thead>
                <tr :class="ui.tableHead">
                  <th class="py-1 pr-2">Metric</th>
                  <th class="py-1 pr-2">A</th>
                  <th class="py-1 pr-2">B</th>
                </tr>
              </thead>
              <tbody>
                <tr :class="ui.tableRow"><td :class="ui.tableCell">MAE</td><td :class="ui.tableCell">{{ compareModelA.mae ?? '—' }}</td><td :class="ui.tableCell">{{ compareModelB.mae ?? '—' }}</td></tr>
                <tr :class="ui.tableRow"><td :class="ui.tableCell">RMSE</td><td :class="ui.tableCell">{{ compareModelA.rmse ?? '—' }}</td><td :class="ui.tableCell">{{ compareModelB.rmse ?? '—' }}</td></tr>
                <tr :class="ui.tableRow"><td :class="ui.tableCell">R²</td><td :class="ui.tableCell">{{ compareModelA.r2 ?? '—' }}</td><td :class="ui.tableCell">{{ compareModelB.r2 ?? '—' }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="overflow-x-auto">
          <table class="w-full min-w-[1200px] text-left text-sm">
            <thead>
              <tr :class="ui.tableHead">
                <th v-if="registryBulkSelectMode" class="w-10 py-2 pr-2 pl-1"></th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('version')">
                    {{ t('aiStudio.colVersion') }}{{ registrySortIndicator('version') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('modelScope')">
                    {{ t('aiStudio.colScope') }}{{ registrySortIndicator('modelScope') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button
                    type="button"
                    :class="registrySortThClass"
                    :title="t('aiStudio.colEntityHint')"
                    @click="toggleRegistrySort('entity')"
                  >
                    {{ t('aiStudio.colEntity') }}{{ registrySortIndicator('entity') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('targetVariable')">
                    {{ t('aiStudio.colTarget') }}{{ registrySortIndicator('targetVariable') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('algorithm')">
                    {{ t('aiStudio.colAlgo') }}{{ registrySortIndicator('algorithm') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('trainingKind')">
                    {{ t('aiStudio.colTrainingKind') }}{{ registrySortIndicator('trainingKind') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('mae')">
                    MAE{{ registrySortIndicator('mae') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('rmse')">
                    RMSE{{ registrySortIndicator('rmse') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('r2')">
                    R²{{ registrySortIndicator('r2') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('bestEvalSlot')">
                    {{ t('aiStudio.colBestEvalSlot') }}{{ registrySortIndicator('bestEvalSlot') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('deployment')">
                    {{ t('aiStudio.colDeployment') }}{{ registrySortIndicator('deployment') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('active')">
                    {{ t('aiStudio.colActive') }}{{ registrySortIndicator('active') }}
                  </button>
                </th>
                <th class="py-2 pr-3">
                  <button type="button" :class="registrySortThClass" @click="toggleRegistrySort('governance')">
                    {{ t('aiStudio.colGovernance') }}{{ registrySortIndicator('governance') }}
                  </button>
                </th>
                <th class="py-2 pr-3 font-semibold text-slate-400">{{ t('aiStudio.colActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedRegistryModels" :key="row.id" :class="ui.tableRow">
                <td v-if="registryBulkSelectMode" class="py-2 pr-2 pl-1 align-middle">
                  <input
                    type="checkbox"
                    class="accent-brand-500"
                    :checked="registrySelectedIds.includes(row.id)"
                    :disabled="rowGovernanceStatus(row) === 'ACTIVE'"
                    :data-testid="'ai-studio-registry-row-select-' + row.id"
                    @change="toggleRegistryRowSelection(row)"
                  />
                </td>
                <td :class="ui.tableCell">v{{ row.version }}</td>
                <td :class="ui.tableCellMuted">{{ row.modelScope }}</td>
                <td
                  :class="ui.tableCellMuted"
                  class="max-w-[15rem]"
                  :title="registryEntityTitle(row)"
                  :data-testid="'ai-studio-registry-entity-' + (row.entityId || 'none')"
                >
                  <div class="leading-tight">
                    <div>
                      <span class="text-slate-400">{{ row.entityType }}</span>
                      <span v-if="row.entityId" class="ml-1 font-mono text-[10px] text-slate-500">{{
                        row.entityId.slice(0, 8)
                      }}…</span>
                      <span v-else class="ml-1 text-slate-500">*</span>
                    </div>
                    <div v-if="registryAssetDisplayName(row)" class="truncate text-[11px] font-medium text-slate-300">
                      {{ registryAssetDisplayName(row) }}
                    </div>
                  </div>
                </td>
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
                <td :class="ui.tableCell">{{ row.bestMaeInSlot ? t('aiStudio.bestEvalInSlotYes') : '—' }}</td>
                <td :class="ui.tableCellMuted">{{ registryDeploymentLabel(row) }}</td>
                <td :class="ui.tableCell">{{ row.activeFlag ? '✓' : '—' }}</td>
                <td :class="ui.tableCell">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    :class="{
                      'bg-emerald-900/50 text-emerald-200': rowGovernanceStatus(row) === 'ACTIVE',
                      'bg-slate-800 text-slate-300': rowGovernanceStatus(row) === 'CANDIDATE',
                      'bg-amber-900/40 text-amber-200': rowGovernanceStatus(row) === 'ARCHIVED',
                    }"
                    >{{ governanceBadgeLabel(row) }}</span
                  >
                </td>
                <td :class="ui.tableCell">
                  <div class="flex flex-wrap gap-2">
                    <template v-if="canTrain">
                      <button
                        v-if="rowGovernanceStatus(row) !== 'ARCHIVED'"
                        type="button"
                        class="text-brand-400 hover:text-brand-300"
                        @click="activateRow(row, !row.activeFlag)"
                      >
                        {{ row.activeFlag ? t('aiStudio.deactivate') : t('aiStudio.activate') }}
                      </button>
                      <button
                        v-if="!row.activeFlag && rowGovernanceStatus(row) === 'CANDIDATE'"
                        type="button"
                        class="text-amber-400 hover:text-amber-300"
                        @click="archiveConfirmRow = row"
                      >
                        {{ t('aiStudio.archiveModel') }}
                      </button>
                      <button
                        v-if="rowGovernanceStatus(row) === 'ARCHIVED'"
                        type="button"
                        class="text-slate-300 hover:text-white"
                        @click="restoreRow(row)"
                      >
                        {{ t('aiStudio.restoreModel') }}
                      </button>
                      <button
                        v-if="rowGovernanceStatus(row) === 'ARCHIVED'"
                        type="button"
                        class="text-rose-400 hover:text-rose-300"
                        data-testid="ai-studio-registry-purge"
                        @click="purgeConfirmRow = row"
                      >
                        {{ t('aiStudio.deletePermanent') }}
                      </button>
                    </template>
                    <span
                      v-else
                      class="max-w-[12rem] text-[10px] leading-snug text-slate-500"
                      :title="t('aiStudio.registryActionsNeedRefresh')"
                    >
                      {{ t('aiStudio.registryActionsNeedRefreshShort') }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!models.length && parkCtx.activeParkId" class="mt-4 text-sm text-slate-500">{{ t('aiStudio.emptyRegistry') }}</p>
          </div>
        </div>
        <div class="mt-6 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
          <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.auditTitle') }}</h3>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.auditHint') }}</p>
          <table v-if="auditEvents.length" class="mt-3 w-full text-sm">
            <thead>
              <tr :class="ui.tableHead">
                <th class="py-1 pr-2">{{ t('aiStudio.auditColTime') }}</th>
                <th class="py-1 pr-2">{{ t('aiStudio.auditColAction') }}</th>
                <th class="py-1 pr-2">{{ t('aiStudio.auditColDetail') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ev in auditEvents" :key="`${ev.at}-${ev.action}-${ev.detail}`" :class="ui.tableRow">
                <td :class="ui.tableCellMuted">{{ formatDateTime(ev.at) }}</td>
                <td :class="ui.tableCell">{{ ev.action }}</td>
                <td :class="ui.tableCellMuted">{{ ev.detail }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="mt-3 text-sm text-slate-500">{{ t('aiStudio.auditEmpty') }}</p>
        </div>
      </section>

      <section v-show="activeTab === 'predictions'" :class="ui.card">
        <h2 :class="ui.h2">{{ t('aiStudio.predictTitle') }}</h2>
        <p :class="ui.muted">{{ t('aiStudio.predictHint') }}</p>
        <p class="mt-2 text-sm text-slate-400">{{ t('aiStudio.bestVsActiveHelp') }}</p>

        <div
          class="mt-4 rounded-lg border border-slate-700 bg-slate-950/40 p-4"
          data-testid="ai-studio-runtime-resolution-panel"
        >
          <h3 class="text-sm font-semibold text-white">{{ t('aiStudio.runtimeResolutionTitle') }}</h3>
          <p class="mt-1 text-xs text-slate-500">{{ t('aiStudio.runtimeResolutionHint') }}</p>
          <p v-if="studioDataset === 'FEATURE_STORE'" class="mt-1 text-xs text-slate-500">
            {{ t('aiStudio.runtimeResolutionAutoHint') }}
          </p>
          <button
            type="button"
            class="mt-3 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            :disabled="!parkCtx.activeParkId || runtimeResolutionLoading"
            @click="loadRuntimeResolution"
          >
            {{ runtimeResolutionLoading ? '…' : t('aiStudio.runtimeResolutionLoad') }}
          </button>
          <p v-if="runtimeResolutionError" class="mt-2 text-xs text-rose-300">{{ runtimeResolutionError }}</p>
          <div v-if="runtimeResolution && !runtimeResolutionLoading" class="mt-4 space-y-3 text-sm">
            <p class="text-xs text-slate-500">{{ runtimeResolution.help.bestVsActive }}</p>
            <div class="rounded border border-slate-800 bg-slate-950/60 p-3">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {{ t('aiStudio.runtimeResolutionFinal') }}
              </div>
              <div class="mt-1 text-slate-200">
                <span class="font-mono text-brand-300">{{ runtimeResolution.final.level }}</span>
                —
                {{
                  runtimeResolution.final.model
                    ? `v${runtimeResolution.final.model.version} · ${runtimeResolution.final.model.algorithm}`
                    : t('aiStudio.runtimeResolutionNone')
                }}
              </div>
              <p class="mt-1 text-xs text-slate-400">{{ runtimeResolution.final.reason }}</p>
            </div>
            <div class="space-y-2">
              <div
                v-for="lvl in runtimeResolution.levels"
                :key="lvl.level"
                class="rounded border border-slate-800/80 p-2 text-xs"
              >
                <div class="font-semibold text-slate-300">{{ lvl.level }}</div>
                <p class="mt-1 text-slate-500">{{ lvl.reason }}</p>
                <div class="mt-1 grid gap-1 text-[11px] text-slate-400 lg:grid-cols-2">
                  <div>
                    <span class="text-slate-500">{{ t('aiStudio.runtimeResolutionActive') }}:</span>
                    {{
                      lvl.activeModel
                        ? `v${lvl.activeModel.version} · MAE ${lvl.activeModel.mae ?? '—'}`
                        : '—'
                    }}
                  </div>
                  <div>
                    <span class="text-slate-500">{{ t('aiStudio.runtimeResolutionBestMae') }}:</span>
                    {{
                      lvl.bestMaeModel
                        ? `v${lvl.bestMaeModel.version} · MAE ${lvl.bestMaeModel.mae ?? '—'}`
                        : '—'
                    }}
                  </div>
                </div>
              </div>
            </div>
            <p class="text-[11px] text-slate-500">{{ runtimeResolution.help.productionNote }}</p>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div :class="ui.label">{{ t('aiStudio.entityType') }}</div>
            <select v-model="predictEntityType" :class="ui.control">
              <option v-for="et in catalog?.entityTypes || []" :key="et.code" :value="et.code">{{ et.code }}</option>
            </select>
            <div :class="ui.label">{{ t('aiStudio.targetY') }}</div>
            <select v-model="predictTarget" :class="ui.control">
              <option v-for="tg in targetsForPredict" :key="tg" :value="tg">{{ tg }}</option>
            </select>
            <div :class="ui.label">{{ t('aiStudio.predictPickAsset') }}</div>
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
              <div class="block text-[11px] uppercase text-slate-500">{{ key }}</div>
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

    <div
      v-if="purgeConfirmRow"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      data-testid="ai-studio-purge-confirm"
    >
      <div class="max-w-md rounded-lg border border-rose-900/50 bg-slate-900 p-4 shadow-xl">
        <h3 class="text-lg font-semibold text-white">{{ t('aiStudio.confirmPurgeTitle') }}</h3>
        <p class="mt-2 text-sm text-slate-300">{{ t('aiStudio.confirmPurgeBody') }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            @click="purgeConfirmRow = null"
          >
            {{ t('aiStudio.confirmPurgeCancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500"
            @click="confirmPurgeModel"
          >
            {{ t('aiStudio.confirmPurgeOk') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="archiveConfirmRow"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      data-testid="ai-studio-archive-confirm"
    >
      <div class="max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
        <h3 class="text-lg font-semibold text-white">{{ t('aiStudio.confirmArchiveTitle') }}</h3>
        <p class="mt-2 text-sm text-slate-300">{{ t('aiStudio.confirmArchiveBody') }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            @click="archiveConfirmRow = null"
          >
            {{ t('aiStudio.confirmArchiveCancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
            @click="confirmArchiveModel"
          >
            {{ t('aiStudio.confirmArchiveOk') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="bulkActionModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      data-testid="ai-studio-bulk-action-confirm"
    >
      <div class="max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
        <template v-if="bulkActionModal.type === 'archive'">
          <h3 class="text-lg font-semibold text-white">{{ t('aiStudio.confirmBulkArchiveTitle') }}</h3>
          <p class="mt-2 text-sm text-slate-300">
            {{ t('aiStudio.confirmBulkArchiveBody', { count: bulkActionModal.rows.length }) }}
          </p>
          <p v-if="bulkActionModal.skipped > 0" class="mt-2 text-sm text-amber-200/90">
            {{ t('aiStudio.confirmBulkArchiveSkipped', { skipped: bulkActionModal.skipped }) }}
          </p>
        </template>
        <template v-else-if="bulkActionModal.type === 'restore'">
          <h3 class="text-lg font-semibold text-white">{{ t('aiStudio.confirmBulkRestoreTitle') }}</h3>
          <p class="mt-2 text-sm text-slate-300">
            {{ t('aiStudio.confirmBulkRestoreBody', { count: bulkActionModal.rows.length }) }}
          </p>
        </template>
        <template v-else>
          <h3 class="text-lg font-semibold text-white">{{ t('aiStudio.confirmBulkPurgeTitle') }}</h3>
          <p class="mt-2 text-sm text-slate-300">
            {{ t('aiStudio.confirmBulkPurgeBody', { count: bulkActionModal.rows.length }) }}
          </p>
          <p v-if="bulkActionModal.skipped > 0" class="mt-2 text-sm text-amber-200/90">
            {{ t('aiStudio.confirmBulkPurgeSkipped', { skipped: bulkActionModal.skipped }) }}
          </p>
        </template>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            :disabled="bulkActionBusy"
            @click="cancelBulkActionModal"
          >
            {{ bulkActionModal.type === 'purge' ? t('aiStudio.confirmPurgeCancel') : t('aiStudio.confirmArchiveCancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            :class="
              bulkActionModal.type === 'purge'
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-amber-600 hover:bg-amber-500'
            "
            :disabled="bulkActionBusy"
            @click="confirmBulkActionModal"
          >
            {{
              bulkActionModal.type === 'archive'
                ? t('aiStudio.confirmArchiveOk')
                : bulkActionModal.type === 'restore'
                  ? t('aiStudio.confirmBulkRestoreOk')
                  : t('aiStudio.confirmPurgeOk')
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
