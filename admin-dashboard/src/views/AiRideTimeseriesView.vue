<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getPlatformAssets,
  getRideWaitTimeseries,
  upsertParkCalendarContext,
} from '@/api/client'
import type { RideWaitTimeseriesResponse } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useParkContextStore } from '@/stores/parkContext'
import { useAuthStore } from '@/stores/auth'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const dt = useRegionalDateTime()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()
const auth = useAuthStore()

const rides = ref<Array<{ id: string; name: string }>>([])
const selectedAssetId = ref('')
const days = ref(7)
const includeContext = ref(true)
const loading = ref(false)
const data = ref<RideWaitTimeseriesResponse | null>(null)

const canEditCalendar = computed(() => auth.hasPermission('ai', 'refresh'))
const calDate = ref('')
const calHoliday = ref(false)
const calSchool = ref(false)
const calName = ref('')
const calSaving = ref(false)

function isoRange() {
  const to = new Date()
  const from = new Date(to.getTime() - days.value * 24 * 60 * 60 * 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

const chartPoints = computed(() => {
  const samples = data.value?.waitSamples ?? []
  if (samples.length < 2) return null
  const ts = samples.map((s) => new Date(s.sampledAt).getTime())
  const waits = samples.map((s) => (s.waitTime == null ? 0 : Number(s.waitTime)))
  const t0 = ts[0]!
  const t1 = ts[ts.length - 1]!
  const span = Math.max(1, t1 - t0)
  const wMax = Math.max(1, ...waits)
  const pts = samples.map((_, i) => {
    const x = ((ts[i]! - t0) / span) * 100
    const y = 100 - (waits[i]! / wMax) * 100
    return `${x},${y}`
  })
  return { polyline: pts.join(' '), wMax, count: samples.length }
})

async function loadRides() {
  const pid = parkCtx.activeParkId
  if (!pid) {
    rides.value = []
    return
  }
  try {
    const assets = await getPlatformAssets({ parkId: pid, assetTypeCode: 'RIDE', limit: 500 })
    rides.value = assets.map((a) => ({
      id: String(a.assetId ?? ''),
      name: String(a.name ?? a.assetId ?? ''),
    })).filter((r) => r.id)
    if (!selectedAssetId.value && rides.value.length) {
      selectedAssetId.value = rides.value[0]!.id
    }
  } catch (e) {
    rides.value = []
    push(e instanceof Error ? e.message : 'Error', 'error')
  }
}

async function loadSeries() {
  if (!parkCtx.activeParkId) {
    push(t('aiTimeseries.needPark'), 'error')
    return
  }
  if (!selectedAssetId.value) {
    push(t('aiTimeseries.needRide'), 'error')
    return
  }
  loading.value = true
  try {
    const { from, to } = isoRange()
    data.value = await getRideWaitTimeseries(selectedAssetId.value, {
      from,
      to,
      includeContext: includeContext.value,
    })
  } catch (e) {
    data.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function saveCalendar() {
  if (!calDate.value || !/^\d{4}-\d{2}-\d{2}$/.test(calDate.value)) {
    push(t('aiTimeseries.calInvalidDate'), 'error')
    return
  }
  calSaving.value = true
  try {
    await upsertParkCalendarContext({
      contextDate: calDate.value,
      isPublicHoliday: calHoliday.value,
      isSchoolBreak: calSchool.value,
      holidayName: calName.value.trim() || null,
      source: 'manual',
    })
    push(t('aiTimeseries.calSaved'), 'success')
    if (includeContext.value) await loadSeries()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    calSaving.value = false
  }
}

watch(
  () => parkCtx.activeParkId,
  () => {
    selectedAssetId.value = ''
    void loadRides()
  },
  { immediate: true }
)
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap gap-3 text-sm">
      <RouterLink to="/ai-insights" class="text-brand-400 hover:text-brand-300">← {{ t('aiTimeseries.back') }}</RouterLink>
      <RouterLink to="/ai-insights" class="text-slate-500 hover:text-brand-300">{{ t('aiRideGrid.navLink') }}</RouterLink>
    </div>

    <div>
      <h1 :class="ui.title">{{ t('aiTimeseries.title') }}</h1>
      <p :class="ui.subtitle">{{ t('aiTimeseries.subtitle') }}</p>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.card" class="text-amber-600 dark:text-amber-400">
      {{ t('aiTimeseries.needPark') }}
    </div>

    <div v-else :class="ui.card" class="flex flex-wrap items-end gap-4">
      <div class="min-w-[200px] flex-1">
        <label :class="ui.label" for="ts-ride">{{ t('aiTimeseries.ride') }}</label>
        <select id="ts-ride" v-model="selectedAssetId" :class="ui.control" class="!mt-1 w-full">
          <option v-for="r in rides" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>
      <div>
        <label :class="ui.label" for="ts-days">{{ t('aiTimeseries.days') }}</label>
        <select id="ts-days" v-model.number="days" :class="ui.control" class="!mt-1 max-w-[120px]">
          <option :value="1">1</option>
          <option :value="7">7</option>
          <option :value="14">14</option>
          <option :value="30">30</option>
        </select>
      </div>
      <label class="flex items-center gap-2 pb-1 text-sm" :class="ui.muted">
        <input v-model="includeContext" type="checkbox" class="rounded border-slate-500" />
        {{ t('aiTimeseries.includeContext') }}
      </label>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="loading || !selectedAssetId"
        @click="loadSeries()"
      >
        {{ t('btn.refresh') }}
      </button>
    </div>

    <div v-if="loading" :class="ui.muted">{{ t('aiTimeseries.loading') }}</div>

    <template v-else-if="data">
      <div :class="ui.card" class="space-y-2">
        <h2 class="text-sm font-semibold" :class="ui.muted">{{ t('aiTimeseries.chartTitle') }}</h2>
        <p class="text-xs" :class="ui.muted">
          {{ data.assetName }} · {{ data.waitSamples.length }} {{ t('aiTimeseries.samples') }}
        </p>
        <div v-if="chartPoints" class="w-full overflow-hidden rounded border border-slate-600/40 bg-slate-900/40 dark:bg-slate-950/60">
          <svg
            class="h-40 w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              fill="none"
              stroke="currentColor"
              class="text-brand-400"
              stroke-width="0.6"
              vector-effect="non-scaling-stroke"
              :points="chartPoints.polyline"
            />
          </svg>
        </div>
        <p v-else :class="ui.muted">{{ t('aiTimeseries.chartEmpty') }}</p>
        <p v-if="chartPoints" class="text-[10px] opacity-50">
          {{
            t('aiRideGrid.timesShownIn', {
              tz: dt.getTimezoneLabel(),
              mode: dt.prefs.value.timeFormat === '12h' ? '12h' : '24h',
            })
          }}
        </p>
      </div>

      <div v-if="includeContext && data.weather.length" :class="ui.card" class="overflow-x-auto">
        <h2 class="mb-2 text-sm font-semibold" :class="ui.muted">{{ t('aiTimeseries.weatherTitle') }}</h2>
        <table class="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr :class="ui.muted">
              <th class="py-1 pr-2">{{ t('aiTimeseries.colTime') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colTemp') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colRain') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colCond') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in data.weather.slice(-50)" :key="w.id" class="border-t border-slate-700/50">
              <td class="py-1 pr-2 font-mono text-xs">{{ dt.formatDateTime(w.observedAt) }}</td>
              <td class="py-1 pr-2">{{ w.temperatureC ?? '—' }}</td>
              <td class="py-1 pr-2">{{ w.rainMm ?? '—' }}</td>
              <td class="py-1 pr-2">{{ w.condition }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="includeContext && data.calendar.length" :class="ui.card" class="overflow-x-auto">
        <h2 class="mb-2 text-sm font-semibold" :class="ui.muted">{{ t('aiTimeseries.calendarTitle') }}</h2>
        <table class="w-full text-left text-sm">
          <thead>
            <tr :class="ui.muted">
              <th class="py-1 pr-2">{{ t('aiTimeseries.colDate') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colHoliday') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colSchool') }}</th>
              <th class="py-1 pr-2">{{ t('aiTimeseries.colName') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in data.calendar" :key="c.id" class="border-t border-slate-700/50">
              <td class="py-1 pr-2 font-mono text-xs">{{ c.contextDate }}</td>
              <td class="py-1 pr-2">{{ c.isPublicHoliday ? '✓' : '—' }}</td>
              <td class="py-1 pr-2">{{ c.isSchoolBreak ? '✓' : '—' }}</td>
              <td class="py-1 pr-2">{{ c.holidayName ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="canEditCalendar" :class="ui.card" class="space-y-3">
        <h2 class="text-sm font-semibold" :class="ui.muted">{{ t('aiTimeseries.calEditorTitle') }}</h2>
        <p class="text-xs" :class="ui.muted">{{ t('aiTimeseries.calEditorHint') }}</p>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label :class="ui.label" for="cal-d">{{ t('aiTimeseries.colDate') }}</label>
            <input id="cal-d" v-model="calDate" type="date" :class="ui.control" class="!mt-1" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="calHoliday" type="checkbox" class="rounded border-slate-500" />
            {{ t('aiTimeseries.colHoliday') }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="calSchool" type="checkbox" class="rounded border-slate-500" />
            {{ t('aiTimeseries.colSchool') }}
          </label>
          <div class="min-w-[180px] flex-1">
            <label :class="ui.label" for="cal-n">{{ t('aiTimeseries.colName') }}</label>
            <input id="cal-n" v-model="calName" type="text" :class="ui.control" class="!mt-1 w-full" />
          </div>
          <button
            type="button"
            class="rounded-md border border-slate-500 px-3 py-2 text-sm disabled:opacity-50"
            :disabled="calSaving"
            @click="saveCalendar()"
          >
            {{ t('btn.save') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
