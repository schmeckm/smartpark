<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  data: unknown
  loading?: boolean
  error?: string | null
}>()

const { t } = useI18n()

const run = computed(() => {
  const d = props.data as { run?: Record<string, unknown> | null } | null | undefined
  return d?.run && typeof d.run === 'object' ? d.run : null
})

const flowId = computed(() => {
  const d = props.data as { flowId?: string } | null | undefined
  return d?.flowId ? String(d.flowId) : ''
})
</script>

<template>
  <div class="rounded-lg border border-slate-700/80 bg-slate-900/60 p-4" data-testid="widget-flow-status-summary">
    <p v-if="loading" class="text-sm text-slate-400">{{ t('widgetRuntime.loading') }}</p>
    <p v-else-if="error" class="text-sm text-red-300">{{ error }}</p>
    <template v-else-if="run">
      <p class="text-xs text-slate-500">{{ t('widgetRuntime.statusSummary.flowId') }}</p>
      <p class="mb-2 font-mono text-xs text-slate-300">{{ flowId }}</p>
      <p class="text-sm text-slate-200">
        {{ t('widgetRuntime.statusSummary.runStatus') }}:
        <span class="font-medium uppercase">{{ run.status }}</span>
      </p>
      <p v-if="run.durationMs != null" class="mt-1 text-xs text-slate-400">
        {{ t('widgetRuntime.statusSummary.duration') }}: {{ run.durationMs }} ms
      </p>
    </template>
    <p v-else class="text-sm text-slate-500">{{ t('widgetRuntime.statusSummary.noRun') }}</p>
  </div>
</template>
