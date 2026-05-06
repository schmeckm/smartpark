<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getDataQualityIssues, resolveDataQualityIssue, type DqIssue } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { formatDateTime } = useRegionalDateTime()
const rows = ref<DqIssue[]>([])
const busy = ref(false)
const { push } = useToast()

async function load() {
  busy.value = true
  try {
    const r = await getDataQualityIssues({ limit: 100, resolved: false })
    rows.value = r.data
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load', 'error')
  } finally {
    busy.value = false
  }
}

async function resolveId(id: string) {
  try {
    await resolveDataQualityIssue(id)
    push('Marked resolved', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-xl font-semibold text-white">Data quality</h1>
      <button
        class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
        :disabled="busy"
        @click="load"
      >
        Refresh
      </button>
    </div>
    <ul class="space-y-2">
      <li
        v-for="r in rows"
        :key="r.id"
        class="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm"
      >
        <div>
          <p class="font-mono text-xs text-brand-200">{{ r.issueType }} · {{ r.severity }}</p>
          <p class="text-slate-300">{{ r.message }}</p>
          <p class="text-xs text-slate-500">{{ formatDateTime(r.createdAt) }}</p>
        </div>
        <button
          class="shrink-0 rounded bg-slate-700 px-2 py-1 text-xs text-white"
          @click="resolveId(r.id)"
        >
          Resolve
        </button>
      </li>
    </ul>
    <p v-if="!rows.length" class="text-sm text-slate-500">No open issues.</p>
  </div>
</template>
