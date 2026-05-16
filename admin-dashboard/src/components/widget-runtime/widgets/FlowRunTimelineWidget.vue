<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  data: unknown
  loading?: boolean
  error?: string | null
}>()

const { t } = useI18n()

const timeline = computed(() => {
  const d = props.data as { timeline?: unknown[] } | null | undefined
  return Array.isArray(d?.timeline) ? d!.timeline : []
})

const status = computed(() => {
  const d = props.data as { status?: string } | null | undefined
  return d?.status ? String(d.status) : ''
})
</script>

<template>
  <div class="rounded-lg border border-slate-700/80 bg-slate-900/60 p-4" data-testid="widget-flow-timeline">
    <p v-if="loading" class="text-sm text-slate-400">{{ t('widgetRuntime.loading') }}</p>
    <p v-else-if="error" class="text-sm text-red-300">{{ error }}</p>
    <template v-else-if="timeline.length">
      <p v-if="status" class="mb-2 text-xs uppercase tracking-wide text-slate-400">
        {{ t('widgetRuntime.timeline.runStatus') }}: <span class="text-slate-200">{{ status }}</span>
      </p>
      <ul class="space-y-1.5">
        <li
          v-for="(ev, idx) in timeline"
          :key="String((ev as Record<string, unknown>).nodeId ?? idx)"
          class="flex items-center gap-2 text-sm"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="{
              'bg-emerald-400': (ev as Record<string, unknown>).status === 'success',
              'bg-red-400': (ev as Record<string, unknown>).status === 'failed',
              'bg-amber-400': (ev as Record<string, unknown>).status === 'running',
              'bg-slate-500': true,
            }"
          />
          <span class="font-mono text-xs text-slate-300">{{ (ev as Record<string, unknown>).nodeId }}</span>
          <span class="text-xs text-slate-500">{{ (ev as Record<string, unknown>).nodeType }}</span>
          <span class="ml-auto text-xs uppercase text-slate-400">{{ (ev as Record<string, unknown>).status }}</span>
        </li>
      </ul>
    </template>
    <p v-else class="text-sm text-slate-500">{{ t('widgetRuntime.timeline.empty') }}</p>
  </div>
</template>
