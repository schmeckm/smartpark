<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AgentApprovalMetricsStrip from '@/components/agent/AgentApprovalMetricsStrip.vue'
import {
  approveAgentAction,
  getAgentApprovalMetrics,
  listAgentPendingActions,
  rejectAgentAction,
} from '@/api/client'
import type { AgentApprovalMetricsPayload, AgentPendingActionItem } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { askConfirm } from '@/composables/useConfirmDialog'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const items = ref<AgentPendingActionItem[]>([])
const total = ref(0)
const loading = ref(false)
const approvalSummary = ref<AgentApprovalMetricsPayload | null>(null)
const approvalLoading = ref(false)

const rejectingId = ref<string | null>(null)
const rejectReason = ref('')

const canApprove = computed(() => auth.hasPermission('agent', 'approve'))
const canReject = computed(() => auth.hasPermission('agent', 'review'))
const canReadMetrics = computed(() => auth.hasPermission('agent', 'read'))

function skillLabel(skillId: string | undefined): string {
  if (skillId === 'daily_executive_brief') return t('agentPage.skillDailyBrief')
  if (skillId === 'crowd_spike_triage') return t('agentPage.skillCrowdSpike')
  if (skillId === 'mapping_assistant') return t('agentPage.skillMappingAssistant')
  if (skillId === 'weather_pivot') return t('agentPage.skillWeatherPivot')
  if (skillId === 'ride_down_response') return t('agentPage.skillRideDownResponse')
  return skillId || '—'
}

function payloadPreview(p: Record<string, unknown> | null): string {
  if (!p || typeof p !== 'object') return '—'
  try {
    return JSON.stringify(p, null, 2)
  } catch {
    return String(p)
  }
}

async function load() {
  if (!parkCtx.activeParkId) {
    items.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await listAgentPendingActions({ limit: 50, offset: 0 })
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
    approvalSummary.value = await getAgentApprovalMetrics({ sinceDays: 30 })
  } catch (e) {
    approvalSummary.value = null
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    approvalLoading.value = false
  }
}

function cancelReject() {
  rejectingId.value = null
  rejectReason.value = ''
}

async function onApprove(row: AgentPendingActionItem) {
  const ok = await askConfirm({
    title: t('agentPage.approve'),
    message: t('agentPage.confirmApprove'),
    confirmLabel: t('agentPage.approve'),
    variant: 'default',
  })
  if (!ok) return
  try {
    await approveAgentAction(row.id)
    push(t('agentPage.actionApproved'), 'success')
    cancelReject()
    await load()
    void loadApprovalMetrics()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  }
}

async function submitReject(row: AgentPendingActionItem) {
  try {
    await rejectAgentAction(row.id, rejectReason.value.trim() || null)
    push(t('agentPage.proposalRejected'), 'success')
    cancelReject()
    await load()
    void loadApprovalMetrics()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  }
}

onMounted(() => {
  void load()
  void loadApprovalMetrics()
})

watch(
  () => parkCtx.activeParkId,
  () => {
    void load()
  }
)

watch([() => parkCtx.activeParkId, () => canReadMetrics.value], () => {
  void loadApprovalMetrics()
})
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 :class="ui.title">{{ t('agentPage.inboxTitle') }}</h1>
        <p :class="ui.subtitle">{{ t('agentPage.inboxHint') }}</p>
      </div>
      <button
        type="button"
        :class="ui.control"
        class="!mt-0 shrink-0 px-3 py-2 text-xs font-medium"
        @click="
          load();
          loadApprovalMetrics();
        "
      >
        {{ t('agentPage.refresh') }}
      </button>
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
      <p class="text-xs text-slate-500">{{ t('agentPage.totalPending', { total }) }}</p>
      <div v-if="loading" :class="ui.muted">{{ t('agentPage.loading') }}</div>

      <ul v-else class="space-y-3">
        <li v-for="row in items" :key="row.id" :class="ui.card">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-slate-900">
                  {{ t('agentPage.statusProposed') }}
                </span>
                <span class="text-xs text-slate-500">{{ row.actionType }}</span>
              </div>
              <p class="text-sm text-slate-700">
                {{ t('agentPage.runSummary') }}:
                <RouterLink
                  :to="`/agent/runs/${row.runId}`"
                  class="font-medium text-brand-600 hover:text-brand-500 hover:underline"
                >
                  {{ skillLabel(row.run?.skillId) }}
                </RouterLink>
                <span class="text-xs text-slate-400"> · {{ row.runId }}</span>
              </p>
              <p v-if="row.expiresAt" class="text-xs text-slate-500">
                {{ t('agentPage.expiresAt') }}: {{ formatDateTime(row.expiresAt) }}
              </p>
              <pre
                class="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >{{ payloadPreview(row.payloadJson) }}</pre>
            </div>
            <div class="flex shrink-0 flex-col gap-2 sm:items-end">
              <RouterLink
                :to="`/agent/runs/${row.runId}`"
                class="inline-flex justify-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {{ t('agentPage.openRun') }}
              </RouterLink>
              <div class="flex flex-wrap gap-2">
                <button
                  v-if="canApprove"
                  type="button"
                  class="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
                  @click="onApprove(row)"
                >
                  {{ t('agentPage.approve') }}
                </button>
                <button
                  v-if="canReject"
                  type="button"
                  class="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  @click="rejectingId = rejectingId === row.id ? null : row.id"
                >
                  {{ t('agentPage.reject') }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="rejectingId === row.id && canReject" class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            <label class="block text-xs text-slate-500" for="reject-reason">{{ t('agentPage.rejectReasonLabel') }}</label>
            <textarea
              id="reject-reason"
              v-model="rejectReason"
              rows="3"
              class="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
                @click="submitReject(row)"
              >
                {{ t('agentPage.confirmRejectSubmit') }}
              </button>
              <button type="button" :class="ui.control" class="!mt-0 px-3 py-1.5 text-xs" @click="cancelReject">
                {{ t('agentPage.cancel') }}
              </button>
            </div>
          </div>
        </li>
        <li v-if="!items.length" :class="ui.infoBox">{{ t('agentPage.emptyInbox') }}</li>
      </ul>
    </template>
  </div>
</template>
