<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Recommendation, RecommendationScore, RecommendationStatus } from '../types/api'
import { updateRecommendationStatus } from '../api/client'
import { useAuthStore } from '@/stores/auth'

defineProps<{
  recommendations: Recommendation[]
}>()

const emit = defineEmits<{
  updated: [Recommendation]
}>()

const auth = useAuthStore()
const canUpdateRecommendations = computed(() => auth.hasPermission('recommendations', 'update'))

const busyId = ref<string | null>(null)
const expandedWhy = ref<Record<string, boolean>>({})

function priorityClass(p: Recommendation['priority']) {
  if (p === 'CRITICAL') return 'text-red-300 ring-red-500/40 bg-red-500/10'
  if (p === 'HIGH') return 'text-amber-200 ring-amber-500/35 bg-amber-500/10'
  if (p === 'MEDIUM') return 'text-sky-200 ring-sky-500/30 bg-sky-500/10'
  return 'text-slate-300 ring-slate-600 bg-slate-800/80'
}

function urgencyClass(u: RecommendationScore['urgency']) {
  if (u === 'CRITICAL') return 'bg-rose-500/15 text-rose-100 ring-rose-500/35'
  if (u === 'HIGH') return 'bg-amber-500/15 text-amber-100 ring-amber-500/30'
  if (u === 'MEDIUM') return 'bg-sky-500/10 text-sky-100 ring-sky-500/25'
  return 'bg-slate-700/80 text-slate-200 ring-slate-600'
}

function impactClass(i: RecommendationScore['impact']) {
  return urgencyClass(i)
}

function typeShort(t: Recommendation['recommendationType']) {
  return t.replace(/_/g, ' ')
}

function toggleWhy(id: string) {
  expandedWhy.value = { ...expandedWhy.value, [id]: !expandedWhy.value[id] }
}

function benefitSummary(b: RecommendationScore['expectedBenefit']) {
  if (!b) return '—'
  const parts: string[] = []
  if (b.waitTimeReductionMinutes != null) parts.push(`~${b.waitTimeReductionMinutes}m wait`)
  if (b.crowdReductionPercent != null) parts.push(`~${b.crowdReductionPercent}% crowd`)
  if (b.staffEfficiencyGainPercent != null) parts.push(`~${b.staffEfficiencyGainPercent}% staff eff.`)
  return parts.length ? parts.join(' · ') : '—'
}

async function setStatus(id: string, status: RecommendationStatus) {
  busyId.value = id
  try {
    const updated = await updateRecommendationStatus(id, status)
    emit('updated', updated)
  } catch {
    /* surface via parent if needed */
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <section class="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-panel">
    <div class="mb-4">
      <h2 class="font-display text-lg font-semibold text-white">Recommendations</h2>
      <p class="mt-1 text-sm text-slate-400">Rule-based playbooks with AI scoring layer · accept or reject in one click</p>
    </div>

    <ul class="flex max-h-[min(70vh,520px)] flex-col gap-3 overflow-y-auto pr-1">
      <li
        v-for="rec in recommendations"
        :key="rec.id"
        class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 transition hover:border-slate-700"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset"
              :class="priorityClass(rec.priority)"
            >
              {{ rec.priority }}
            </span>
            <span class="text-xs font-medium text-brand-200/90">{{ typeShort(rec.recommendationType) }}</span>
            <span
              class="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-400"
            >
              {{ rec.status }}
            </span>
            <template v-if="rec.score">
              <span
                class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset text-violet-100 ring-violet-500/40 bg-violet-500/15"
                title="AI composite score"
              >
                AI {{ Math.round(Number(rec.score.score)) }}
              </span>
              <span
                class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset"
                :class="urgencyClass(rec.score.urgency)"
              >
                {{ rec.score.urgency }}
              </span>
              <span
                class="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset"
                :class="impactClass(rec.score.impact)"
              >
                Impact {{ rec.score.impact }}
              </span>
              <span class="rounded-md bg-slate-800/90 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                Conf {{ (Number(rec.score.confidence) * 100).toFixed(0) }}%
              </span>
            </template>
          </div>
          <div
            v-if="rec.status === 'OPEN' && canUpdateRecommendations"
            class="flex flex-wrap gap-1.5"
          >
            <button
              type="button"
              class="rounded-md bg-emerald-600/90 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              :disabled="busyId === rec.id"
              @click="setStatus(rec.id, 'ACCEPTED')"
            >
              Accept
            </button>
            <button
              type="button"
              class="rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50"
              :disabled="busyId === rec.id"
              @click="setStatus(rec.id, 'REJECTED')"
            >
              Reject
            </button>
            <button
              type="button"
              class="rounded-md border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              :disabled="busyId === rec.id"
              @click="setStatus(rec.id, 'COMPLETED')"
            >
              Done
            </button>
          </div>
        </div>
        <p class="mt-2 text-sm leading-relaxed text-slate-200">{{ rec.message }}</p>
        <p v-if="rec.event?.zone?.name" class="mt-2 text-xs text-slate-500">
          Zone: <span class="text-slate-400">{{ rec.event.zone.name }}</span>
        </p>
        <div v-if="rec.score?.expectedBenefit" class="mt-2 text-xs text-slate-500">
          Expected benefit: <span class="text-slate-300">{{ benefitSummary(rec.score.expectedBenefit) }}</span>
        </div>
        <div v-if="rec.score" class="mt-2">
          <button
            type="button"
            class="text-xs font-medium text-brand-300 hover:text-brand-200"
            @click="toggleWhy(rec.id)"
          >
            {{ expandedWhy[rec.id] ? 'Hide “Why?”' : 'Why? (AI explanation)' }}
          </button>
          <div
            v-if="expandedWhy[rec.id] && rec.score.explanation"
            class="mt-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-3 text-xs text-slate-300"
          >
            <p class="font-medium text-slate-200">{{ rec.score.explanation.summary }}</p>
            <ul class="mt-2 list-inside list-disc space-y-1 text-slate-400">
              <li v-for="(r, idx) in rec.score.explanation.reasons" :key="idx">{{ r }}</li>
            </ul>
          </div>
        </div>
      </li>

      <li
        v-if="!recommendations.length"
        class="rounded-xl border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500"
      >
        No recommendations in view.
      </li>
    </ul>
  </section>
</template>
