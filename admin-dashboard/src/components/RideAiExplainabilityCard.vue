<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export type ExplainFeatureContribution = {
  feature: string
  value: unknown
  impact: number
  direction: string
  source: string
  explanation: string
}

export type ExplainabilityPayload = {
  target: string
  prediction: number | null
  unit: string
  confidence: number
  baseline: number | null
  adjustedPrediction: number | null
  featureContributions: ExplainFeatureContribution[]
  summary: string
  recommendation: string
  modelInfo: {
    track: string
    modelId?: string | null
    modelVersion?: string | null
    algorithm?: string
    /** ADR forecast resolution path when present (ENTITY, PARK, …). */
    basis?: string | null
  }
  /** Ridge: ML feature keys zeroed by ride signal capability (`use_for_ml` explicit false). */
  mlCapabilityMaskedFeatures?: string[]
}

const props = defineProps<{
  title: string
  payload: ExplainabilityPayload | null
  loading?: boolean
}>()

const { t } = useI18n()

/** Maps backend `source` strings to i18n; includes legacy aliases for older payloads. */
function sourceLabel(source: string): string {
  const keyBySource: Record<string, string> = {
    snapshot: 'aiExplain.sourceSnapshot',
    baseline_integration: 'aiExplain.sourceBaselineIntegration',
    x_layer_heuristic: 'aiExplain.sourceXLayerHeuristic',
    enterprise_ml: 'aiExplain.sourceEnterpriseMl',
    baseline_rule: 'aiExplain.sourceBaselineRule',
    ridge_model: 'aiExplain.sourceRidgeModel',
    capability_ml_policy: 'aiExplain.sourceCapabilityMlPolicy',
    x_context: 'aiExplain.sourceBaselineIntegration',
    x_layer: 'aiExplain.sourceXLayerHeuristic',
  }
  const k = keyBySource[String(source || '').trim()]
  if (k) return t(k)
  if (source) return String(source)
  return t('aiExplain.sourceUnknown')
}

const maxAbsImpact = computed(() => {
  const rows = props.payload?.featureContributions ?? []
  let m = 0.01
  for (const r of rows) {
    const a = Math.abs(Number(r.impact) || 0)
    if (a > m) m = a
  }
  return m
})

function barPct(impact: number): number {
  return Math.min(100, (Math.abs(impact) / maxAbsImpact.value) * 100)
}

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return String(Math.round(Number(v) * 10) / 10)
}

function fmtConf(c: number): string {
  if (!Number.isFinite(c)) return '—'
  return `${Math.round(Math.min(1, Math.max(0, c)) * 100)}%`
}

const basisLine = computed(() => {
  const b = props.payload?.modelInfo?.basis
  if (!b || String(b).trim() === '') return ''
  return t('aiExplain.basisLine', { basis: String(b) })
})
</script>

<template>
  <section
    v-if="loading || payload"
    class="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3"
  >
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{{ title }}</h3>
      <span
        v-if="payload?.modelInfo?.track"
        class="rounded border border-slate-600 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
      >
        {{ payload.modelInfo.track }}
      </span>
    </div>

    <div v-if="loading" class="mt-3 text-sm text-slate-400">…</div>

    <template v-else-if="payload">
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded border border-slate-700/80 bg-slate-950/60 px-2 py-1.5">
          <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('aiExplain.predicted') }}</div>
          <div class="text-lg font-semibold tabular-nums text-slate-50">
            {{ fmtNum(payload.adjustedPrediction ?? payload.prediction) }}
            <span class="text-xs font-normal text-slate-500">{{ payload.unit }}</span>
          </div>
        </div>
        <div class="rounded border border-slate-700/80 bg-slate-950/60 px-2 py-1.5">
          <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('aiExplain.baselineCurrent') }}</div>
          <div class="text-lg font-semibold tabular-nums text-slate-50">{{ fmtNum(payload.baseline) }}</div>
        </div>
        <div class="rounded border border-slate-700/80 bg-slate-950/60 px-2 py-1.5">
          <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('aiExplain.confidence') }}</div>
          <div class="text-lg font-semibold tabular-nums text-slate-50">{{ fmtConf(payload.confidence) }}</div>
        </div>
        <div class="rounded border border-slate-700/80 bg-slate-950/60 px-2 py-1.5 sm:col-span-2 lg:col-span-1">
          <div class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('aiExplain.target') }}</div>
          <div class="truncate text-xs font-mono text-slate-300" :title="payload.target">{{ payload.target }}</div>
        </div>
      </div>

      <p v-if="basisLine" class="mt-2 text-[10px] text-slate-500">{{ basisLine }}</p>

      <p class="mt-3 text-sm leading-snug text-slate-200">{{ payload.summary }}</p>
      <p class="mt-1 text-xs leading-snug text-slate-400">{{ payload.recommendation }}</p>

      <div
        v-if="payload.mlCapabilityMaskedFeatures?.length"
        class="mt-3 rounded border border-amber-900/50 bg-amber-950/25 px-2 py-2"
      >
        <div class="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
          {{ t('aiExplain.mlMaskedTitle') }}
        </div>
        <p class="mt-1 text-[10px] leading-snug text-amber-100/85">{{ t('aiExplain.mlMaskedIntro') }}</p>
        <ul class="mt-1.5 list-inside list-disc font-mono text-[10px] text-amber-50/95">
          <li v-for="feat in payload.mlCapabilityMaskedFeatures" :key="feat">{{ feat }}</li>
        </ul>
      </div>

      <div v-if="payload.featureContributions?.length" class="mt-3 space-y-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('aiExplain.featureContribs') }}</div>
        <div v-for="(row, i) in payload.featureContributions" :key="i" class="space-y-0.5">
          <div class="flex items-start justify-between gap-2 text-[11px] text-slate-300">
            <div class="min-w-0 flex-1">
              <div class="truncate font-mono">{{ row.feature }}</div>
              <div class="mt-0.5">
                <span
                  class="inline-block rounded border border-slate-700/80 bg-slate-950/80 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400"
                  :title="row.source"
                >
                  {{ t('aiExplain.layerColumn') }}: {{ sourceLabel(row.source) }}
                </span>
              </div>
            </div>
            <div class="shrink-0 text-right tabular-nums text-slate-400">
              <template v-if="row.value != null && row.value !== ''">{{ row.value }}</template>
              <template v-else>—</template>
              <span class="ml-1 text-slate-500">{{ row.direction }}</span>
              <span
                class="ml-1"
                :class="row.impact >= 0 ? 'text-amber-200/90' : 'text-emerald-200/90'"
              >
                {{ row.impact >= 0 ? '+' : '' }}{{ row.impact }}
              </span>
            </div>
          </div>
          <div class="h-1.5 overflow-hidden rounded bg-slate-800">
            <div
              class="h-full rounded bg-sky-600/80 transition-[width]"
              :style="{ width: `${barPct(row.impact)}%` }"
            />
          </div>
          <p class="text-[10px] leading-snug text-slate-500">{{ row.explanation }}</p>
        </div>
        <p class="text-[9px] leading-snug text-slate-600">{{ t('aiExplain.layerFootnote') }}</p>
      </div>

      <p
        v-if="payload.modelInfo?.algorithm"
        class="mt-2 text-[10px] text-slate-600"
      >
        {{ payload.modelInfo.algorithm }}
        <template v-if="payload.modelInfo.modelId"> · id {{ payload.modelInfo.modelId }}</template>
      </p>
    </template>
  </section>
</template>
