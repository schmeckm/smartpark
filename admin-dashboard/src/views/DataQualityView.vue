<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getDataQualityIssues, resolveDataQualityIssue, type DqIssue } from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const rows = ref<DqIssue[]>([])
const busy = ref(false)
const severityFilter = ref<'all' | string>('all')
const { push } = useToast()

const severityOptions = computed(() => {
  const s = new Set<string>()
  for (const r of rows.value) {
    const x = String(r.severity || '').trim()
    if (x) s.add(x)
  }
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
})

const filteredRows = computed(() => {
  if (severityFilter.value === 'all') return rows.value
  return rows.value.filter((r) => String(r.severity || '').toLowerCase() === severityFilter.value.toLowerCase())
})

async function load() {
  busy.value = true
  try {
    const r = await getDataQualityIssues({ limit: 100, resolved: false })
    rows.value = r.data
  } catch (e) {
    push(e instanceof Error ? e.message : t('dataQualityView.loadFailed'), 'error')
  } finally {
    busy.value = false
  }
}

async function resolveId(id: string) {
  try {
    await resolveDataQualityIssue(id)
    push(t('dataQualityView.resolved'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('dataQualityView.resolveFailed'), 'error')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('dataQualityView.title') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('dataQualityView.subtitle') }}</p>
        <p class="mt-2 text-xs text-slate-500">
          <RouterLink to="/uns/governance" class="text-brand-200 underline hover:text-brand-100">{{
            t('dataQualityView.linkGovernance')
          }}</RouterLink>
        </p>
      </div>
      <button
        class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
        :disabled="busy"
        @click="load"
      >
        {{ busy ? '…' : t('dataQualityView.refresh') }}
      </button>
    </div>

    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="text-xs text-slate-500">
        {{ t('dataQualityView.filterSeverity') }}
        <select v-model="severityFilter" class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white">
          <option value="all">{{ t('dataQualityView.all') }}</option>
          <option v-for="sev in severityOptions" :key="sev" :value="sev">{{ sev }}</option>
        </select>
      </label>
    </div>

    <ul class="space-y-2">
      <li
        v-for="r in filteredRows"
        :key="r.id"
        class="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm"
      >
        <div>
          <p class="font-mono text-xs text-brand-200">{{ r.issueType }} · {{ r.severity }}</p>
          <p class="text-slate-300">{{ r.message }}</p>
          <p class="text-xs text-slate-500">{{ formatDateTime(r.createdAt) }}</p>
        </div>
        <button
          class="shrink-0 rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600"
          @click="resolveId(r.id)"
        >
          {{ t('dataQualityView.resolve') }}
        </button>
      </li>
    </ul>
    <p v-if="!filteredRows.length" class="text-sm text-slate-500">{{ t('dataQualityView.empty') }}</p>
  </div>
</template>
