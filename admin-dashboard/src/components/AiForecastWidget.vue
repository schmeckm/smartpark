<script setup lang="ts">
import type { AiHotspotRow, AiInsightsSummary } from '@/api/client'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { formatDateTime, formatTime } = useRegionalDateTime()

defineProps<{
  summary: AiInsightsSummary | null
  loading: boolean
  error?: string | null
  lastSocketAt: string | null
}>()

defineEmits<{
  refresh: []
}>()

function risk(ratio: number): { label: string; cls: string } {
  if (ratio >= 0.8) return { label: 'High', cls: 'bg-rose-500/20 text-rose-200 ring-rose-500/30' }
  if (ratio >= 0.5) return { label: 'Med', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/30' }
  return { label: 'Low', cls: 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/20' }
}

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(0)}%`
}

function showRows(z: AiHotspotRow[]) {
  return (z && z.length ? z : []).slice(0, 3)
}
</script>

<template>
  <section
    class="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/90 shadow-lg shadow-slate-950/40"
  >
    <div class="border-b border-slate-800/80 px-5 py-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-brand-400/90">AI forecast</p>
          <h2 class="mt-0.5 font-display text-lg font-semibold text-white">Next 60 minutes</h2>
          <p v-if="summary" class="mt-1 text-xs text-slate-500">
            Horizon {{ summary.forecastHorizonMinutes }} min
            <template v-if="summary.model"
              >· Model {{ summary.model.modelName }} @ {{ summary.model.version }}</template
            >
            · Generated {{ formatDateTime(summary.generatedAt) }}
          </p>
        </div>
        <div class="flex flex-col items-end gap-1 text-right text-xs text-slate-500">
          <p v-if="lastSocketAt">Live: {{ formatTime(lastSocketAt) }}</p>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-50"
            :disabled="loading"
            @click="$emit('refresh')"
          >
            {{ loading ? 'Working…' : 'Refresh' }}
          </button>
        </div>
      </div>
    </div>

    <ul class="divide-y divide-slate-800/60">
      <li
        v-if="error && !loading"
        class="px-5 py-8 text-center text-sm text-rose-300"
        role="alert"
      >
        {{ error }}
      </li>
      <li v-else-if="loading && !summary" class="px-5 py-8 text-center text-sm text-slate-500">Loading forecast…</li>
      <li
        v-for="row in showRows(summary?.topHotspotZones ?? [])"
        :key="row.zoneId"
        class="grid gap-2 px-5 py-3 sm:grid-cols-12 sm:items-center"
      >
        <div class="sm:col-span-5">
          <p class="text-sm font-medium text-white">{{ row.zoneName }}</p>
          <p class="text-xs text-slate-500">ID {{ row.zoneId.slice(0, 8) }}…</p>
        </div>
        <div class="text-sm sm:col-span-2">
          <span
            :class="[
              'inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1',
              risk(row.crowdRatio).cls,
            ]"
            >{{ risk(row.crowdRatio).label }} risk</span
          >
        </div>
        <div class="text-right text-sm sm:col-span-2 sm:text-left">
          <p class="text-slate-500">Pred. level</p>
          <p class="font-mono text-white">
            {{ Math.round(row.predictedCrowdLevel) }} <span class="text-slate-500">/ {{ row.maxCapacity }}</span>
          </p>
        </div>
        <div class="text-right text-sm sm:col-span-2 sm:text-left">
          <p class="text-slate-500">Confidence</p>
          <p class="font-mono text-slate-200">
            {{ row.confidence == null ? '—' : `${(row.confidence * 100).toFixed(0)}%` }}
          </p>
        </div>
        <div class="text-right sm:col-span-1">
          <p class="text-slate-500">Ratio</p>
          <p class="font-mono text-amber-100/90">{{ pct(row.crowdRatio) }}</p>
        </div>
      </li>
      <li
        v-if="summary && showRows(summary.topHotspotZones).length === 0"
        class="px-5 py-6 text-center text-sm text-slate-500"
      >
        No hotspot rows yet. Run a refresh to sample zones and generate forecasts.
      </li>
    </ul>
    <p v-if="summary && summary.highestPredictedCrowdRatio != null" class="border-t border-slate-800/60 px-5 py-2 text-xs text-slate-500">
      Park-wide peak ratio (this horizon):
      <span class="font-mono text-slate-300">{{ pct(summary.highestPredictedCrowdRatio) }}</span>
      <span v-if="summary.averageConfidence != null" class="ml-2">
        · Avg. confidence: {{ (summary.averageConfidence * 100).toFixed(0) }}%
      </span>
    </p>
  </section>
</template>
