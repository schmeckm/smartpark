<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { Ride, RideStatus } from '@/types/api'

const props = defineProps<{
  ride: Ride | null
  loading: boolean
  error: Error | null
}>()

const { t } = useI18n()

const statusTone: Record<RideStatus, string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
  CLOSED: 'bg-slate-700/40 text-slate-300 ring-1 ring-slate-600',
  MAINTENANCE: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40',
}

const statusClass = computed(() =>
  props.ride ? statusTone[props.ride.status] ?? statusTone.CLOSED : statusTone.CLOSED,
)
</script>

<template>
  <header class="border-b border-slate-800 bg-slate-950/70 px-6 pb-3 pt-4">
    <div class="mb-2">
      <RouterLink
        :to="{ name: 'master-data', params: { entityType: 'rides' } }"
        class="text-xs font-medium text-slate-400 hover:text-slate-200"
      >
        ← {{ t('ride.backToList') }}
      </RouterLink>
    </div>

    <div v-if="loading" class="h-6 w-48 animate-pulse rounded bg-slate-800" aria-hidden="true" />

    <div v-else-if="error" class="text-sm text-rose-300">
      {{ t('ride.loadError') }}: {{ error.message }}
    </div>

    <div v-else-if="ride" class="flex flex-wrap items-baseline gap-3">
      <h1 class="font-display text-xl font-semibold text-white">{{ ride.name }}</h1>
      <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider" :class="statusClass">
        {{ ride.status }}
      </span>
      <span v-if="ride.zone?.name" class="text-xs text-slate-400">{{ ride.zone.name }}</span>
    </div>

    <div v-if="ride" class="mt-3 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
      <div>
        <p class="uppercase tracking-wider text-slate-500">{{ t('ride.kpi.waitTime') }}</p>
        <p class="mt-0.5 text-base font-semibold text-white">{{ ride.waitTime }} {{ t('ride.kpi.minutes') }}</p>
      </div>
      <div>
        <p class="uppercase tracking-wider text-slate-500">{{ t('ride.kpi.capacity') }}</p>
        <p class="mt-0.5 text-base font-semibold text-white">{{ ride.capacityPerHour }} / h</p>
      </div>
      <div>
        <p class="uppercase tracking-wider text-slate-500">{{ t('ride.kpi.criticality') }}</p>
        <p class="mt-0.5 text-base font-semibold text-white">{{ ride.criticality }}</p>
      </div>
      <div>
        <p class="uppercase tracking-wider text-slate-500">{{ t('ride.kpi.zone') }}</p>
        <p class="mt-0.5 text-base font-semibold text-white">{{ ride.zone?.name ?? '—' }}</p>
      </div>
    </div>
  </header>
</template>
