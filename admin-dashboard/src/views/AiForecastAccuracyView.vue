<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getZoneCrowdForecastAccuracy } from '@/api/client'
import type { ZoneCrowdForecastAccuracy } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'

const { t } = useI18n()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const days = ref(7)
const horizon = ref<15 | 60 | 180>(60)
const loading = ref(false)
const data = ref<ZoneCrowdForecastAccuracy | null>(null)

const maxMae = computed(() => {
  const z = data.value?.zones ?? []
  if (!z.length) return 1
  const m = Math.max(...z.map((x) => x.mae), 0.01)
  return m
})

function barWidthPct(mae: number) {
  return Math.min(100, Math.round((mae / maxMae.value) * 1000) / 10)
}

async function load() {
  loading.value = true
  try {
    data.value = await getZoneCrowdForecastAccuracy({
      days: days.value,
      horizonMinutes: horizon.value,
    })
  } catch (e) {
    data.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

void load()
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiAccuracy.back') }}</RouterLink>

    <div>
      <h1 :class="ui.title">{{ t('aiAccuracy.title') }}</h1>
      <p :class="ui.subtitle">{{ t('aiAccuracy.subtitle') }}</p>
    </div>

    <div :class="ui.card" class="flex flex-wrap items-end gap-4">
      <div>
        <label :class="ui.label" for="acc-days">{{ t('aiAccuracy.days') }}</label>
        <select id="acc-days" v-model.number="days" :class="ui.control" class="!mt-1 max-w-[140px]">
          <option :value="1">1</option>
          <option :value="7">7</option>
          <option :value="14">14</option>
          <option :value="30">30</option>
        </select>
      </div>
      <div>
        <label :class="ui.label" for="acc-horizon">{{ t('aiAccuracy.horizon') }}</label>
        <select id="acc-horizon" v-model.number="horizon" :class="ui.control" class="!mt-1 max-w-[140px]">
          <option :value="15">15 min</option>
          <option :value="60">60 min</option>
          <option :value="180">180 min</option>
        </select>
      </div>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="loading"
        @click="load()"
      >
        {{ t('btn.refresh') }}
      </button>
    </div>

    <div v-if="loading" :class="ui.muted">{{ t('aiAccuracy.loading') }}</div>

    <template v-else-if="data">
      <div :class="ui.card" class="grid gap-4 sm:grid-cols-3">
        <div>
          <p :class="ui.statLabel">{{ t('aiAccuracy.overallMae') }}</p>
          <p :class="ui.statValue">{{ data.overallMae ?? '—' }}</p>
        </div>
        <div>
          <p :class="ui.statLabel">{{ t('aiAccuracy.matched') }}</p>
          <p :class="ui.statValue">{{ data.matchedPoints }}</p>
        </div>
        <div>
          <p :class="ui.statLabel">{{ t('aiAccuracy.forecasts') }}</p>
          <p :class="ui.statValue">{{ data.forecastsConsidered }}</p>
        </div>
      </div>

      <div v-if="data.zones.length" :class="ui.card" class="space-y-3">
        <h2 :class="ui.h2">{{ t('aiAccuracy.chartTitle') }}</h2>
        <div v-for="z in data.zones" :key="'b-' + z.zoneId" class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <div class="w-full shrink-0 text-xs text-slate-400 sm:w-40 sm:truncate">{{ z.zoneName }}</div>
          <div class="min-w-0 flex-1">
            <div :class="ui.barTrack">
              <div :class="ui.barFill" :style="{ width: barWidthPct(z.mae) + '%' }" />
            </div>
          </div>
          <div class="shrink-0 text-right font-mono text-xs text-slate-300 sm:w-14">{{ z.mae }}</div>
        </div>
      </div>

      <div :class="ui.card" class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead>
            <tr :class="ui.tableHead">
              <th class="py-2 pr-4">{{ t('aiAccuracy.colZone') }}</th>
              <th class="py-2 pr-4">{{ t('aiAccuracy.colMae') }}</th>
              <th class="py-2">{{ t('aiAccuracy.colSamples') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="z in data.zones" :key="z.zoneId" :class="ui.tableRow">
              <td :class="ui.tableCell + ' pr-4'">{{ z.zoneName }}</td>
              <td :class="ui.tableCell + ' pr-4 font-mono'">{{ z.mae }}</td>
              <td :class="ui.tableCellMuted">{{ z.count }}</td>
            </tr>
            <tr v-if="!data.zones.length">
              <td colspan="3" :class="ui.muted" class="py-6 text-center">{{ t('aiAccuracy.empty') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
