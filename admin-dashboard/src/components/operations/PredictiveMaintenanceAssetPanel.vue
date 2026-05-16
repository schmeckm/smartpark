<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  listAssetPdmRules,
  createAssetPdmRule,
  patchAssetPdmRule,
  deleteAssetPdmRule,
  getAssetPredictiveMaintenance,
  getAssetPdmSparkplugMetrics,
  getAssetPdmSparkplugMetricSeries,
  listAssetPdmEvaluationLogs,
  type AssetPdmRuleRow,
  type AssetPdmSparkplugMetricRow,
  type AssetPredictiveMaintenancePayload,
  type AssetPdmEvaluationLogRow,
  type PdmIndustrialEvaluation,
} from '@/api/client'
import PredictiveMaintenanceMetricSeriesChart from '@/components/operations/PredictiveMaintenanceMetricSeriesChart.vue'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import { ISO_MEASUREMENT_UNIT_GROUPS, PDM_UNIT_CHOICE_CUSTOM } from '@/constants/isoMeasurementUnits'

const props = defineProps<{
  assetId: string
  canUpdate: boolean
  /**
   * When true, evaluation text/table comes from `parentEvaluation` (e.g. add-on board ride detail).
   * Emit `refresh-requested` after rule changes so the parent can reload that payload.
   */
  usesParentEvaluation?: boolean
  parentEvaluation?: AssetPredictiveMaintenancePayload | null
}>()

const emit = defineEmits<{
  'refresh-requested': []
}>()

const { t } = useI18n()
const { push } = useToast()

const pdmRules = ref<AssetPdmRuleRow[]>([])
const pdmRulesLoading = ref(false)
const pdmFormBusy = ref(false)
const pdmNewMetric = ref('')
const pdmNewLabel = ref('')
const pdmNewWarnAbove = ref('')
const pdmNewCritAbove = ref('')
const pdmNewWarnBelow = ref('')
const pdmNewCritBelow = ref('')
/** Empty = no unit; otherwise symbol from ISO list or custom text */
const pdmUnitChoice = ref('')
const pdmUnitCustom = ref('')
/** Composite key metricName + unit separator + deviceId from live MQTT dropdown (empty = none). */
const liveMetricPick = ref('')
const liveMetrics = ref<AssetPdmSparkplugMetricRow[]>([])
const liveMetricsLoading = ref(false)
const metricsPayloadSimulated = ref(false)

const seriesPoints = ref<Array<{ t: string; v: number }>>([])
const seriesSource = ref<'live' | 'simulated' | 'none'>('none')
const seriesLoading = ref(false)
const seriesEdgeMeta = shallowRef<{
  seriesResolvedEdgeNodeId?: string | null
  attemptedEdgeNodeIds?: string[]
  simulatedFallback?: boolean
} | null>(null)

const sparkplugEdgeDebug = shallowRef<{
  resolvedEdgeNodeId?: string
  edgeResolutionSource?: string
  attemptedEdgeNodeIds?: string[]
} | null>(null)

/** Separates metric name and Sparkplug device id in `<select>` option values (metric names are never expected to contain this character). */
const LIVE_METRIC_KEY_SEP = '\u001f'

function liveMetricOptionValue(m: AssetPdmSparkplugMetricRow) {
  return `${m.metricName}${LIVE_METRIC_KEY_SEP}${m.sparkplugDeviceId}`
}

function formatSparkplugLastValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 117)}…` : v
  if (typeof v === 'bigint') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const pickedLiveMetricRow = computed((): AssetPdmSparkplugMetricRow | null => {
  const key = String(liveMetricPick.value || '').trim()
  if (!key) return null
  if (key.includes(LIVE_METRIC_KEY_SEP)) {
    const i = key.indexOf(LIVE_METRIC_KEY_SEP)
    const name = key.slice(0, i)
    const dev = key.slice(i + LIVE_METRIC_KEY_SEP.length)
    return liveMetrics.value.find((m) => m.metricName === name && m.sparkplugDeviceId === dev) ?? null
  }
  return liveMetrics.value.find((m) => m.metricName === key) ?? null
})

const selfEvaluation = ref<AssetPredictiveMaintenancePayload | null>(null)
const selfEvalLoading = ref(false)

const pdmLogs = ref<AssetPdmEvaluationLogRow[]>([])
const pdmLogsLoading = ref(false)

const pdmMetricDatalistId = computed(() => `pdm-metric-dl-${props.assetId.replace(/[^a-zA-Z0-9_-]/g, '-')}`)

function resolvedPdmUnit(): string | null {
  const c = pdmUnitChoice.value
  if (!c) return null
  if (c === PDM_UNIT_CHOICE_CUSTOM) {
    const t = pdmUnitCustom.value.trim()
    return t || null
  }
  return c
}

const displayEvaluation = computed((): AssetPredictiveMaintenancePayload | null => {
  if (props.usesParentEvaluation) {
    const p = props.parentEvaluation
    if (!p || typeof p !== 'object') return null
    return p
  }
  return selfEvaluation.value
})

function pdmRiskClass(risk: string) {
  if (risk === 'CRITICAL') return 'text-rose-400'
  if (risk === 'HIGH') return 'text-amber-300'
  if (risk === 'MEDIUM') return 'text-sky-300'
  return 'text-slate-400'
}

function formatEvaluatedAt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(d)
}

function historySourceLabel(src: string) {
  if (src === 'pdm_api') return t('pdmPage.historySourcePdmApi')
  if (src === 'addon_board') return t('pdmPage.historySourceAddonBoard')
  return src?.trim() ? src : t('pdmPage.historySourceOther')
}

function historySummary(log: AssetPdmEvaluationLogRow) {
  const title = log.snapshot?.recommendation?.title
  return typeof title === 'string' && title.trim() ? title.trim() : '—'
}

async function loadPdmLogs() {
  if (!props.assetId) {
    pdmLogs.value = []
    return
  }
  pdmLogsLoading.value = true
  try {
    const res = await listAssetPdmEvaluationLogs(props.assetId, { limit: 40 })
    pdmLogs.value = res.logs ?? []
  } catch {
    pdmLogs.value = []
    push(t('pdmPage.historyLoadFailed'), 'error')
  } finally {
    pdmLogsLoading.value = false
  }
}

async function loadPdmRules() {
  if (!props.assetId) {
    pdmRules.value = []
    return
  }
  pdmRulesLoading.value = true
  try {
    const res = await listAssetPdmRules(props.assetId)
    pdmRules.value = res.rules ?? []
  } catch {
    pdmRules.value = []
    push(t('addonBoard.pdmRulesLoadFailed'), 'error')
  } finally {
    pdmRulesLoading.value = false
  }
}

async function loadSelfEvaluation() {
  if (props.usesParentEvaluation || !props.assetId) return
  selfEvalLoading.value = true
  try {
    const res = await getAssetPredictiveMaintenance(props.assetId)
    selfEvaluation.value = res.evaluation ?? null
  } catch {
    selfEvaluation.value = null
    push(t('pdmPage.evalLoadFailed'), 'error')
  } finally {
    selfEvalLoading.value = false
  }
}

watch(
  () => props.assetId,
  () => {
    liveMetricPick.value = ''
    liveMetrics.value = []
    metricsPayloadSimulated.value = false
    seriesPoints.value = []
    seriesSource.value = 'none'
    seriesEdgeMeta.value = null
    sparkplugEdgeDebug.value = null
    void loadPdmRules()
    void loadLiveSparkplugMetrics()
    void (async () => {
      if (!props.usesParentEvaluation) await loadSelfEvaluation()
      await loadPdmLogs()
    })()
  },
  { immediate: true }
)

watch(liveMetricPick, (v) => {
  const raw = String(v || '').trim()
  if (!raw) return
  if (raw.includes(LIVE_METRIC_KEY_SEP)) {
    const i = raw.indexOf(LIVE_METRIC_KEY_SEP)
    pdmNewMetric.value = raw.slice(0, i)
  } else {
    pdmNewMetric.value = raw
  }
})

async function loadLiveSparkplugMetrics() {
  if (!props.assetId) {
    liveMetrics.value = []
    metricsPayloadSimulated.value = false
    sparkplugEdgeDebug.value = null
    return
  }
  liveMetricsLoading.value = true
  try {
    const data = await getAssetPdmSparkplugMetrics(props.assetId)
    liveMetrics.value = Array.isArray(data.metrics) ? data.metrics : []
    metricsPayloadSimulated.value = Boolean(data.simulatedFallback)
    sparkplugEdgeDebug.value = {
      resolvedEdgeNodeId: data.resolvedEdgeNodeId ?? data.edgeNodeId,
      edgeResolutionSource: data.edgeResolutionSource,
      attemptedEdgeNodeIds: data.attemptedEdgeNodeIds,
    }
  } catch {
    liveMetrics.value = []
    metricsPayloadSimulated.value = false
    sparkplugEdgeDebug.value = null
    push(t('pdmPage.knownMetricsLoadFailed'), 'error')
  } finally {
    liveMetricsLoading.value = false
  }
}

async function loadMetricSeries() {
  const row = pickedLiveMetricRow.value
  if (!props.assetId || !row) {
    seriesPoints.value = []
    seriesSource.value = 'none'
    seriesEdgeMeta.value = null
    return
  }
  seriesLoading.value = true
  try {
    const res = await getAssetPdmSparkplugMetricSeries(props.assetId, {
      metricName: row.metricName,
      sparkplugDeviceId: row.sparkplugDeviceId,
      points: 72,
      stepSeconds: 300,
    })
    seriesPoints.value = Array.isArray(res.points) ? res.points : []
    seriesSource.value = res.seriesSource ?? 'none'
    seriesEdgeMeta.value = {
      seriesResolvedEdgeNodeId: res.seriesResolvedEdgeNodeId,
      attemptedEdgeNodeIds: res.attemptedEdgeNodeIds,
      simulatedFallback: res.simulatedFallback,
    }
  } catch {
    seriesPoints.value = []
    seriesSource.value = 'none'
    seriesEdgeMeta.value = null
    push(t('pdmPage.seriesLoadFailed'), 'error')
  } finally {
    seriesLoading.value = false
  }
}

watch(
  () => pickedLiveMetricRow.value,
  () => {
    void loadMetricSeries()
  },
  { deep: true }
)

function parseOptionalNum(s: string): number | null {
  const x = s.trim()
  if (!x) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

const pdmRuleDraftHasChanges = computed(() => {
  if (String(liveMetricPick.value || '').trim()) return true
  if (pdmNewMetric.value.trim()) return true
  if (pdmNewLabel.value.trim()) return true
  if (pdmNewWarnAbove.value.trim()) return true
  if (pdmNewCritAbove.value.trim()) return true
  if (pdmNewWarnBelow.value.trim()) return true
  if (pdmNewCritBelow.value.trim()) return true
  if (pdmUnitChoice.value) return true
  return false
})

const pdmRuleDraftCanSave = computed(() => {
  if (!props.canUpdate || pdmFormBusy.value) return false
  const metricName = pdmNewMetric.value.trim()
  if (!metricName) return false
  const wa = parseOptionalNum(pdmNewWarnAbove.value)
  const ca = parseOptionalNum(pdmNewCritAbove.value)
  const wb = parseOptionalNum(pdmNewWarnBelow.value)
  const cb = parseOptionalNum(pdmNewCritBelow.value)
  return wa != null || ca != null || wb != null || cb != null
})

function resetPdmRuleDraft() {
  liveMetricPick.value = ''
  pdmNewMetric.value = ''
  pdmNewLabel.value = ''
  pdmNewWarnAbove.value = ''
  pdmNewCritAbove.value = ''
  pdmNewWarnBelow.value = ''
  pdmNewCritBelow.value = ''
  pdmUnitChoice.value = ''
  pdmUnitCustom.value = ''
}

async function submitPdmRule() {
  if (!props.assetId || !props.canUpdate) return
  const metricName = pdmNewMetric.value.trim()
  if (!metricName) {
    push(t('addonBoard.pdmMetricRequired'), 'error')
    return
  }
  const wa = parseOptionalNum(pdmNewWarnAbove.value)
  const ca = parseOptionalNum(pdmNewCritAbove.value)
  const wb = parseOptionalNum(pdmNewWarnBelow.value)
  const cb = parseOptionalNum(pdmNewCritBelow.value)
  if (wa == null && ca == null && wb == null && cb == null) {
    push(t('addonBoard.pdmThresholdRequired'), 'error')
    return
  }
  pdmFormBusy.value = true
  try {
    await createAssetPdmRule(props.assetId, {
      metricName,
      label: pdmNewLabel.value.trim() || null,
      warnAbove: wa,
      criticalAbove: ca,
      warnBelow: wb,
      criticalBelow: cb,
      unit: resolvedPdmUnit(),
    })
    push(t('addonBoard.pdmRuleSaved'), 'success')
    pdmNewMetric.value = ''
    pdmNewLabel.value = ''
    pdmNewWarnAbove.value = ''
    pdmNewCritAbove.value = ''
    pdmNewWarnBelow.value = ''
    pdmNewCritBelow.value = ''
    pdmUnitChoice.value = ''
    pdmUnitCustom.value = ''
    liveMetricPick.value = ''
    await loadPdmRules()
    if (props.usesParentEvaluation) emit('refresh-requested')
    else await loadSelfEvaluation()
    await loadPdmLogs()
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.pdmRuleSaveFailed'), 'error')
  } finally {
    pdmFormBusy.value = false
  }
}

async function removePdmRule(rule: AssetPdmRuleRow) {
  if (!props.assetId || !props.canUpdate) return
  const ok = await askConfirm({
    message: t('addonBoard.pdmDeleteConfirm'),
    confirmLabel: t('addonBoard.customWidgetRemove'),
    cancelLabel: t('addonBoard.customWidgetCancelRename'),
    variant: 'danger',
  })
  if (!ok) return
  pdmFormBusy.value = true
  try {
    await deleteAssetPdmRule(props.assetId, rule.id)
    push(t('addonBoard.pdmRuleDeleted'), 'success')
    await loadPdmRules()
    if (props.usesParentEvaluation) emit('refresh-requested')
    else await loadSelfEvaluation()
    await loadPdmLogs()
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.pdmRuleDeleteFailed'), 'error')
  } finally {
    pdmFormBusy.value = false
  }
}

async function togglePdmRuleEnabled(rule: AssetPdmRuleRow, ev: Event) {
  if (!props.assetId || !props.canUpdate) return
  const el = ev.target as HTMLInputElement | null
  const next = el?.checked ?? !rule.enabled
  try {
    await patchAssetPdmRule(props.assetId, rule.id, { enabled: next })
    await loadPdmRules()
    if (props.usesParentEvaluation) emit('refresh-requested')
    else await loadSelfEvaluation()
    await loadPdmLogs()
  } catch (e) {
    push(e instanceof Error ? e.message : t('addonBoard.pdmToggleFailed'), 'error')
    if (el) el.checked = rule.enabled
  }
}

const evalBlock = computed(() => displayEvaluation.value)

const industrialBlock = computed((): PdmIndustrialEvaluation | null => {
  const e = displayEvaluation.value
  const ind = e && typeof e === 'object' ? e.industrial : null
  return ind && typeof ind === 'object' ? ind : null
})
</script>

<template>
  <div class="rounded-lg border border-slate-700 bg-slate-900/45 p-4" data-testid="predictive-maintenance-asset-panel">
    <p class="text-sm font-semibold text-white">{{ t('addonBoard.pdmSectionTitle') }}</p>
    <p class="mt-1 text-xs text-slate-500">{{ t('addonBoard.pdmSectionHint') }}</p>

    <p v-if="!usesParentEvaluation && selfEvalLoading" class="mt-3 text-xs text-slate-500">…</p>

    <div v-else-if="evalBlock" class="mt-3 rounded-md border border-slate-700/80 bg-slate-950/35 p-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-slate-500">{{ t('addonBoard.pdmRisk') }}:</span>
        <span class="font-semibold" :class="pdmRiskClass(evalBlock.riskLevel)">{{ evalBlock.riskLevel }}</span>
        <span class="text-xs text-slate-500">({{ evalBlock.enabledRuleCount }} rules)</span>
      </div>
      <p class="mt-2 font-medium text-slate-200">
        {{ t('addonBoard.pdmRecommendation') }}: {{ evalBlock.recommendation.title }}
      </p>
      <p class="mt-1 text-xs text-slate-400">{{ evalBlock.recommendation.detail }}</p>

      <div
        v-if="industrialBlock?.health"
        class="mt-3 grid gap-2 rounded-md border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-xs sm:grid-cols-2"
        data-testid="pdm-industrial-health"
      >
        <div>
          <span class="text-slate-500">{{ t('pdmPage.industrialHealthTitle') }}</span>
          <span class="ml-2 font-semibold text-emerald-200">{{ industrialBlock.health.healthScore }}</span>
          <span class="ml-2 text-slate-400">{{ industrialBlock.health.healthState }}</span>
        </div>
        <div class="text-slate-400">
          {{ t('pdmPage.colTrend') }}: <span class="text-slate-200">{{ industrialBlock.health.healthTrend }}</span> ·
          {{ industrialBlock.health.confidence }}
        </div>
        <div v-if="industrialBlock.rideTelemetryProfile?.rideType" class="sm:col-span-2 text-slate-500">
          {{ t('pdmPage.industrialProfileLabel') }}:
          <span class="font-mono text-slate-300">{{ industrialBlock.rideTelemetryProfile.rideType }}</span>
        </div>
      </div>

      <div v-if="(industrialBlock?.failureModes || []).length" class="mt-3 text-xs">
        <p class="font-medium uppercase tracking-wide text-slate-500">{{ t('pdmPage.industrialFailureModes') }}</p>
        <ul class="mt-1 list-inside list-disc text-slate-400">
          <li v-for="(fm, i) in industrialBlock?.failureModes || []" :key="i">
            <span class="text-slate-200">{{ String((fm as Record<string, unknown>).label || (fm as Record<string, unknown>).code) }}</span>
            <span class="text-slate-500"> — {{ String((fm as Record<string, unknown>).severity || '') }}</span>
          </li>
        </ul>
      </div>

      <div v-if="(industrialBlock?.structuredRecommendations || []).length" class="mt-3 text-xs">
        <p class="font-medium uppercase tracking-wide text-slate-500">{{ t('pdmPage.industrialRecommendations') }}</p>
        <ul class="mt-1 space-y-1 text-slate-400">
          <li v-for="(rec, i) in industrialBlock?.structuredRecommendations || []" :key="i">
            <span class="font-medium text-slate-200">{{ String((rec as Record<string, unknown>).action) }}</span>
            <span class="text-slate-500"> ({{ String((rec as Record<string, unknown>).priority) }})</span>
          </li>
        </ul>
      </div>

      <div v-if="industrialBlock?.telemetryQuality" class="mt-3 text-xs text-slate-500">
        <span class="font-medium uppercase tracking-wide text-slate-500">{{ t('pdmPage.industrialTelemetryQuality') }}:</span>
        <span class="ml-2 font-mono text-slate-300">{{
          String((industrialBlock.telemetryQuality as Record<string, unknown>).overall || '')
        }}</span>
      </div>

      <details
        v-if="(industrialBlock?.sparkplugContext as Record<string, unknown> | undefined)?.topicPreview"
        class="mt-3 text-xs text-slate-500"
      >
        <summary class="cursor-pointer text-slate-500 hover:text-slate-400">{{ t('pdmPage.industrialSparkplugTopics') }}</summary>
        <ul class="mt-2 max-h-40 overflow-auto font-mono text-[10px]">
          <li
            v-for="(tp, i) in ((industrialBlock?.sparkplugContext as Record<string, unknown> | undefined)?.topicPreview as unknown[] | undefined) || []"
            :key="i"
          >
            {{ String((tp as Record<string, unknown>).exampleTopic || '') }}
          </li>
        </ul>
      </details>

      <div v-if="evalBlock.signals?.length" class="mt-3 overflow-x-auto">
        <table class="min-w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-700 text-slate-500">
              <th class="py-1 pr-3">{{ t('addonBoard.pdmMetric') }}</th>
              <th class="py-1 pr-3">{{ t('pdmPage.colTrend') }}</th>
              <th class="py-1 pr-3">{{ t('addonBoard.pdmLiveValue') }}</th>
              <th class="py-1">{{ t('addonBoard.pdmStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(s, i) in evalBlock.signals"
              :key="i"
              class="border-b border-slate-800/80 text-slate-300"
            >
              <td class="py-1 pr-3 font-mono">{{ s.label || s.metricName }}</td>
              <td class="py-1 pr-3 font-mono text-slate-400">
                {{ s.trendArrow || '→' }} {{ s.metricTrend || '—' }}
                <span
                  v-if="s.telemetrySource === 'simulated'"
                  class="ml-1 rounded bg-amber-950/40 px-1 text-[10px] text-amber-300"
                  >{{ t('pdmPage.metricDemoTag') }}</span
                >
              </td>
              <td class="py-1 pr-3">{{ s.value != null ? s.value : '—' }}</td>
              <td
                class="py-1"
                :class="
                  pdmRiskClass(
                    s.status === 'CRITICAL'
                      ? 'CRITICAL'
                      : s.status === 'WARN'
                        ? 'HIGH'
                        : s.status === 'NO_DATA'
                          ? 'MEDIUM'
                          : 'LOW'
                  )
                "
              >
                {{ s.status }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p v-else-if="!pdmRulesLoading && !pdmRules.length" class="mt-3 text-xs text-slate-500">
      {{ t('addonBoard.pdmNoRules') }}
    </p>

    <div class="mt-4 border-t border-slate-800 pt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('addonBoard.pdmRules') }}</p>
      <p v-if="pdmRulesLoading" class="mt-2 text-xs text-slate-500">…</p>
      <div v-else-if="pdmRules.length" class="mt-2 overflow-x-auto">
        <table class="min-w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-700 text-slate-500">
              <th class="py-1 pr-2">{{ t('addonBoard.pdmMetric') }}</th>
              <th class="py-1 pr-2">≥w / ≥c</th>
              <th class="py-1 pr-2">≤w / ≤c</th>
              <th class="py-1 pr-2">on</th>
              <th class="py-1" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in pdmRules" :key="rule.id" class="border-b border-slate-800/80 text-slate-300">
              <td class="py-1 pr-2 font-mono">{{ rule.metricName }}</td>
              <td class="py-1 pr-2">{{ rule.warnAbove ?? '—' }} / {{ rule.criticalAbove ?? '—' }}</td>
              <td class="py-1 pr-2">{{ rule.warnBelow ?? '—' }} / {{ rule.criticalBelow ?? '—' }}</td>
              <td class="py-1 pr-2">
                <input
                  type="checkbox"
                  :checked="rule.enabled"
                  :disabled="!canUpdate || pdmFormBusy"
                  @change="togglePdmRuleEnabled(rule, $event)"
                />
              </td>
              <td class="py-1 text-right">
                <button
                  v-if="canUpdate"
                  type="button"
                  class="text-rose-300 hover:underline disabled:opacity-50"
                  :disabled="pdmFormBusy"
                  @click="removePdmRule(rule)"
                >
                  {{ t('addonBoard.customWidgetRemove') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="mt-4 border-t border-slate-800 pt-4">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('pdmPage.historyTitle') }}</p>
      <p class="mt-1 text-[11px] leading-snug text-slate-500">{{ t('pdmPage.historyHint') }}</p>
      <p v-if="pdmLogsLoading" class="mt-2 text-xs text-slate-500">…</p>
      <p v-else-if="!pdmLogs.length" class="mt-2 text-xs text-slate-500">{{ t('pdmPage.historyEmpty') }}</p>
      <div v-else class="mt-2 overflow-x-auto">
        <table class="min-w-full text-left text-xs">
          <thead>
            <tr class="border-b border-slate-700 text-slate-500">
              <th class="py-1 pr-3">{{ t('pdmPage.historyColTime') }}</th>
              <th class="py-1 pr-3">{{ t('pdmPage.historyColRisk') }}</th>
              <th class="py-1 pr-3">{{ t('pdmPage.historyColSource') }}</th>
              <th class="py-1">{{ t('pdmPage.historyColSummary') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in pdmLogs" :key="log.id" class="border-b border-slate-800/80 text-slate-300">
              <td class="py-1 pr-3 whitespace-nowrap text-slate-400">{{ formatEvaluatedAt(log.evaluatedAt) }}</td>
              <td class="py-1 pr-3 font-semibold" :class="pdmRiskClass(log.riskLevel)">{{ log.riskLevel }}</td>
              <td class="py-1 pr-3 text-slate-400">{{ historySourceLabel(log.source) }}</td>
              <td class="py-1 text-slate-300">{{ historySummary(log) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="canUpdate"
      class="mt-4 grid gap-2 rounded-md border border-slate-700/80 bg-slate-950/25 p-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
        <label class="block min-w-[12rem] flex-1 text-xs text-slate-400" for="pdm-live-metric-select">
          {{ t('pdmPage.knownMetricsPick') }}
          <select
            id="pdm-live-metric-select"
            v-model="liveMetricPick"
            class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white"
            :disabled="liveMetricsLoading || pdmFormBusy"
          >
            <option value="">{{ liveMetricsLoading ? '…' : t('pdmPage.knownMetricsPlaceholder') }}</option>
            <option
              v-for="m in liveMetrics"
              :key="`${m.sparkplugDeviceId}\0${m.metricName}`"
              :value="liveMetricOptionValue(m)"
            >
              {{ m.metricName }} — {{ m.sparkplugDeviceId
              }}{{ m.source === 'simulated' ? ` (${t('pdmPage.metricDemoTag')})` : '' }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="mb-0.5 rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          :disabled="liveMetricsLoading || pdmFormBusy || !assetId"
          @click="loadLiveSparkplugMetrics"
        >
          {{ t('pdmPage.knownMetricsRefresh') }}
        </button>
      </div>
      <div
        v-if="sparkplugEdgeDebug?.resolvedEdgeNodeId && !liveMetricsLoading"
        class="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-400 sm:col-span-2 lg:col-span-3"
        data-testid="pdm-sparkplug-edge-debug"
      >
        <span class="font-medium text-slate-300">{{ t('pdmPage.sparkplugResolvedEdge') }}</span>
        <span class="ml-1 font-mono text-slate-200">{{ sparkplugEdgeDebug.resolvedEdgeNodeId }}</span>
        <span class="ml-2 text-slate-500">({{ sparkplugEdgeDebug.edgeResolutionSource }})</span>
        <span v-if="metricsPayloadSimulated" class="ml-2 rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">{{
          t('pdmPage.metricDemoTag')
        }}</span>
        <details v-if="(sparkplugEdgeDebug.attemptedEdgeNodeIds || []).length" class="mt-2">
          <summary class="cursor-pointer text-slate-500 hover:text-slate-400">{{ t('pdmPage.sparkplugEdgeProbeDetails') }}</summary>
          <p class="mt-1 break-all font-mono text-[10px] leading-relaxed text-slate-500">
            {{ (sparkplugEdgeDebug.attemptedEdgeNodeIds || []).join(' → ') }}
          </p>
        </details>
      </div>
      <div
        v-if="pickedLiveMetricRow"
        class="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-slate-700/80 bg-slate-950/50 px-3 py-2 sm:col-span-2 lg:col-span-3"
      >
        <span class="text-[11px] text-slate-500">{{ t('pdmPage.knownMetricsCurrentValue') }}</span>
        <span class="font-mono text-sm font-medium text-slate-100">{{ formatSparkplugLastValue(pickedLiveMetricRow.lastValue) }}</span>
        <span v-if="pickedLiveMetricRow.lastReceivedAt" class="text-[11px] text-slate-500">
          {{ t('pdmPage.knownMetricsAsOf') }}
          {{ formatEvaluatedAt(pickedLiveMetricRow.lastReceivedAt) }}
        </span>
      </div>
      <div
        v-if="pickedLiveMetricRow"
        class="rounded-md border border-slate-700/80 bg-slate-950/35 p-3 sm:col-span-2 lg:col-span-3"
      >
        <p class="text-xs font-medium text-slate-400">{{ t('pdmPage.seriesTitle') }}</p>
        <p v-if="seriesLoading" class="mt-2 text-xs text-slate-500">…</p>
        <PredictiveMaintenanceMetricSeriesChart
          v-else-if="seriesPoints.length"
          :points="seriesPoints"
          :value-label="pickedLiveMetricRow.metricName"
          :series-source="seriesSource"
        />
        <p v-else class="mt-2 text-xs text-slate-500">{{ t('pdmPage.seriesEmpty') }}</p>
        <p
          v-if="seriesEdgeMeta?.seriesResolvedEdgeNodeId && seriesSource === 'live'"
          class="mt-2 text-[10px] text-slate-500"
        >
          {{ t('pdmPage.seriesLiveEdge', { edge: seriesEdgeMeta.seriesResolvedEdgeNodeId }) }}
        </p>
        <p
          v-if="seriesSource === 'live' && (seriesEdgeMeta?.attemptedEdgeNodeIds || []).length"
          class="mt-1 text-[10px] text-slate-600"
        >
          {{ t('pdmPage.seriesProbedEdges', { path: (seriesEdgeMeta?.attemptedEdgeNodeIds ?? []).join(' → ') }) }}
        </p>
      </div>
      <p class="text-[11px] leading-snug text-slate-500 sm:col-span-2 lg:col-span-3">
        {{ metricsPayloadSimulated ? t('pdmPage.knownMetricsHintSim') : t('pdmPage.knownMetricsHint') }}
      </p>
      <p
        v-if="!liveMetricsLoading && !liveMetrics.length"
        class="text-[11px] leading-snug text-amber-400/90 sm:col-span-2 lg:col-span-3"
      >
        {{ t('pdmPage.knownMetricsEmptyNoDemo') }}
      </p>
      <label class="block text-xs text-slate-400 sm:col-span-2 lg:col-span-3">
        {{ t('addonBoard.pdmMetric') }}
        <span class="font-normal text-slate-500">({{ t('pdmPage.knownMetricsManual') }})</span>
        <input
          v-model="pdmNewMetric"
          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white"
          placeholder="e.g. motor_temp_a"
          :list="pdmMetricDatalistId"
        />
        <datalist :id="pdmMetricDatalistId">
          <option v-for="m in liveMetrics" :key="`dl-${m.sparkplugDeviceId}-${m.metricName}`" :value="m.metricName" />
        </datalist>
      </label>
      <label class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmLabel') }}
        <input v-model="pdmNewLabel" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" />
      </label>
      <div class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmUnit') }}
        <span class="font-normal text-slate-500">{{ t('pdmPage.isoUnitHint') }}</span>
        <select
          v-model="pdmUnitChoice"
          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white"
          :disabled="pdmFormBusy"
        >
          <option value="">{{ t('pdmPage.isoUnitNone') }}</option>
          <optgroup v-for="g in ISO_MEASUREMENT_UNIT_GROUPS" :key="g.categoryKey" :label="t(`pdmPage.${g.categoryKey}`)">
            <option v-for="u in g.units" :key="`${g.categoryKey}:${u}`" :value="u">{{ u }}</option>
          </optgroup>
          <option :value="PDM_UNIT_CHOICE_CUSTOM">{{ t('pdmPage.isoUnitOther') }}</option>
        </select>
        <input
          v-show="pdmUnitChoice === PDM_UNIT_CHOICE_CUSTOM"
          v-model="pdmUnitCustom"
          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white"
          :placeholder="t('pdmPage.isoUnitOtherPlaceholder')"
          :disabled="pdmFormBusy"
        />
      </div>
      <label class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmWarnAbove') }}
        <input v-model="pdmNewWarnAbove" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmCritAbove') }}
        <input v-model="pdmNewCritAbove" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmWarnBelow') }}
        <input v-model="pdmNewWarnBelow" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-400">
        {{ t('addonBoard.pdmCritBelow') }}
        <input v-model="pdmNewCritBelow" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white" />
      </label>
      <div
        class="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4 sm:col-span-2 lg:col-span-3"
      >
        <p class="max-w-md text-[11px] leading-snug text-slate-500">{{ t('pdmPage.ruleDraftFooterHint') }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-brand-600/50 bg-brand-600/10 px-4 py-2 text-sm font-medium text-brand-100 hover:bg-brand-600/20 disabled:opacity-40"
            :disabled="pdmFormBusy || !pdmRuleDraftHasChanges"
            :title="t('pdmPage.ruleDraftCancelTitle')"
            @click="resetPdmRuleDraft"
          >
            {{ t('pdmPage.ruleDraftCancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-500 disabled:opacity-40"
            :disabled="pdmFormBusy || !pdmRuleDraftCanSave"
            @click="submitPdmRule"
          >
            {{ pdmFormBusy ? t('addonBoard.pdmSaving') : t('pdmPage.ruleDraftSave') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
