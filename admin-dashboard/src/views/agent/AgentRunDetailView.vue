<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AgentApprovalMetricsStrip from '@/components/agent/AgentApprovalMetricsStrip.vue'
import { getAgentApprovalMetrics, getAgentRun, postAgentPreflight, replayAgentRun } from '@/api/client'
import type {
  AgentApprovalMetricsPayload,
  AgentPreflightPayload,
  AgentRunDetail as AgentRunDetailType,
  AgentSkillId,
} from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const detail = ref<AgentRunDetailType | null>(null)
const loading = ref(false)
const replayBusy = ref(false)
const preflightBusy = ref(false)
const preflightResult = ref<AgentPreflightPayload | null>(null)
const runApprovalSummary = ref<AgentApprovalMetricsPayload | null>(null)
const runApprovalLoading = ref(false)

const canRunAgent = computed(() => auth.hasPermission('agent', 'run'))
const canReadMetrics = computed(() => auth.hasPermission('agent', 'read'))

const runId = computed(() => String(route.params.id || ''))

function skillLabel(skillId: string): string {
  if (skillId === 'daily_executive_brief') return t('agentPage.skillDailyBrief')
  if (skillId === 'crowd_spike_triage') return t('agentPage.skillCrowdSpike')
  if (skillId === 'mapping_assistant') return t('agentPage.skillMappingAssistant')
  if (skillId === 'weather_pivot') return t('agentPage.skillWeatherPivot')
  if (skillId === 'ride_down_response') return t('agentPage.skillRideDownResponse')
  return skillId
}

function jsonPreview(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function statusBadgeClass(status: string): string {
  if (status === 'succeeded') return 'bg-emerald-600/90 text-white'
  if (status === 'running') return 'bg-sky-600/90 text-white'
  if (status === 'failed') return 'bg-rose-600/90 text-white'
  return 'bg-slate-600/80 text-white'
}

async function loadRunApprovalMetrics() {
  if (!parkCtx.activeParkId || !canReadMetrics.value || !detail.value) {
    runApprovalSummary.value = null
    return
  }
  runApprovalLoading.value = true
  try {
    runApprovalSummary.value = await getAgentApprovalMetrics({
      skillId: detail.value.skillId as AgentSkillId,
      sinceDays: 30,
    })
  } catch {
    runApprovalSummary.value = null
  } finally {
    runApprovalLoading.value = false
  }
}

async function load() {
  if (!parkCtx.activeParkId || !runId.value) {
    detail.value = null
    runApprovalSummary.value = null
    return
  }
  loading.value = true
  try {
    detail.value = await getAgentRun(runId.value)
  } catch (e) {
    detail.value = null
    runApprovalSummary.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
  await loadRunApprovalMetrics()
}

const sortedSteps = computed(() => {
  const s = detail.value?.steps || []
  return [...s].sort((a, b) => a.stepIndex - b.stepIndex)
})

const approvalStripTitle = computed(() => {
  const d = detail.value
  if (!d) return null
  return String(
    t('agentPage.approvalMetricsTitleScoped', {
      skill: skillLabel(d.skillId),
      days: runApprovalSummary.value?.windowDays ?? 30,
    })
  )
})

onMounted(() => {
  void load()
})

watch([() => parkCtx.activeParkId, runId], () => {
  void load()
})

watch(runId, () => {
  preflightResult.value = null
})

async function onReplay() {
  const d = detail.value
  const parkId = parkCtx.activeParkId
  if (!d || !parkId) return
  replayBusy.value = true
  try {
    const next = await replayAgentRun(d.id)
    push(t('agentPage.replayStarted'), 'success')
    await router.push(`/agent/runs/${next.id}`)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    replayBusy.value = false
  }
}

async function onPreflight() {
  const d = detail.value
  const parkId = parkCtx.activeParkId
  if (!d || !parkId) return
  preflightBusy.value = true
  try {
    preflightResult.value = await postAgentPreflight({
      parkId,
      skillId: d.skillId as AgentSkillId,
      sourceRunId: d.id,
    })
    push(t('agentPage.preflightDone'), preflightResult.value.ok ? 'success' : 'error')
    void loadRunApprovalMetrics()
  } catch (e) {
    preflightResult.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    preflightBusy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <RouterLink
          to="/agent/runs"
          class="text-xs font-medium text-brand-600 hover:text-brand-500 hover:underline"
        >
          {{ t('agentPage.backToRuns') }}
        </RouterLink>
        <h1 :class="ui.title + ' mt-1'">{{ t('agentPage.runDetailTitle') }}</h1>
        <p :class="ui.subtitle">{{ t('agentPage.runDetailHint') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="detail" class="rounded px-2 py-0.5 text-xs font-medium" :class="statusBadgeClass(detail.status)">
          {{ detail.status }}
        </span>
        <template v-if="detail && canRunAgent">
          <button
            type="button"
            :disabled="replayBusy"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="onReplay"
          >
            {{ replayBusy ? t('agentPage.loading') : t('agentPage.replayRun') }}
          </button>
          <button
            type="button"
            :disabled="preflightBusy"
            class="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="onPreflight"
          >
            {{ preflightBusy ? t('agentPage.loading') : t('agentPage.preflightRun') }}
          </button>
        </template>
      </div>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.infoBox">
      {{ t('agentPage.noPark') }}
    </div>

    <template v-else>
      <div v-if="loading" :class="ui.muted">{{ t('agentPage.loading') }}</div>

      <template v-else-if="detail">
        <AgentApprovalMetricsStrip
          v-if="canReadMetrics"
          :summary="runApprovalSummary"
          :loading="runApprovalLoading"
          :title-override="approvalStripTitle ?? undefined"
        />

        <div :class="ui.card">
          <p class="text-sm font-medium text-slate-800 dark:text-slate-100">{{ skillLabel(detail.skillId) }}</p>
          <p class="mt-1 font-mono text-[11px] text-slate-500">{{ detail.id }}</p>
          <p class="mt-2 text-xs text-slate-500">
            <template v-if="detail.startedAt">{{ formatDateTime(detail.startedAt) }}</template>
            <template v-else>—</template>
            <template v-if="detail.finishedAt"> — {{ formatDateTime(detail.finishedAt) }}</template>
          </p>
          <p class="mt-1 text-xs text-slate-500">{{ detail.mode }} · {{ detail.triggerType }}</p>
          <p v-if="detail.errorMessage" class="mt-2 text-xs text-rose-600">{{ detail.errorMessage }}</p>
        </div>

        <section v-if="preflightResult" class="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 :class="ui.h2 + ' !text-sm'">{{ t('agentPage.preflightResultTitle') }}</h2>
            <span
              class="rounded px-2 py-0.5 text-xs font-medium"
              :class="preflightResult.ok ? 'bg-emerald-600/90 text-white' : 'bg-rose-600/90 text-white'"
            >
              {{ preflightResult.ok ? t('agentPage.preflightOverallPass') : t('agentPage.preflightOverallFail') }}
            </span>
          </div>
          <p
            v-if="preflightResult.approvalGateMin != null && Number.isFinite(preflightResult.approvalGateMin)"
            class="mt-1 text-xs text-slate-600 dark:text-slate-300"
          >
            {{
              t('agentPage.preflightGateThreshold', {
                min: (preflightResult.approvalGateMin * 100).toFixed(0),
              })
            }}
          </p>
          <h3 class="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ t('agentPage.preflightChecklistTitle') }}
          </h3>
          <ul class="mt-2 space-y-2">
            <li
              v-for="c in preflightResult.checklist"
              :key="c.id"
              class="rounded border border-slate-200/80 bg-white/60 px-2 py-1.5 dark:border-slate-600/80 dark:bg-slate-950/40"
            >
              <div class="flex flex-wrap items-start gap-2">
                <span
                  class="mt-0.5 shrink-0 font-mono text-xs font-bold"
                  :class="c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'"
                >
                  {{ c.ok ? '✓' : '✗' }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="font-mono text-[11px] text-slate-600 dark:text-slate-300">{{ c.id }}</p>
                  <p v-if="c.detail" class="mt-0.5 text-xs text-slate-700 dark:text-slate-200">{{ c.detail }}</p>
                </div>
              </div>
            </li>
          </ul>

          <div
            v-if="preflightResult.dryRun && !preflightResult.dryRun.skipped"
            class="mt-3 overflow-x-auto rounded border border-slate-200 bg-white/70 dark:border-slate-600 dark:bg-slate-950/40"
          >
            <h3 class="border-b border-slate-200 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:text-slate-400">
              {{ t('agentPage.preflightDryRunTitle') }}
            </h3>
            <table class="min-w-full text-left text-xs">
              <thead class="bg-slate-50/90 text-slate-600 dark:bg-slate-900/80 dark:text-slate-300">
                <tr>
                  <th class="px-2 py-1 font-medium">{{ t('agentPage.preflightDryRunColTool') }}</th>
                  <th class="px-2 py-1 font-medium">{{ t('agentPage.preflightDryRunColMs') }}</th>
                  <th class="px-2 py-1 font-medium">{{ t('agentPage.preflightDryRunColResult') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                <tr v-for="row in preflightResult.dryRun.tools" :key="row.name">
                  <td class="px-2 py-1 font-mono text-[11px] text-slate-700 dark:text-slate-200">{{ row.name }}</td>
                  <td class="px-2 py-1 text-slate-600 dark:text-slate-300">{{ row.ms }} ms</td>
                  <td class="px-2 py-1">
                    <span v-if="row.ok" class="text-emerald-700 dark:text-emerald-400">{{ row.summary || 'OK' }}</span>
                    <span v-else class="text-rose-700 dark:text-rose-300">{{ row.error || 'Error' }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <AgentApprovalMetricsStrip
            v-if="preflightResult.approvalMetrics"
            class="mt-3"
            :summary="preflightResult.approvalMetrics"
            :loading="false"
          />
          <details class="mt-3 rounded border border-slate-200 bg-white/50 dark:border-slate-600 dark:bg-slate-950/30">
            <summary class="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
              {{ t('agentPage.preflightRawJson') }}
            </summary>
            <pre
              class="max-h-64 overflow-auto whitespace-pre-wrap border-t border-slate-200 p-2 font-mono text-[11px] text-slate-800 dark:border-slate-700 dark:text-slate-100"
            >{{ jsonPreview(preflightResult) }}</pre>
          </details>
        </section>

        <section>
          <h2 :class="ui.h2">{{ t('agentPage.outputTitle') }}</h2>
          <pre
            v-if="detail.outputSummary"
            class="mt-2 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >{{ detail.outputSummary }}</pre>
          <p v-else class="mt-2 text-xs text-slate-500">{{ t('agentPage.noOutput') }}</p>
        </section>

        <section>
          <h2 :class="ui.h2">{{ t('agentPage.stepsTitle') }}</h2>
          <div class="mt-2 overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
            <table class="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
              <thead class="bg-slate-50 dark:bg-slate-900/80">
                <tr>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">#</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.stepType') }}</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.stepTitle') }}</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.payloadPreview') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
                <tr v-for="s in sortedSteps" :key="s.id">
                  <td class="px-3 py-2 font-mono text-slate-500">{{ s.stepIndex }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ s.stepType }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ s.title || '—' }}</td>
                  <td class="max-w-md px-3 py-2 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                    <pre class="max-h-24 overflow-auto whitespace-pre-wrap">{{ jsonPreview(s.detailJson) }}</pre>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 :class="ui.h2">{{ t('agentPage.actionsTitle') }}</h2>
          <div class="mt-2 overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
            <table class="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
              <thead class="bg-slate-50 dark:bg-slate-900/80">
                <tr>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.actionType') }}</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Status</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.payloadPreview') }}</th>
                  <th class="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{{ t('agentPage.outcomeMetric') }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
                <tr v-for="a in detail.actions" :key="a.id">
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ a.actionType }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ a.status }}</td>
                  <td class="max-w-lg px-3 py-2 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                    <pre class="max-h-28 overflow-auto whitespace-pre-wrap">{{ jsonPreview(a.payloadJson) }}</pre>
                  </td>
                  <td class="max-w-md px-3 py-2 font-mono text-[10px] text-slate-600 dark:text-slate-300">
                    <pre class="max-h-28 overflow-auto whitespace-pre-wrap">{{ jsonPreview(a.outcomeMetric) }}</pre>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
