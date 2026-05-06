<script setup lang="ts">
import { defineExpose, onMounted, ref } from 'vue'
import type { RecommendationScoringSummary } from '@/types/api'
import { getRecommendationScoringSummary, postScoreAllRecommendations } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

const auth = useAuthStore()
const { push: toast } = useToast()

const summary = ref<RecommendationScoringSummary | null>(null)
const loading = ref(true)
const busy = ref(false)

async function load() {
  if (!auth.hasPermission('ai', 'read')) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    summary.value = await getRecommendationScoringSummary()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load scoring summary', 'error')
  } finally {
    loading.value = false
  }
}

async function refreshScoring() {
  const can =
    auth.hasPermission('ai', 'refresh') || auth.hasPermission('recommendations', 'update')
  if (!can) {
    toast('No permission to run scoring', 'error')
    return
  }
  busy.value = true
  try {
    const out = await postScoreAllRecommendations()
    toast(`Scored ${out.scored} recommendations`, 'success')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Scoring failed', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
})

defineExpose({ load })
</script>

<template>
  <section
    v-if="auth.hasPermission('ai', 'read')"
    class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-panel"
  >
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-display text-lg font-semibold text-white">Recommendation risk (AI)</h2>
        <p class="mt-1 text-sm text-slate-400">Deterministic scoring from crowd, forecast, rides, staff, weather</p>
      </div>
      <button
        v-if="auth.hasPermission('ai', 'refresh') || auth.hasPermission('recommendations', 'update')"
        type="button"
        class="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-50"
        :disabled="busy || loading"
        @click="refreshScoring"
      >
        {{ busy ? 'Scoring…' : 'Refresh scoring' }}
      </button>
    </div>

    <div v-if="loading" class="py-8 text-center text-sm text-slate-500">Loading…</div>
    <template v-else-if="summary">
      <div class="mb-4 flex flex-wrap gap-4 text-sm">
        <div class="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p class="text-xs text-slate-500">Critical (urgency)</p>
          <p class="font-display text-xl font-bold text-rose-200">{{ summary.criticalRecommendationsCount }}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <p class="text-xs text-slate-500">Avg. confidence</p>
          <p class="font-display text-xl font-bold text-slate-100">
            {{
              summary.averageConfidence == null
                ? '—'
                : `${(summary.averageConfidence * 100).toFixed(0)}%`
            }}
          </p>
        </div>
      </div>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Top 5 risk</h3>
      <ul class="space-y-2">
        <li
          v-for="row in summary.topRiskyRecommendations"
          :key="row.recommendation.id"
          class="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium text-slate-200">{{ row.recommendation.recommendationType.replace(/_/g, ' ') }}</span>
            <span class="font-mono text-brand-200">{{ row.score ? Math.round(Number(row.score.score)) : '—' }}</span>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-slate-500">{{ row.recommendation.message }}</p>
        </li>
        <li v-if="!summary.topRiskyRecommendations.length" class="text-center text-sm text-slate-500">
          No scored OPEN recommendations yet. Run refresh scoring.
        </li>
      </ul>
    </template>
  </section>
</template>
