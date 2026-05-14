<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AgentApprovalMetricsStrip from '@/components/agent/AgentApprovalMetricsStrip.vue'
import { createAgentRun, getAgentApprovalMetrics, listAgentRuns } from '@/api/client'
import type { AgentApprovalMetricsPayload, AgentRunSummary, AgentSkillId } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { t } = useI18n()
const router = useRouter()
const { formatDateTime } = useRegionalDateTime()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const items = ref<AgentRunSummary[]>([])
const total = ref(0)
const loading = ref(false)
const approvalSummary = ref<AgentApprovalMetricsPayload | null>(null)
const approvalLoading = ref(false)

const skillFilter = ref<string>('')
const statusFilter = ref<string>('')

const panelOpen = ref(false)
const skillToRun = ref<AgentSkillId>('daily_executive_brief')
const crowdEventId = ref('')
const rideFocusId = ref('')

const canRun = computed(() => auth.hasPermission('agent', 'run'))
const canReadMetrics = computed(() => auth.hasPermission('agent', 'read'))

const skillOptions: { value: AgentSkillId; labelKey: string }[] = [
  { value: 'daily_executive_brief', labelKey: 'agentPage.skillDailyBrief' },
  { value: 'crowd_spike_triage', labelKey: 'agentPage.skillCrowdSpike' },
  { value: 'mapping_assistant', labelKey: 'agentPage.skillMappingAssistant' },
  { value: 'weather_pivot', labelKey: 'agentPage.skillWeatherPivot' },
  { value: 'ride_down_response', labelKey: 'agentPage.skillRideDownResponse' },
]

function skillLabel(skillId: string): string {
  if (skillId === 'daily_executive_brief') return t('agentPage.skillDailyBrief')
  if (skillId === 'crowd_spike_triage') return t('agentPage.skillCrowdSpike')
  if (skillId === 'mapping_assistant') return t('agentPage.skillMappingAssistant')
  if (skillId === 'weather_pivot') return t('agentPage.skillWeatherPivot')
  if (skillId === 'ride_down_response') return t('agentPage.skillRideDownResponse')
  return skillId
}

function statusBadgeClass(status: string): string {
  if (status === 'succeeded') return 'bg-emerald-600/90 text-white'
  if (status === 'running') return 'bg-sky-600/90 text-white'
  if (status === 'failed') return 'bg-rose-600/90 text-white'
  return 'bg-slate-600/80 text-white'
}

async function load() {
  if (!parkCtx.activeParkId) {
    items.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await listAgentRuns({
      limit: 50,
      offset: 0,
      skillId: skillFilter.value || undefined,
      status: statusFilter.value || undefined,
    })
    items.value = res.items
    total.value = res.total
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function loadApprovalMetrics() {
  if (!parkCtx.activeParkId || !canReadMetrics.value) {
    approvalSummary.value = null
    return
  }
  approvalLoading.value = true
  try {
    approvalSummary.value = await getAgentApprovalMetrics({
      skillId: (skillFilter.value || undefined) as AgentSkillId | undefined,
      sinceDays: 30,
    })
  } catch (e) {
    approvalSummary.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    approvalLoading.value = false
  }
}

function closePanel() {
  panelOpen.value = false
  crowdEventId.value = ''
  rideFocusId.value = ''
}

async function submitRun() {
  const parkId = parkCtx.activeParkId
  if (!parkId) return
  try {
    const crowd =
      skillToRun.value === 'crowd_spike_triage' && crowdEventId.value.trim()
        ? crowdEventId.value.trim()
        : null
    const ride =
      skillToRun.value === 'ride_down_response' && rideFocusId.value.trim()
        ? rideFocusId.value.trim()
        : null
    const detail = await createAgentRun({
      skillId: skillToRun.value,
      parkId,
      triggerType: 'manual',
      crowdEventId: crowd,
      rideId: ride,
    })
    push(t('agentPage.runStarted'), 'success')
    closePanel()
    await load()
    await router.push(`/agent/runs/${detail.id}`)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  }
}

onMounted(() => {
  void load()
  void loadApprovalMetrics()
})

watch([() => parkCtx.activeParkId, skillFilter, statusFilter], () => {
  void load()
})

watch([() => parkCtx.activeParkId, skillFilter, () => canReadMetrics.value], () => {
  void loadApprovalMetrics()
})
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 :class="ui.title">{{ t('agentPage.runsTitle') }}</h1>
        <p :class="ui.subtitle">{{ t('agentPage.runsHint') }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <button
          type="button"
          :class="ui.control"
          class="!mt-0 px-3 py-2 text-xs font-medium"
          @click="
            load();
            loadApprovalMetrics();
          "
        >
          {{ t('agentPage.refresh') }}
        </button>
        <button
          v-if="canRun"
          type="button"
          class="rounded-md bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
          @click="panelOpen = true"
        >
          {{ t('agentPage.runSkill') }}
        </button>
      </div>
    </div>

    <div v-if="!parkCtx.activeParkId" :class="ui.infoBox">
      {{ t('agentPage.noPark') }}
    </div>

    <template v-else>
      <AgentApprovalMetricsStrip
        v-if="canReadMetrics"
        :summary="approvalSummary"
        :loading="approvalLoading"
      />

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-[10rem] flex-col gap-1">
          <label class="text-xs text-slate-500" for="agent-skill-filter">{{ t('agentPage.filterSkill') }}</label>
          <select
            id="agent-skill-filter"
            v-model="skillFilter"
            :class="ui.control + ' !mt-0 max-w-xs py-1.5 text-xs'"
          >
            <option value="">{{ t('agentPage.filterAllSkills') }}</option>
            <option v-for="o in skillOptions" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
          </select>
        </div>
        <div class="flex min-w-[10rem] flex-col gap-1">
          <label class="text-xs text-slate-500" for="agent-status-filter">{{ t('agentPage.filterStatus') }}</label>
          <input
            id="agent-status-filter"
            v-model="statusFilter"
            type="text"
            :placeholder="t('agentPage.filterAllStatus')"
            :class="ui.control + ' !mt-0 max-w-xs py-1.5 text-xs'"
          />
        </div>
        <span class="pb-2 text-xs text-slate-500">{{ t('agentPage.totalRuns', { total }) }}</span>
      </div>

      <div v-if="loading" :class="ui.muted">{{ t('agentPage.loading') }}</div>

      <ul v-else class="space-y-2">
        <li v-for="row in items" :key="row.id">
          <RouterLink
            :to="`/agent/runs/${row.id}`"
            :class="[
              ui.card,
              'block transition hover:border-brand-500/50 hover:ring-1 hover:ring-brand-500/30',
            ]"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p :class="ui.h2" class="!text-base">{{ skillLabel(row.skillId) }}</p>
                <p class="mt-0.5 text-xs text-slate-500">
                  {{
                    row.startedAt
                      ? formatDateTime(row.startedAt)
                      : row.finishedAt
                        ? formatDateTime(row.finishedAt)
                        : '—'
                  }}
                  · {{ row.mode }} · {{ row.triggerType }}
                </p>
                <p class="mt-1 truncate font-mono text-[11px] text-slate-400">{{ row.id }}</p>
              </div>
              <span class="rounded px-2 py-0.5 text-xs font-medium" :class="statusBadgeClass(row.status)">
                {{ row.status }}
              </span>
            </div>
            <p v-if="row.errorMessage" class="mt-2 text-xs text-rose-600">{{ row.errorMessage }}</p>
          </RouterLink>
        </li>
        <li v-if="!items.length" :class="ui.infoBox">{{ t('agentPage.emptyRuns') }}</li>
      </ul>
    </template>

    <div
      v-if="panelOpen"
      class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="closePanel"
    >
      <div
        class="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-950"
        @click.stop
      >
        <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">{{ t('agentPage.runSkill') }}</h2>
        <div class="mt-3 space-y-3">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-slate-500" for="agent-run-skill">{{ t('agentPage.skillLabel') }}</label>
            <select id="agent-run-skill" v-model="skillToRun" :class="ui.control + ' !mt-0 py-1.5 text-xs'">
              <option v-for="o in skillOptions" :key="o.value" :value="o.value">{{ t(o.labelKey) }}</option>
            </select>
          </div>
          <div v-if="skillToRun === 'crowd_spike_triage'" class="flex flex-col gap-1">
            <label class="text-xs text-slate-500" for="agent-crowd-id">{{ t('agentPage.crowdEventOptional') }}</label>
            <input
              id="agent-crowd-id"
              v-model="crowdEventId"
              type="text"
              :placeholder="t('agentPage.crowdEventPlaceholder')"
              :class="ui.control + ' !mt-0 py-1.5 text-xs'"
            />
          </div>
          <div v-if="skillToRun === 'ride_down_response'" class="flex flex-col gap-1">
            <label class="text-xs text-slate-500" for="agent-ride-id">{{ t('agentPage.rideAssetOptional') }}</label>
            <input
              id="agent-ride-id"
              v-model="rideFocusId"
              type="text"
              :placeholder="t('agentPage.rideAssetPlaceholder')"
              :class="ui.control + ' !mt-0 py-1.5 text-xs'"
            />
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" :class="ui.control" class="!mt-0 px-3 py-1.5 text-xs" @click="closePanel">
            {{ t('agentPage.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
            @click="submitRun"
          >
            {{ t('agentPage.submitRun') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
