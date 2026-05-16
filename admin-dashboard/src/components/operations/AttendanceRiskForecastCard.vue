<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useParkContextStore } from '@/stores/parkContext'
import { getLatestAttendanceRiskForecast } from '@/api/client'
import type { ParkDemandForecast5mRow } from '@/types/api'

withDefaults(
  defineProps<{
    /** Distinct test id when the same card is mounted twice on one page (e.g. ops dashboard layouts). */
    cardTestId?: string
  }>(),
  { cardTestId: 'attendance-risk-forecast-card' }
)

const parkCtx = useParkContextStore()
const loading = ref(false)
const error = ref<string | null>(null)
const forecast = ref<ParkDemandForecast5mRow | null>(null)

const statusClass = computed(() => {
  const s = forecast.value?.riskLevel || forecast.value?.status
  if (s === 'critical') return 'bg-rose-500/20 text-rose-200 border-rose-500/40'
  if (s === 'high') return 'bg-amber-500/20 text-amber-100 border-amber-500/40'
  if (s === 'elevated') return 'bg-yellow-500/15 text-yellow-100 border-yellow-500/35'
  return 'bg-emerald-500/15 text-emerald-100 border-emerald-500/35'
})

async function load() {
  error.value = null
  if (!parkCtx.activeParkId) {
    forecast.value = null
    return
  }
  loading.value = true
  try {
    forecast.value = await getLatestAttendanceRiskForecast(parkCtx.activeParkId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load forecast'
    forecast.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => parkCtx.activeParkId,
  () => {
    void load()
  },
  { immediate: true }
)
</script>

<template>
  <div
    :data-testid="cardTestId"
    class="rounded-xl border border-slate-800 bg-slate-950/40 p-4 shadow-inner shadow-slate-950/40"
  >
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attendance risk forecast</p>
        <p class="mt-0.5 text-xs text-slate-400">Latest 5-minute model (manual traffic snapshots).</p>
      </div>
      <button
        type="button"
        class="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-500"
        @click="load()"
      >
        Refresh
      </button>
    </div>

    <p v-if="!parkCtx.activeParkId" class="mt-3 text-sm text-slate-500">Select a park to load the forecast.</p>
    <p v-else-if="loading" class="mt-3 text-sm text-slate-400">Loading…</p>
    <p v-else-if="error" class="mt-3 text-sm text-rose-300">{{ error }}</p>
    <p v-else-if="!forecast" class="mt-3 text-sm text-slate-500">No forecast yet — run a forecast from Traffic corridors.</p>
    <div v-else class="mt-3 space-y-3 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide" :class="statusClass">
          {{ forecast.riskLevel || forecast.status }}
        </span>
        <span class="text-slate-500">Confidence {{ Math.round(forecast.confidenceScore) }}%</span>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Expected attendance range</p>
          <p class="mt-1 font-mono text-white">
            {{ (forecast.totalExpectedAttendanceLow ?? forecast.expectedAttendanceLow).toLocaleString() }} —
            {{ (forecast.totalExpectedAttendanceHigh ?? forecast.expectedAttendanceHigh).toLocaleString() }}
            <span class="text-slate-500"
              >(mid {{ (forecast.totalExpectedAttendanceMid ?? forecast.expectedAttendanceMid).toLocaleString() }})</span
            >
          </p>
        </div>
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Additional demand range</p>
          <p class="mt-1 font-mono text-white">
            +{{ (forecast.estimatedAdditionalDemandLow ?? forecast.additionalDemandLow).toLocaleString() }} … +{{
              (forecast.estimatedAdditionalDemandHigh ?? forecast.additionalDemandHigh).toLocaleString()
            }}
          </p>
        </div>
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Planned demand</p>
          <p class="mt-1 font-mono text-white">{{ forecast.plannedDemand.toLocaleString() }}</p>
        </div>
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Known / registered expected</p>
          <p class="mt-1 font-mono text-white">{{ (forecast.knownRegisteredDemand ?? forecast.knownRegisteredExpected).toLocaleString() }}</p>
        </div>
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">External demand pressure</p>
          <p class="mt-1 font-mono text-white">{{ Number(forecast.externalDemandPressureScore).toFixed(1) }}</p>
        </div>
        <div class="rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2">
          <p class="text-[10px] uppercase tracking-wide text-slate-500">Traffic pressure</p>
          <p class="mt-1 font-mono text-white">{{ Number(forecast.trafficPressureScore).toFixed(1) }}</p>
        </div>
      </div>

      <div v-if="forecast.recommendationsJson?.length" class="rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-2">
        <p class="text-[10px] uppercase tracking-wide text-slate-500">Recommendations</p>
        <ul class="mt-1 list-inside list-disc text-xs text-slate-200">
          <li v-for="(r, i) in forecast.recommendationsJson" :key="i">{{ r }}</li>
        </ul>
      </div>

      <p class="text-[11px] leading-snug text-slate-500">
        Traffic is treated as a leading indicator only. It is not converted directly into visitor count.
      </p>
    </div>
  </div>
</template>
