<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OperationFactBreakdownEntry, OperationFactRide } from '@/api/client'
import {
  badgeToneClass,
  breakdownUiBadge,
  factValueForKpi,
  formatOperationFactKpiValue,
  pilotKpiKeys,
  type OperationsFactPilotKpiKey,
} from '@/utils/operationsFactsPilot'

const props = defineProps<{
  ride: OperationFactRide | null
  loading?: boolean
  failed?: boolean
}>()

const { t } = useI18n()

type Row = { kpi: OperationsFactPilotKpiKey; value: unknown; breakdown: OperationFactBreakdownEntry | undefined }

const rows = computed<Row[]>(() => {
  const r = props.ride
  const keys = pilotKpiKeys()
  if (!r) return keys.map((kpi) => ({ kpi, value: null, breakdown: undefined }))
  const bd = r.sourceBreakdown || {}
  return keys.map((kpi) => ({
    kpi,
    value: factValueForKpi(r, kpi),
    breakdown: bd[kpi],
  }))
})

function badgeLabel(badge: ReturnType<typeof breakdownUiBadge>): string {
  return t(`operationsFactsPilot.badge.${badge}`)
}

function breakdownTooltip(entry: OperationFactBreakdownEntry | undefined): string {
  if (!entry) return ''
  return [
    `${t('operationsFactsPilot.tooltipConfidence')}: ${entry.confidence}`,
    `${t('operationsFactsPilot.tooltipReason')}: ${entry.reason}`,
  ].join('\n')
}

const warningLines = computed(() => props.ride?.warnings ?? [])
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-lg border border-sky-800/80 bg-sky-950/35 px-4 py-3 text-sm leading-snug text-sky-100">
      {{ t('operationsFactsPilot.banner') }}
    </div>

    <div v-if="loading" class="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
      {{ t('operationsFactsPilot.loadingFacts') }}
    </div>

    <div
      v-else-if="failed && !ride"
      class="rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-400"
    >
      {{ t('operationsFactsPilot.emptyAfterError') }}
    </div>

    <div v-else-if="ride" class="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h3 class="text-sm font-semibold text-white">{{ t('operationsFactsPilot.panelTitle') }}</h3>
      <p class="mt-1 text-xs text-slate-500">
        {{ ride.name ?? '—' }}<span v-if="ride.slug" class="text-slate-600"> · {{ ride.slug }}</span>
      </p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="row in rows"
          :key="row.kpi"
          class="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-slate-500">
              {{ t(`operationsFactsPilot.kpi.${row.kpi}`) }}
            </span>
            <span
              class="shrink-0 cursor-default rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              :class="badgeToneClass(breakdownUiBadge(row.breakdown))"
              :title="breakdownTooltip(row.breakdown)"
            >
              {{ badgeLabel(breakdownUiBadge(row.breakdown)) }}
            </span>
          </div>
          <div class="mt-1 text-lg font-semibold text-white">
            {{ formatOperationFactKpiValue(row.kpi, row.value) }}
          </div>
          <p
            v-if="row.breakdown"
            class="mt-1 cursor-default whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500"
            :title="breakdownTooltip(row.breakdown)"
          >
            <span class="text-slate-600">{{ t('operationsFactsPilot.metaConfidence') }}:</span>
            {{ row.breakdown.confidence }}
            <span class="mx-1 text-slate-700">·</span>
            <span class="text-slate-600">{{ t('operationsFactsPilot.metaReason') }}:</span>
            {{ row.breakdown.reason }}
          </p>
        </div>
      </div>
    </div>

    <details
      v-if="ride && warningLines.length"
      class="rounded-lg border border-amber-900/45 bg-amber-950/20 p-4 open:border-amber-800/60"
    >
      <summary class="cursor-pointer select-none text-sm font-semibold text-amber-100">
        {{ t('operationsFactsPilot.warningsTitle') }}
        <span class="ml-1 text-xs font-normal text-amber-200/80">({{ warningLines.length }})</span>
      </summary>
      <ul class="mt-2 list-inside list-disc space-y-1 text-sm text-amber-50/95">
        <li v-for="(line, i) in warningLines" :key="i">{{ line }}</li>
      </ul>
    </details>
  </div>
</template>
