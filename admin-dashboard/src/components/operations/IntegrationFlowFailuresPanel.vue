<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ApiRequestError,
  acknowledgeIntegrationFlowFailure,
  listIntegrationFlowFailures,
  postIntegrationFlowRunRetry,
  type IntegrationFlowFailureInboxItemDto,
  type IntegrationNodeRegistryEntryDto,
} from '@/api/client'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  engineAvailable: boolean
  canRead: boolean
  canManage: boolean
  nodes: IntegrationNodeRegistryEntryDto[]
}>()

const emit = defineEmits<{
  (e: 'open-run', payload: { flowId: string | null; runId: string }): void
  (e: 'runs-changed'): void
}>()

const { t } = useI18n()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const loading = ref(false)
const items = ref<IntegrationFlowFailureInboxItemDto[]>([])
const total = ref(0)

const filterRetryStatus = ref<string>('')
const filterNodeType = ref<string>('')
const filterAcknowledged = ref<'yes' | 'no' | 'all'>('all')
const filterTimeRange = ref<'24h' | '7d' | 'all'>('7d')

const ackNoteDraft = ref<Record<string, string>>({})
const rowBusy = ref<Record<string, string>>({})

const nodeTypeOptions = computed(() => {
  const s = new Set<string>()
  for (const n of props.nodes) {
    if (n.nodeType) s.add(n.nodeType)
  }
  return [...s].sort()
})

function timeRangeToFromTo(): { from?: string; to?: string } {
  if (filterTimeRange.value === 'all') return {}
  const to = new Date()
  const from = new Date(to)
  if (filterTimeRange.value === '24h') from.setHours(from.getHours() - 24)
  else from.setDate(from.getDate() - 7)
  return { from: from.toISOString(), to: to.toISOString() }
}

async function load() {
  if (!props.canRead || !props.engineAvailable) {
    items.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const { from, to } = timeRangeToFromTo()
    const page = await listIntegrationFlowFailures({
      retryStatus: filterRetryStatus.value || undefined,
      nodeType: filterNodeType.value || undefined,
      acknowledged: filterAcknowledged.value,
      from,
      to,
      limit: 50,
      offset: 0,
    })
    items.value = page.items
    total.value = page.total
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      items.value = []
      total.value = 0
    } else {
      push(e instanceof Error ? e.message : t('integrationFlowFailures.loadError'), 'error')
    }
  } finally {
    loading.value = false
  }
}

function setRowBusy(runId: string, key: string | null) {
  if (key) {
    rowBusy.value = { ...rowBusy.value, [runId]: key }
  } else {
    const next = { ...rowBusy.value }
    delete next[runId]
    rowBusy.value = next
  }
}

function onOpenRun(row: IntegrationFlowFailureInboxItemDto) {
  emit('open-run', { flowId: row.flowId, runId: row.runId })
}

async function onRetry(row: IntegrationFlowFailureInboxItemDto) {
  if (!props.canManage) return
  setRowBusy(row.runId, 'retry')
  try {
    await postIntegrationFlowRunRetry(row.runId)
    push(t('integrationFlowFailures.retryOk'), 'success')
    emit('runs-changed')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowFailures.retryError'), 'error')
  } finally {
    setRowBusy(row.runId, null)
  }
}

async function onAcknowledge(row: IntegrationFlowFailureInboxItemDto) {
  if (!props.canManage) return
  const note = ackNoteDraft.value[row.runId]?.trim() || ''
  setRowBusy(row.runId, 'ack')
  try {
    await acknowledgeIntegrationFlowFailure(row.runId, note || null)
    push(t('integrationFlowFailures.ackOk'), 'success')
    ackNoteDraft.value = { ...ackNoteDraft.value, [row.runId]: '' }
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('integrationFlowFailures.ackError'), 'error')
  } finally {
    setRowBusy(row.runId, null)
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = Date.parse(iso)
  return Number.isNaN(d) ? iso : new Date(d).toLocaleString()
}

function retryable(row: IntegrationFlowFailureInboxItemDto): boolean {
  if (row.status !== 'failed' || !row.retryEnabled) return false
  const max = Number(row.maxRetryAttempts || 0)
  if (max <= 0) return false
  return Number(row.retryAttempt ?? 0) < max
}

watch(
  () => [
    props.engineAvailable,
    props.canRead,
    filterRetryStatus.value,
    filterNodeType.value,
    filterAcknowledged.value,
    filterTimeRange.value,
  ],
  () => {
    void load()
  }
)

onMounted(() => {
  void load()
})
</script>

<template>
  <section
    v-if="canRead && engineAvailable"
    :class="ui.card"
    class="mt-6"
    data-testid="integration-flow-failures-panel"
  >
    <h2 :class="ui.h2">{{ t('integrationFlowFailures.title') }}</h2>
    <p :class="ui.muted">{{ t('integrationFlowFailures.subtitle') }}</p>

    <div class="mt-4 flex flex-wrap gap-3">
      <div>
        <label :class="ui.label" for="iff-retry">{{ t('integrationFlowFailures.filterRetry') }}</label>
        <select id="iff-retry" v-model="filterRetryStatus" :class="ui.control">
          <option value="">{{ t('integrationFlowFailures.filterAny') }}</option>
          <option value="not_applicable">not_applicable</option>
          <option value="pending_retry">pending_retry</option>
          <option value="retry_succeeded">retry_succeeded</option>
          <option value="retry_failed">retry_failed</option>
          <option value="retry_exhausted">retry_exhausted</option>
        </select>
      </div>
      <div>
        <label :class="ui.label" for="iff-node">{{ t('integrationFlowFailures.filterNode') }}</label>
        <select id="iff-node" v-model="filterNodeType" :class="ui.control">
          <option value="">{{ t('integrationFlowFailures.filterAny') }}</option>
          <option v-for="nt in nodeTypeOptions" :key="nt" :value="nt">{{ nt }}</option>
        </select>
      </div>
      <div>
        <label :class="ui.label" for="iff-ack">{{ t('integrationFlowFailures.filterAck') }}</label>
        <select id="iff-ack" v-model="filterAcknowledged" :class="ui.control">
          <option value="all">{{ t('integrationFlowFailures.ackAll') }}</option>
          <option value="yes">{{ t('integrationFlowFailures.ackYes') }}</option>
          <option value="no">{{ t('integrationFlowFailures.ackNo') }}</option>
        </select>
      </div>
      <div>
        <label :class="ui.label" for="iff-time">{{ t('integrationFlowFailures.filterTime') }}</label>
        <select id="iff-time" v-model="filterTimeRange" :class="ui.control">
          <option value="24h">{{ t('integrationFlowFailures.time24h') }}</option>
          <option value="7d">{{ t('integrationFlowFailures.time7d') }}</option>
          <option value="all">{{ t('integrationFlowFailures.timeAll') }}</option>
        </select>
      </div>
    </div>

    <p v-if="loading" :class="['mt-4', ui.muted]">{{ t('integrationFlowStudio.loading') }}</p>
    <div v-else class="mt-4 overflow-x-auto">
      <table class="min-w-full text-left text-sm">
        <thead>
          <tr :class="ui.tableHead">
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colFlow') }}</th>
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colFailedNode') }}</th>
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colError') }}</th>
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colRetry') }}</th>
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colTimes') }}</th>
            <th class="px-3 py-2">{{ t('integrationFlowFailures.colAck') }}</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="!items.length">
            <td colspan="7" :class="['px-3 py-4', ui.tableCellMuted]">{{ t('integrationFlowFailures.empty') }}</td>
          </tr>
          <tr
            v-for="row in items"
            :key="row.runId"
            :class="ui.tableRow"
            data-testid="integration-flow-failures-row"
          >
            <td :class="['px-3', ui.tableCell]">
              <div class="font-medium text-slate-100">{{ row.flowName || row.flowId || '—' }}</div>
              <div class="text-xs text-slate-500">{{ row.runId }}</div>
            </td>
            <td :class="['px-3', ui.tableCell]">
              <div>{{ row.failedNodeId || '—' }}</div>
              <div class="text-xs text-slate-500">{{ row.failedNodeType || '—' }}</div>
            </td>
            <td :class="['px-3', ui.tableCell, 'max-w-xs truncate']" :title="row.errorMessage || ''">
              {{ row.errorMessage || '—' }}
            </td>
            <td :class="['px-3', ui.tableCell]">
              <div>{{ row.retryStatus || '—' }}</div>
              <div class="text-xs text-slate-500">
                {{ row.retryAttempt }} / {{ row.maxRetryAttempts }}
              </div>
              <div class="text-xs text-amber-200/90">{{ formatTime(row.nextRetryAt ?? undefined) }}</div>
            </td>
            <td :class="['px-3', ui.tableCell, 'whitespace-nowrap text-xs text-slate-400']">
              <div>{{ formatTime(row.startedAt ?? undefined) }}</div>
              <div>{{ formatTime(row.finishedAt ?? undefined) }}</div>
            </td>
            <td :class="['px-3', ui.tableCell, 'text-xs']">
              <span v-if="row.acknowledgedAt" class="text-emerald-400">{{ t('integrationFlowFailures.ackStateYes') }}</span>
              <span v-else class="text-slate-500">{{ t('integrationFlowFailures.ackStateNo') }}</span>
            </td>
            <td :class="['px-3', ui.tableCell, 'space-y-2']">
              <button
                type="button"
                class="block w-full rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                data-testid="integration-flow-failure-open-run"
                @click="onOpenRun(row)"
              >
                {{ t('integrationFlowFailures.openRun') }}
              </button>
              <button
                v-if="canManage && retryable(row)"
                type="button"
                class="block w-full rounded border border-amber-600/60 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/30 disabled:opacity-50"
                data-testid="integration-flow-failure-retry-now"
                :disabled="rowBusy[row.runId] === 'retry'"
                @click="onRetry(row)"
              >
                {{ t('integrationFlowStudio.retryNow') }}
              </button>
              <div v-if="canManage" class="space-y-1">
                <input
                  v-model="ackNoteDraft[row.runId]"
                  type="text"
                  :placeholder="t('integrationFlowFailures.ackNotePlaceholder')"
                  :class="[ui.control, 'text-xs']"
                />
                <button
                  type="button"
                  class="w-full rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  data-testid="integration-flow-failure-acknowledge"
                  :disabled="rowBusy[row.runId] === 'ack'"
                  @click="onAcknowledge(row)"
                >
                  {{ t('integrationFlowFailures.acknowledge') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="total > items.length" :class="['mt-2 text-xs', ui.muted]">
        {{ t('integrationFlowFailures.showingPartial', { shown: items.length, total }) }}
      </p>
    </div>
  </section>
</template>
