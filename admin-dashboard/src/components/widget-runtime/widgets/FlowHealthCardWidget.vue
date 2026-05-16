<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  data: unknown
  loading?: boolean
  error?: string | null
}>()

const { t } = useI18n()

const summary = computed(() => {
  const d = props.data as Record<string, unknown> | null | undefined
  if (!d || typeof d !== 'object') return null
  return {
    totalFlows: Number(d.totalFlows ?? 0),
    enabledFlows: Number(d.enabledFlows ?? 0),
    scheduledFlows: Number(d.scheduledFlows ?? 0),
    failedRuns: Number(d.failedRuns ?? 0),
    flowsWithRecentFailure: Number(d.flowsWithRecentFailure ?? 0),
  }
})
</script>

<template>
  <div class="rounded-lg border border-slate-700/80 bg-slate-900/60 p-4" data-testid="widget-flow-health">
    <p v-if="loading" class="text-sm text-slate-400">{{ t('widgetRuntime.loading') }}</p>
    <p v-else-if="error" class="text-sm text-red-300">{{ error }}</p>
    <template v-else-if="summary">
      <dl class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt class="text-slate-400">{{ t('widgetRuntime.flowHealth.total') }}</dt>
          <dd class="text-lg font-semibold text-slate-100">{{ summary.totalFlows }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">{{ t('widgetRuntime.flowHealth.enabled') }}</dt>
          <dd class="text-lg font-semibold text-emerald-300">{{ summary.enabledFlows }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">{{ t('widgetRuntime.flowHealth.scheduled') }}</dt>
          <dd class="text-lg font-semibold text-amber-200">{{ summary.scheduledFlows }}</dd>
        </div>
        <div>
          <dt class="text-slate-400">{{ t('widgetRuntime.flowHealth.failedRuns') }}</dt>
          <dd class="text-lg font-semibold text-red-300">{{ summary.failedRuns }}</dd>
        </div>
      </dl>
      <p class="mt-2 text-xs text-slate-500">
        {{ t('widgetRuntime.flowHealth.flowsWithFailure', { count: summary.flowsWithRecentFailure }) }}
      </p>
    </template>
    <p v-else class="text-sm text-slate-500">{{ t('widgetRuntime.noData') }}</p>
  </div>
</template>
