<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentApprovalMetricsPayload } from '@/types/api'
import { usePageSurfaces } from '@/composables/usePageSurfaces'

const props = defineProps<{
  summary: AgentApprovalMetricsPayload | null
  loading: boolean
  /** Full heading line; when omitted, uses default park-wide title with window days. */
  titleOverride?: string | null
}>()

const { t } = useI18n()
const { surfaces: ui } = usePageSurfaces()

const heading = computed(() => {
  if (props.titleOverride && props.titleOverride.trim()) return props.titleOverride.trim()
  return t('agentPage.approvalMetricsTitle', { days: props.summary?.windowDays ?? 30 })
})
</script>

<template>
  <div
    :class="[ui.infoBox, 'flex flex-col gap-1 border-slate-200/80 dark:border-slate-700/80']"
  >
    <p class="text-xs font-medium text-slate-700 dark:text-slate-200">
      {{ heading }}
    </p>
    <p v-if="loading" :class="ui.muted">{{ t('agentPage.loading') }}</p>
    <p v-else-if="!summary" class="text-xs text-slate-500">{{ t('agentPage.approvalMetricsUnavailable') }}</p>
    <p v-else-if="summary.decided === 0" class="text-xs text-slate-600 dark:text-slate-300">
      {{ t('agentPage.approvalMetricsNoResolved') }}
    </p>
    <p v-else class="text-xs text-slate-600 dark:text-slate-300">
      {{
        t('agentPage.approvalMetricsRate', {
          applied: summary.applied,
          decided: summary.decided,
          pct: ((summary.approvalRate ?? 0) * 100).toFixed(1),
        })
      }}
      <span v-if="summary.pending > 0" class="text-slate-500">
        · {{ t('agentPage.approvalMetricsPending', { n: summary.pending }) }}
      </span>
    </p>
  </div>
</template>
