<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  data: unknown
  loading?: boolean
  error?: string | null
}>()

const { t } = useI18n()
const router = useRouter()

const items = computed(() => {
  const d = props.data as { items?: unknown[] } | null | undefined
  return Array.isArray(d?.items) ? d!.items : []
})

function openStudio() {
  void router.push({ name: 'integration-flow-studio' })
}
</script>

<template>
  <div class="rounded-lg border border-slate-700/80 bg-slate-900/60 p-4" data-testid="widget-failed-runs">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h4 class="text-sm font-medium text-slate-200">{{ t('widgetRuntime.failedRuns.title') }}</h4>
      <button
        type="button"
        class="text-xs font-medium text-brand-400 hover:text-brand-300"
        data-testid="widget-failed-runs-open"
        @click="openStudio"
      >
        {{ t('widgetRuntime.failedRuns.openStudio') }}
      </button>
    </div>
    <p v-if="loading" class="text-sm text-slate-400">{{ t('widgetRuntime.loading') }}</p>
    <p v-else-if="error" class="text-sm text-red-300">{{ error }}</p>
    <ul v-else-if="items.length" class="space-y-2 text-sm">
      <li
        v-for="(row, idx) in items.slice(0, 8)"
        :key="String((row as Record<string, unknown>).id ?? idx)"
        class="rounded border border-slate-700/60 bg-slate-950/50 px-2 py-1.5"
      >
        <p class="font-medium text-slate-200">
          {{ (row as Record<string, unknown>).flowName || (row as Record<string, unknown>).flowId }}
        </p>
        <p class="text-xs text-slate-400">
          {{ t('widgetRuntime.failedRuns.retryStatus') }}:
          <span class="text-amber-200">{{ (row as Record<string, unknown>).retryStatus || '—' }}</span>
        </p>
      </li>
    </ul>
    <p v-else class="text-sm text-slate-500">{{ t('widgetRuntime.failedRuns.empty') }}</p>
  </div>
</template>
