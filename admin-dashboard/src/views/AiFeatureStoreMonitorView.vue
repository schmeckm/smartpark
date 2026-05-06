<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getAiFeatureStoreMonitor,
  getAiPipelineHealth,
  getAiPipelineRuns,
  type AiFeatureStoreMonitor,
  type AiPipelineHealth,
  type AiPipelineHealthSmokeRideAll,
  type AiPipelineRunHistoryRow,
} from '@/api/client'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useParkContextStore } from '@/stores/parkContext'

type SmokeRideGlyph = 'check' | 'warn' | 'cross'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()
const { isLight, surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()
const data = ref<AiFeatureStoreMonitor | null>(null)
const pipeline = ref<AiPipelineHealth | null>(null)
const loading = ref(false)
const lastRefreshedAt = ref<string | null>(null)
const monitorLoadError = ref<string | null>(null)
const pipelineRuns = ref<AiPipelineRunHistoryRow[]>([])
const PIPELINE_HISTORY_LIMIT = 25

const AUTO_REFRESH_MS = 60_000
const autoRefresh = ref(false)
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

type AmpelState = 'ok' | 'warn' | 'bad' | 'na'

function rideSmokeAgg(summary: NonNullable<AiPipelineHealthSmokeRideAll>['summary']) {
  if (!summary || typeof summary !== 'object') return null
  const rec = summary as Record<string, unknown>
  const n = (key: string): number => {
    const v = rec[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const x = Number(v)
      return Number.isFinite(x) ? x : 0
    }
    return 0
  }
  return { totalRides: n('totalRides'), passed: n('passed'), warnings: n('warnings'), failed: n('failed') }
}

const rideSmokeUi = computed(() => {
  const s = pipeline.value?.smokeRideForecastAll
  if (!s) return null
  const agg = rideSmokeAgg(s.summary)
  const failed = agg?.failed ?? 0
  const warnings = agg?.warnings ?? 0
  const contradictory = s.passed && failed > 0
  const isFail = !s.passed || failed > 0
  const isWarnOnly = !isFail && warnings > 0
  let glyph: SmokeRideGlyph = 'check'
  if (isFail) glyph = 'cross'
  else if (isWarnOnly) glyph = 'warn'
  return { s, agg, contradictory, isFail, isWarnOnly, glyph }
})

const ampelPipeline = computed<AmpelState>(() => {
  const p = pipeline.value
  if (!p?.lastRun) return 'warn'
  const st = (p.lastRun.status || '').toLowerCase()
  if (st !== 'success') return 'bad'
  if (p.lastRun.featureStoreError || p.lastRun.scoringError) return 'bad'
  return 'ok'
})

const ampelFreshness = computed<AmpelState>(() => {
  if (!parkCtx.activeParkId || !data.value) return 'na'
  return data.value.snapshotFreshnessOk ? 'ok' : 'warn'
})

const ampelGaps = computed<AmpelState>(() => {
  if (!data.value) return 'na'
  const d = data.value
  if (d.missingWeather || d.missingHoliday || d.missingTraffic) return 'warn'
  return 'ok'
})

function ampelStateLabel(s: AmpelState) {
  if (s === 'ok') return t('aiMl.monitorAmpelStateOk')
  if (s === 'warn') return t('aiMl.monitorAmpelStateWarn')
  if (s === 'bad') return t('aiMl.monitorAmpelStateBad')
  return t('aiMl.monitorAmpelStateNa')
}

function ampelChipClass(s: AmpelState) {
  const base =
    'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium'
  if (s === 'ok') {
    return `${base} border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-200`
  }
  if (s === 'warn') {
    return `${base} border-amber-500/35 bg-amber-500/10 text-amber-900 dark:border-amber-500/40 dark:text-amber-200`
  }
  if (s === 'bad') {
    return `${base} border-rose-500/35 bg-rose-500/10 text-rose-800 dark:border-rose-500/40 dark:text-rose-200`
  }
  return `${base} border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-400`
}

function rideSmokeGlyphChar(glyph: SmokeRideGlyph) {
  if (glyph === 'check') return '✓'
  if (glyph === 'warn') return '⚠'
  return '✗'
}

function rideSmokeGlyphClass(glyph: SmokeRideGlyph) {
  if (glyph === 'check') return 'text-emerald-500 dark:text-emerald-400'
  if (glyph === 'warn') return 'text-amber-500 dark:text-amber-400'
  return 'text-rose-500 dark:text-rose-400'
}

function smokeChipClassSeverity(kind: 'neutral' | 'warn' | 'fail') {
  if (kind === 'fail') {
    return isLight.value
      ? 'rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-900'
      : 'rounded border border-rose-500/45 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-200'
  }
  if (kind === 'warn') {
    return isLight.value
      ? 'rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900'
      : 'rounded border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200'
  }
  return smokeChipClass()
}

const sectionDivider = computed(() =>
  isLight.value ? 'mt-6 border-t border-slate-200 pt-6' : 'mt-6 border-t border-slate-800 pt-6',
)

function rowGrid() {
  return 'grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[minmax(14rem,40%)_1fr] sm:items-start'
}

function labelClass() {
  return isLight.value ? 'pt-0.5 text-slate-600' : 'pt-0.5 text-slate-500'
}

function valueClass() {
  return isLight.value ? 'min-w-0 break-words text-slate-900' : 'min-w-0 break-words text-slate-200'
}

function runStatusClass(status: string | undefined) {
  const s = (status || '').toLowerCase()
  if (s === 'success') return 'font-medium text-emerald-500 dark:text-emerald-400'
  if (s === 'running') return 'font-medium text-amber-500 dark:text-amber-400'
  if (s === 'failure' || s === 'failed' || s === 'error') return 'font-medium text-rose-500 dark:text-rose-400'
  return `font-medium ${isLight.value ? 'text-slate-900' : 'text-slate-200'}`
}

function smokePassClass(passed: boolean) {
  return passed ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
}

function gapPillClass(missing: boolean) {
  if (missing) {
    return 'inline-flex rounded border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200'
  }
  return 'inline-flex rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200'
}

function smokeChipClass() {
  return isLight.value
    ? 'rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700'
    : 'rounded border border-slate-700/80 bg-slate-950/50 px-2 py-0.5 text-[11px] text-slate-300'
}

function clearAutoRefreshTimer() {
  if (autoRefreshTimer != null) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

function startAutoRefreshTimer() {
  clearAutoRefreshTimer()
  if (!autoRefresh.value) return
  autoRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || loading.value) return
    void load()
  }, AUTO_REFRESH_MS)
}

async function copyDiagnostics() {
  const payload = {
    exportedAt: new Date().toISOString(),
    uiLastRefreshedAt: lastRefreshedAt.value,
    park: parkCtx.activeParkId
      ? { id: parkCtx.activeParkId, name: parkCtx.activePark?.name ?? null }
      : null,
    pipelineHealth: pipeline.value,
    pipelineRuns: pipelineRuns.value,
    featureStoreMonitor: data.value,
    loadError: monitorLoadError.value,
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    push(t('aiMl.monitorCopied'), 'success')
  } catch {
    push(t('aiMl.monitorCopyFailed'), 'error')
  }
}

async function load() {
  loading.value = true
  monitorLoadError.value = null
  try {
    pipeline.value = await getAiPipelineHealth()
    try {
      pipelineRuns.value = await getAiPipelineRuns(PIPELINE_HISTORY_LIMIT)
    } catch {
      pipelineRuns.value = []
    }
    if (parkCtx.activeParkId) {
      data.value = await getAiFeatureStoreMonitor()
    } else {
      data.value = null
    }
    lastRefreshedAt.value = new Date().toISOString()
  } catch (e) {
    data.value = null
    pipeline.value = null
    pipelineRuns.value = []
    lastRefreshedAt.value = null
    const msg = e instanceof Error ? e.message : 'Error'
    monitorLoadError.value = msg
    push(msg, 'error')
  } finally {
    loading.value = false
  }
}

watch(autoRefresh, (on) => {
  if (on) startAutoRefreshTimer()
  else clearAutoRefreshTimer()
})

onMounted(() => void load())

onUnmounted(() => clearAutoRefreshTimer())
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiMl.back') }}</RouterLink>
        <h1 :class="ui.title">{{ t('aiMl.monitorTitle') }}</h1>
        <p :class="ui.subtitle">{{ t('aiMl.monitorSubtitle') }}</p>
        <p v-if="parkCtx.activePark" class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {{ t('aiMl.monitorActivePark', { name: parkCtx.activePark.name }) }}
        </p>
        <p v-if="lastRefreshedAt" class="mt-1 text-xs text-slate-500 dark:text-slate-500">
          {{ t('aiMl.monitorLastUpdated', { time: formatDateTime(lastRefreshedAt) }) }}
        </p>
        <p v-if="!parkCtx.activeParkId" class="mt-2 text-sm text-amber-600 dark:text-amber-500">{{ t('aiMl.needPark') }}</p>
      </div>
      <div class="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end">
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            @click="copyDiagnostics()"
          >
            {{ t('aiMl.monitorCopyDiagnostics') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="loading"
            @click="load()"
          >
            {{ t('btn.refresh') }}
          </button>
        </div>
        <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <input v-model="autoRefresh" type="checkbox" class="rounded border-slate-400 text-brand-600 focus:ring-brand-500" />
          {{ t('aiMl.monitorAutoRefresh') }}
        </label>
        <p class="max-w-xs text-right text-[11px] text-slate-500 dark:text-slate-500 sm:text-right">
          {{ t('aiMl.monitorAutoRefreshHint') }}
        </p>
      </div>
    </div>

    <div
      v-if="!loading && monitorLoadError && !pipeline"
      :class="ui.card"
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="min-w-0">
        <p class="text-sm font-medium text-rose-700 dark:text-rose-300">{{ t('aiMl.monitorLoadFailed') }}</p>
        <p class="mt-1 break-words font-mono text-xs text-slate-600 dark:text-slate-400">{{ monitorLoadError }}</p>
      </div>
      <button
        type="button"
        class="shrink-0 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
        @click="load()"
      >
        {{ t('btn.refresh') }}
      </button>
    </div>

    <div v-if="pipeline" :class="ui.card" class="flex flex-col gap-3">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
        {{ t('aiMl.monitorAmpelTitle') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <span :class="ampelChipClass(ampelPipeline)" class="min-w-0">
          <span class="shrink-0 text-slate-600 dark:text-slate-400">{{ t('aiMl.monitorAmpelPipeline') }}</span>
          <span class="min-w-0 font-semibold">{{ ampelStateLabel(ampelPipeline) }}</span>
        </span>
        <span :class="ampelChipClass(ampelFreshness)" class="min-w-0">
          <span class="shrink-0 text-slate-600 dark:text-slate-400">{{ t('aiMl.monitorAmpelFreshness') }}</span>
          <span class="min-w-0 font-semibold">{{ ampelStateLabel(ampelFreshness) }}</span>
        </span>
        <span :class="ampelChipClass(ampelGaps)" class="min-w-0">
          <span class="shrink-0 text-slate-600 dark:text-slate-400">{{ t('aiMl.monitorAmpelGaps') }}</span>
          <span class="min-w-0 font-semibold">{{ ampelStateLabel(ampelGaps) }}</span>
        </span>
      </div>
    </div>

    <div v-if="pipeline" :class="ui.card" class="space-y-3">
      <div>
        <h2 class="text-base font-semibold text-slate-900 dark:text-slate-200">{{ t('aiMl.monitorHistoryTitle') }}</h2>
        <p class="mt-1 text-xs text-slate-600 dark:text-slate-500">{{ t('aiMl.monitorHistorySubtitle') }}</p>
      </div>
      <p v-if="pipelineRuns.length === 0" class="text-sm text-slate-500 dark:text-slate-400">
        {{ t('aiMl.monitorHistoryEmpty') }}
      </p>
      <div v-else class="-mx-1 overflow-x-auto">
        <table class="w-full min-w-[52rem] border-collapse text-left text-xs">
          <thead>
            <tr :class="ui.tableHead">
              <th class="px-2 py-2">{{ t('aiMl.monitorHistoryColStarted') }}</th>
              <th class="px-2 py-2">{{ t('aiMl.monitorHistoryColFinished') }}</th>
              <th class="px-2 py-2">{{ t('aiMl.monitorHistoryColDuration') }}</th>
              <th class="px-2 py-2">{{ t('aiMl.monitorHistoryColStatus') }}</th>
              <th class="px-2 py-2 text-right">{{ t('aiMl.monitorHistoryColPark') }}</th>
              <th class="px-2 py-2 text-right">{{ t('aiMl.monitorHistoryColRide') }}</th>
              <th class="px-2 py-2 text-right">{{ t('aiMl.monitorHistoryColLabels') }}</th>
              <th class="px-2 py-2">{{ t('aiMl.monitorHistoryColErrors') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pipelineRuns" :key="r.id" :class="ui.tableRow">
              <td :class="ui.tableCell">{{ formatDateTime(r.startedAt) }}</td>
              <td :class="ui.tableCell">{{ r.finishedAt ? formatDateTime(r.finishedAt) : t('aiMl.monitorDash') }}</td>
              <td :class="ui.tableCell">{{
                r.durationMs != null ? t('aiMl.monitorMs', { n: r.durationMs }) : t('aiMl.monitorDash')
              }}</td>
              <td :class="[ui.tableCell, runStatusClass(r.status)]">{{ r.status }}</td>
              <td :class="[ui.tableCell, 'text-right tabular-nums']">{{ r.parkSnapshotsWritten }}</td>
              <td :class="[ui.tableCell, 'text-right tabular-nums']">{{ r.rideSnapshotsWritten }}</td>
              <td :class="[ui.tableCell, 'text-right tabular-nums']">{{ r.labelsWritten }}</td>
              <td :class="ui.tableCell">
                <template v-if="!r.featureStoreError && !r.scoringError">
                  <span class="text-slate-500 dark:text-slate-400">{{ t('aiMl.monitorHistoryErrNone') }}</span>
                </template>
                <template v-else>
                  <span class="flex flex-wrap gap-1">
                    <span
                      v-if="r.featureStoreError"
                      :title="r.featureStoreError"
                      class="cursor-help rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200"
                    >
                      {{ t('aiMl.monitorHistoryErrFs') }}
                    </span>
                    <span
                      v-if="r.scoringError"
                      :title="r.scoringError"
                      class="cursor-help rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200"
                    >
                      {{ t('aiMl.monitorHistoryErrSc') }}
                    </span>
                  </span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="pipeline" :class="ui.card" class="space-y-8">
      <h2 class="text-base font-semibold text-slate-900 dark:text-slate-200">{{ t('aiMl.pipelineHealthTitle') }}</h2>

      <section>
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
          {{ t('aiMl.monitorSectionLastRun') }}
        </h3>
        <div class="mt-3 space-y-2.5">
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineStarted') }}</div>
            <div :class="valueClass()">
              {{ pipeline.lastRun?.startedAt ? formatDateTime(pipeline.lastRun.startedAt) : t('aiMl.monitorDash') }}
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineLastFinished') }}</div>
            <div :class="valueClass()">
              {{ pipeline.lastRun?.finishedAt ? formatDateTime(pipeline.lastRun.finishedAt) : t('aiMl.monitorDash') }}
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineDuration') }}</div>
            <div :class="valueClass()">{{
              pipeline.lastRun != null
                ? t('aiMl.monitorMs', { n: pipeline.lastRun.durationMs })
                : t('aiMl.monitorDash')
            }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineParkSnapshots') }}</div>
            <div :class="valueClass()">{{ pipeline.lastRun?.parkSnapshotsWritten ?? t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineRideSnapshots') }}</div>
            <div :class="valueClass()">{{ pipeline.lastRun?.rideSnapshotsWritten ?? t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineLabels') }}</div>
            <div :class="valueClass()">{{ pipeline.lastRun?.labelsWritten ?? t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineStatus') }}</div>
            <div :class="runStatusClass(pipeline.lastRun?.status)">{{ pipeline.lastRun?.status || t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineFeatureStoreError') }}</div>
            <div :class="valueClass()" class="text-amber-700 dark:text-amber-300">
              {{ pipeline.lastRun?.featureStoreError || t('aiMl.monitorDash') }}
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineScoringError') }}</div>
            <div :class="valueClass()" class="text-amber-700 dark:text-amber-300">
              {{ pipeline.lastRun?.scoringError || t('aiMl.monitorDash') }}
            </div>
          </div>
        </div>
      </section>

      <section :class="sectionDivider">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
          {{ t('aiMl.monitorSectionScheduler') }}
        </h3>
        <div class="mt-3 space-y-2.5">
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineScheduler') }}</div>
            <div :class="valueClass()">
              {{ pipeline.schedulerEnabled ? t('aiMl.pipelineOn') : t('aiMl.pipelineOff') }}
              <span v-if="pipeline.aiSampling" class="ml-2 text-xs text-slate-600 dark:text-slate-500">
                ({{ pipeline.aiSampling.enabledSource }} / {{ pipeline.aiSampling.intervalSecondsSource }})
              </span>
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineInterval') }}</div>
            <div :class="valueClass()">{{ t('aiMl.monitorSecondsShort', { n: pipeline.intervalSeconds }) }}</div>
          </div>
        </div>
      </section>

      <section :class="sectionDivider">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
          {{ t('aiMl.monitorSectionSmoke') }}
        </h3>
        <div class="mt-3 space-y-2.5">
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineSmokeEuromir') }}</div>
            <div :class="valueClass()">
              <template v-if="pipeline.smokeEuromir">
                <span :class="smokePassClass(pipeline.smokeEuromir.passed)">{{
                  pipeline.smokeEuromir.passed ? '✓' : '✗'
                }}</span>
                <span class="text-slate-600 dark:text-slate-400">
                  · {{ pipeline.smokeEuromir.checkedAt ? formatDateTime(pipeline.smokeEuromir.checkedAt) : t('aiMl.monitorDash') }}
                </span>
              </template>
              <template v-else>{{ t('aiMl.pipelineSmokeUnknown') }}</template>
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineSmokeWodan') }}</div>
            <div :class="valueClass()">
              <template v-if="pipeline.smokeWodan">
                <span :class="smokePassClass(pipeline.smokeWodan.passed)">{{
                  pipeline.smokeWodan.passed ? '✓' : '✗'
                }}</span>
                <span class="text-slate-600 dark:text-slate-400">
                  · {{ pipeline.smokeWodan.checkedAt ? formatDateTime(pipeline.smokeWodan.checkedAt) : t('aiMl.monitorDash') }}
                </span>
              </template>
              <template v-else>{{ t('aiMl.pipelineSmokeUnknown') }}</template>
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.pipelineSmokeAllRides') }}</div>
            <div :class="valueClass()">
              <template v-if="rideSmokeUi">
                <div class="flex flex-wrap items-center gap-2">
                  <span :class="rideSmokeGlyphClass(rideSmokeUi.glyph)">{{
                    rideSmokeGlyphChar(rideSmokeUi.glyph)
                  }}</span>
                  <span class="text-slate-600 dark:text-slate-400">
                    ·
                    {{ rideSmokeUi.s.checkedAt ? formatDateTime(rideSmokeUi.s.checkedAt) : t('aiMl.monitorDash') }}
                  </span>
                </div>
                <div v-if="rideSmokeUi.s.summary && rideSmokeUi.agg" class="mt-2 flex flex-wrap gap-2">
                  <span :class="smokeChipClassSeverity('neutral')">{{
                    t('aiMl.smokeChipTotal', { n: rideSmokeUi.agg.totalRides })
                  }}</span>
                  <span :class="smokeChipClassSeverity('neutral')">{{
                    t('aiMl.smokeChipPass', { n: rideSmokeUi.agg.passed })
                  }}</span>
                  <span
                    :class="
                      smokeChipClassSeverity(rideSmokeUi.agg.warnings > 0 ? 'warn' : 'neutral')
                    "
                  >
                    {{ t('aiMl.smokeChipWarn', { n: rideSmokeUi.agg.warnings }) }}
                  </span>
                  <span
                    :class="smokeChipClassSeverity(rideSmokeUi.agg.failed > 0 ? 'fail' : 'neutral')"
                  >
                    {{ t('aiMl.smokeChipFail', { n: rideSmokeUi.agg.failed }) }}
                  </span>
                </div>
                <p
                  v-if="rideSmokeUi.contradictory"
                  class="mt-2 text-xs leading-snug text-amber-800 dark:text-amber-200/95"
                >
                  {{ t('aiMl.smokeRideMismatch') }}
                </p>
                <p
                  v-else-if="rideSmokeUi.isWarnOnly"
                  class="mt-2 text-xs leading-snug text-amber-800 dark:text-amber-200/95"
                >
                  {{ t('aiMl.smokeRideWarnHint') }}
                </p>
              </template>
              <template v-else>{{ t('aiMl.pipelineSmokeUnknown') }}</template>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="parkCtx.activeParkId && data" :class="ui.card" class="space-y-8">
      <section>
        <h2 class="text-base font-semibold text-slate-900 dark:text-slate-200">{{ t('aiMl.monitorFreshnessTitle') }}</h2>
        <div class="mt-4 space-y-2.5">
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.freshOk') }}</div>
            <div :class="valueClass()">
              <span :class="data.snapshotFreshnessOk ? smokePassClass(true) : ''">{{ data.snapshotFreshnessOk ? '✓' : t('aiMl.monitorDash') }}</span>
            </div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.latestPark') }}</div>
            <div :class="valueClass()">{{ data.latestParkSnapshotAt ? formatDateTime(data.latestParkSnapshotAt) : t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.latestRide') }}</div>
            <div :class="valueClass()">{{ data.latestRideSnapshotAt ? formatDateTime(data.latestRideSnapshotAt) : t('aiMl.monitorDash') }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.missWeather') }}</div>
            <div :class="valueClass()"><span :class="gapPillClass(data.missingWeather)">{{ data.missingWeather ? t('aiMl.gapIssue') : t('aiMl.gapOk') }}</span></div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.missHoliday') }}</div>
            <div :class="valueClass()"><span :class="gapPillClass(data.missingHoliday)">{{ data.missingHoliday ? t('aiMl.gapIssue') : t('aiMl.gapOk') }}</span></div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.missTraffic') }}</div>
            <div :class="valueClass()"><span :class="gapPillClass(data.missingTraffic)">{{ data.missingTraffic ? t('aiMl.gapIssue') : t('aiMl.gapOk') }}</span></div>
          </div>
        </div>
      </section>

      <section :class="sectionDivider">
        <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-500">
          {{ t('aiMl.monitorAssetCoverage') }}
        </h3>
        <div class="mt-3 space-y-2.5">
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.assets') }}</div>
            <div :class="valueClass()">{{ data.rideAssets }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.withProfile') }}</div>
            <div :class="valueClass()">{{ data.assetsWithMlProfileApprox }}</div>
          </div>
          <div :class="rowGrid()">
            <div :class="labelClass()">{{ t('aiMl.withoutProfile') }}</div>
            <div :class="valueClass()">{{ data.assetsWithoutProfileApprox }}</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
