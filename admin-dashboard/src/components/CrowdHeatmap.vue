<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Zone } from '../types/api'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    zones: Zone[]
    /** 0–100 from park wait-time snapshot series (see AI park forecast); not zone MQTT occupancy. */
    parkWideLoadPercent?: number | null
    externalParkLabel?: string
    /**
     * When an external integration park is in focus, internal tenant zone tiles are misleading
     * (often demo/seed occupancy). Hide them and show only park-wide demand from the integration feed.
     */
    hideInternalZoneTiles?: boolean
  }>(),
  { parkWideLoadPercent: null, externalParkLabel: '', hideInternalZoneTiles: false },
)

function utilization(z: Zone): number {
  if (!z.maxCapacity) return 0
  return Math.min(100, Math.round((100 * z.currentCrowdLevel) / z.maxCapacity))
}

function heatStyle(pct: number): { background: string; borderColor: string } {
  if (pct < 45) {
    return {
      background: `linear-gradient(135deg, rgba(50,145,255,0.22) 0%, rgba(23,64,143,0.16) 100%)`,
      borderColor: 'rgba(96,165,250,0.42)',
    }
  }
  if (pct < 75) {
    return {
      background: `linear-gradient(135deg, rgba(250,204,21,0.26) 0%, rgba(217,119,6,0.12) 100%)`,
      borderColor: 'rgba(250,204,21,0.38)',
    }
  }
  if (pct < 90) {
    return {
      background: `linear-gradient(135deg, rgba(249,115,22,0.32) 0%, rgba(234,88,12,0.14) 100%)`,
      borderColor: 'rgba(251,146,60,0.42)',
    }
  }
  return {
    background: `linear-gradient(135deg, rgba(239,68,68,0.38) 0%, rgba(185,28,28,0.18) 100%)`,
    borderColor: 'rgba(248,113,113,0.48)',
  }
}

const sortedZones = computed(() => [...props.zones].sort((a, b) => utilization(b) - utilization(a)))

/** Resolved park-wide row for template (avoids double heatStyle + non-null assertions). */
const parkWideHeat = computed(() => {
  const p = props.parkWideLoadPercent
  if (p == null || !Number.isFinite(p)) return null
  const pct = Math.round(p)
  return { pct, ...heatStyle(p) }
})

const allInternalZonesIdle = computed(
  () => props.zones.length > 0 && props.zones.every((z) => !z.maxCapacity || utilization(z) === 0),
)
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-panel">
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-lg font-semibold text-white">Live crowd heatmap</h2>
        <p class="mt-1 text-sm text-slate-400">
          Park-wide index (when shown) comes from wait-time snapshots. Zone tiles use internal occupancy only
          (<code class="rounded bg-slate-800/80 px-1 text-[11px]">currentCrowdLevel</code> / MQTT or imports).
        </p>
      </div>
      <div class="hidden shrink-0 gap-2 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:flex">
        <span class="flex items-center gap-1"
          ><span class="h-2 w-2 rounded-full bg-brand-400/90" /> {{ t('crowdHeatmap.legendCalm') }}</span
        >
        <span class="flex items-center gap-1"
          ><span class="h-2 w-2 rounded-full bg-amber-400/85" /> {{ t('crowdHeatmap.legendBusy') }}</span
        >
        <span class="flex items-center gap-1"
          ><span class="h-2 w-2 rounded-full bg-orange-500/90" /> {{ t('crowdHeatmap.legendHot') }}</span
        >
        <span class="flex items-center gap-1"
          ><span class="h-2 w-2 rounded-full bg-rose-500/90" /> {{ t('crowdHeatmap.legendCritical') }}</span
        >
      </div>
    </div>

    <div
      v-if="parkWideHeat"
      class="mb-5 rounded-xl border p-4 transition"
      :style="{
        background: parkWideHeat.background,
        borderColor: parkWideHeat.borderColor,
      }"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-200">Park-wide demand index</h3>
          <p v-if="externalParkLabel" class="mt-1 text-xs text-slate-300/90">{{ externalParkLabel }}</p>
          <p class="mt-2 max-w-2xl text-xs text-slate-300/85">
            Derived from recent average wait times (same metric as 'Crowd level' in the external park panel). This is
            not headcount per zone.
          </p>
        </div>
        <div class="text-right">
          <p class="font-display text-3xl font-bold text-white">{{ parkWideHeat.pct }}%</p>
          <p class="text-[10px] uppercase tracking-wide text-slate-400">vs recent wait spread</p>
        </div>
      </div>
    </div>

    <p
      v-if="hideInternalZoneTiles && zones.length"
      class="mb-3 rounded-lg border border-brand-500/25 bg-brand-950/30 px-3 py-2 text-xs text-slate-300"
    >
      {{ t('crowdHeatmap.zonesHiddenWhileExternal') }}
    </p>

    <p
      v-else-if="allInternalZonesIdle && zones.length"
      class="mb-3 rounded-lg border border-slate-700/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-400"
    >
      {{ t('crowdHeatmap.internalZonesIdleHint') }}
    </p>

    <div v-if="!zones.length" class="rounded-xl border border-dashed border-slate-700 py-16 text-center text-slate-500">
      {{ t('crowdHeatmap.noZones') }}
    </div>

    <div v-else-if="hideInternalZoneTiles" />

    <div v-else>
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Per-zone occupancy</p>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="z in sortedZones"
        :key="z.id"
        class="group relative overflow-hidden rounded-xl border p-4 transition hover:border-slate-600"
        :style="{
          background: heatStyle(utilization(z)).background,
          borderColor: heatStyle(utilization(z)).borderColor,
        }"
      >
        <div class="pointer-events-none absolute inset-0 opacity-[0.08]">
          <div
            class="h-full w-full bg-[length:12px_12px] bg-[linear-gradient(90deg,currentColor_1px,transparent_1px),linear-gradient(currentColor_1px,transparent_1px)] text-white"
          />
        </div>
        <div class="relative">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="font-display text-base font-semibold text-white">{{ z.name }}</h3>
              <p class="text-xs uppercase tracking-wide text-slate-300/90">
                {{ z.type?.replace(/_/g, ' ') ?? '—' }}
              </p>
            </div>
            <span
              class="rounded-md border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100"
            >
              {{ z.status }}
            </span>
          </div>

          <div class="mt-4">
            <div class="flex items-end justify-between text-sm">
              <span class="font-medium text-white">{{ utilization(z) }}%</span>
              <span class="text-xs text-slate-200/80">
                {{ z.currentCrowdLevel.toLocaleString() }} / {{ z.maxCapacity.toLocaleString() }}
              </span>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-black/25">
              <div
                class="h-full rounded-full bg-gradient-to-r from-brand-400 via-amber-400 to-rose-500 transition-[width] duration-500"
                :style="{ width: `${utilization(z)}%` }"
              />
            </div>
          </div>

          <div class="mt-3 flex justify-between text-[11px] text-slate-200/80">
            <span>Forecast</span>
            <span class="font-medium text-white">{{ z.forecastCrowdLevel.toLocaleString() }}</span>
          </div>
        </div>
      </article>
      </div>
    </div>
  </section>
</template>
