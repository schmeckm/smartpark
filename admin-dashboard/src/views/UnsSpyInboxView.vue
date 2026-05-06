<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getMqttInbound,
  getMqttInboundUnknown,
  getUnsSpyEvents,
  getUnsSpyProposals,
  getRides,
  listMasterData,
  getRideSignalCapabilities,
  postUnsSpyDiscoveryApprove,
  postUnsSpyDiscoveryReject,
  postUnsSpyDiscoveryIgnore,
  postUnsSpyProposalApprove,
  postUnsSpyProposalReject,
  type MqttInboundRow,
  type UnsDiscoveryEventRow,
  type UnsTopicProposalRow,
  type RideSignalCapabilitySignalRow,
  type RideSignalSource,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'

const { t } = useI18n()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()

const busy = ref(false)
const loadError = ref<string | null>(null)

const summary = ref({
  inboundTotal: 0,
  unknownTopic: 0,
  unknownSignal: 0,
  conflict: 0,
  proposals: 0,
  skipped: 0,
})

const mqttRows = ref<MqttInboundRow[]>([])
const mqttTotal = ref(0)
const discoveryRows = ref<UnsDiscoveryEventRow[]>([])
const discoveryTotal = ref(0)
const proposalRows = ref<UnsTopicProposalRow[]>([])
const proposalTotal = ref(0)
const unknownRows = ref<UnsDiscoveryEventRow[]>([])
const unknownTotal = ref(0)

const fMqttTopicPrefix = ref('')
const fMqttSpyClass = ref('')
const tableLimit = ref(50)

const fDiscClassification = ref('')
const fDiscTopicPrefix = ref('')
const fDiscEventSource = ref<'all' | 'mqtt' | 'adapter'>('all')

const actionModalOpen = ref(false)
const actionBusy = ref(false)
const modalEvent = ref<UnsDiscoveryEventRow | null>(null)
const modalRideId = ref('')
const modalApplyTemplate = ref(true)
const rideOptions = ref<{ id: string; name: string }[]>([])

const mqttProposalModalOpen = ref(false)
const modalProposal = ref<UnsTopicProposalRow | null>(null)
const modalMqttRideId = ref('')
const modalSignalCatalogId = ref('')
const modalSignalSource = ref<RideSignalSource>('MQTT_EDGE')
const modalActivatePrepared = ref(true)
const mqttRideOptions = ref<{ id: string; name: string }[]>([])
const mqttSignalOptions = ref<RideSignalCapabilitySignalRow[]>([])

const mqttSignalSources: RideSignalSource[] = [
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
]

const canWriteSpy = computed(
  () => auth.hasPermission('integrations', 'manage') || auth.hasPermission('rides', 'update')
)

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function parseStatus(row: MqttInboundRow): string {
  const c = row.spyClassification
  if (c == null || c === '') return t('unsSpyInbox.parsePending')
  if (c === 'OBSERVE_SKIPPED') return t('unsSpyInbox.parseSkipped')
  return t('unsSpyInbox.parseOk')
}

function discoveryProvider(row: UnsDiscoveryEventRow): string {
  const d = row.details || {}
  if (typeof d.source === 'string') return d.source
  if (typeof d.reason === 'string') return d.reason
  return t('unsSpyInbox.notInPayload')
}

function discoverySuggestedEntity(row: UnsDiscoveryEventRow): string {
  const d = row.details || {}
  if (d.unsNodeId) return `uns_node:${String(d.unsNodeId)}`
  if (d.registryEntityId) return `registry_entity:${String(d.registryEntityId)}`
  const parsed = d.parsed as Record<string, unknown> | undefined
  if (parsed && typeof parsed.assetSlug === 'string') return String(parsed.assetSlug)
  return t('unsSpyInbox.notInPayload')
}

function discoverySuggestedSignal(row: UnsDiscoveryEventRow): string {
  const d = row.details || {}
  if (typeof d.inboundMetric === 'string') return d.inboundMetric
  const parsed = d.parsed as Record<string, unknown> | undefined
  if (parsed && typeof parsed.metric === 'string') return String(parsed.metric)
  return t('unsSpyInbox.notInPayload')
}

function proposalMetric(row: UnsTopicProposalRow): string {
  const p = row.payloadSnapshot?.parsedPayload
  if (p && typeof p === 'object' && p !== null && 'metric' in p) return String((p as { metric?: unknown }).metric ?? '—')
  return typeof row.payloadSnapshot?.metric === 'string' ? String(row.payloadSnapshot.metric) : '—'
}

function proposalSignalKey(row: UnsTopicProposalRow): string {
  const m = proposalMetric(row)
  return m !== '—' ? m : String(row.payloadSnapshot?.classification ?? '—')
}

function proposalSourceType(row: UnsTopicProposalRow): string {
  return String(row.payloadSnapshot?.classification ?? row.status ?? '—')
}

function suggestedActionText(classification: string): string {
  if (classification === 'UNKNOWN_TOPIC') return t('unsSpyInbox.suggestUnknownTopic')
  if (classification === 'UNKNOWN_SIGNAL') return t('unsSpyInbox.suggestUnknownSignal')
  if (classification === 'CONFLICT') return t('unsSpyInbox.suggestConflict')
  return '—'
}

function isAdapterDiscoveryRow(row: UnsDiscoveryEventRow): boolean {
  const d = row.details || {}
  return String(d.source || '') === 'adapter'
}

function isPendingProposal(row: UnsTopicProposalRow): boolean {
  return String(row.status || '').toLowerCase() === 'pending'
}

function discoveryReviewStatus(row: UnsDiscoveryEventRow): string {
  const d = row.details || {}
  const rs = d.reviewStatus
  return typeof rs === 'string' && rs ? rs : '—'
}

async function openActionModal(row: UnsDiscoveryEventRow) {
  modalEvent.value = row
  modalRideId.value = ''
  modalApplyTemplate.value = true
  actionModalOpen.value = true
  try {
    const rides = await getRides()
    rideOptions.value = rides.map((r) => ({ id: r.id, name: r.name }))
  } catch {
    rideOptions.value = []
  }
}

function closeActionModal() {
  actionModalOpen.value = false
  modalEvent.value = null
}

async function submitApprove() {
  if (!modalEvent.value || !modalRideId.value) {
    push(t('unsSpyInbox.actionsPickRide'), 'error')
    return
  }
  actionBusy.value = true
  try {
    await postUnsSpyDiscoveryApprove(modalEvent.value.id, {
      createEntity: false,
      mapToExistingEntityId: modalRideId.value,
      createMapping: true,
      applyTemplateKey: modalApplyTemplate.value ? 'RIDE_DEFAULT_V1' : undefined,
    })
    push(t('unsSpyInbox.actionsApproved'), 'success')
    closeActionModal()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSpyInbox.actionsFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

async function submitReject() {
  if (!modalEvent.value) return
  actionBusy.value = true
  try {
    await postUnsSpyDiscoveryReject(modalEvent.value.id)
    push(t('unsSpyInbox.actionsRejected'), 'success')
    closeActionModal()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSpyInbox.actionsFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

async function submitIgnore() {
  if (!modalEvent.value) return
  actionBusy.value = true
  try {
    await postUnsSpyDiscoveryIgnore(modalEvent.value.id)
    push(t('unsSpyInbox.actionsIgnored'), 'success')
    closeActionModal()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSpyInbox.actionsFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

function closeMqttProposalModal() {
  mqttProposalModalOpen.value = false
  modalProposal.value = null
}

async function openMqttProposalModal(row: UnsTopicProposalRow) {
  modalProposal.value = row
  modalMqttRideId.value = ''
  modalSignalCatalogId.value = ''
  modalSignalSource.value = 'MQTT_EDGE'
  modalActivatePrepared.value = true
  mqttSignalOptions.value = []
  mqttProposalModalOpen.value = true
  try {
    const params: Record<string, string | number> = { page: 0, pageSize: 200 }
    if (parkCtx.activeParkId) params.parkId = parkCtx.activeParkId
    const page = await listMasterData('rides', params)
    mqttRideOptions.value = page.rows.map((r) => ({
      id: r.id,
      name: r.parkName ? `${r.name} (${r.parkName})` : r.name,
    }))
  } catch {
    mqttRideOptions.value = []
  }
}

watch(modalMqttRideId, async (id) => {
  const rid = String(id || '').trim()
  mqttSignalOptions.value = []
  modalSignalCatalogId.value = ''
  if (!rid) return
  try {
    const cap = await getRideSignalCapabilities(rid)
    mqttSignalOptions.value = cap.signals || []
  } catch {
    mqttSignalOptions.value = []
  }
})

async function submitMqttProposalApprove() {
  if (!modalProposal.value || !modalMqttRideId.value) {
    push(t('unsSpyInbox.mqttProposalPickRide'), 'error')
    return
  }
  if (!modalSignalCatalogId.value) {
    push(t('unsSpyInbox.mqttProposalPickSignal'), 'error')
    return
  }
  actionBusy.value = true
  try {
    await postUnsSpyProposalApprove(modalProposal.value.id, {
      rideAssetId: modalMqttRideId.value,
      signalCatalogId: modalSignalCatalogId.value,
      signalSource: modalSignalSource.value,
      activatePrepared: modalActivatePrepared.value,
    })
    push(t('unsSpyInbox.mqttProposalDone'), 'success')
    closeMqttProposalModal()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSpyInbox.mqttProposalFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

async function submitMqttProposalReject() {
  if (!modalProposal.value) return
  actionBusy.value = true
  try {
    await postUnsSpyProposalReject(modalProposal.value.id, {})
    push(t('unsSpyInbox.mqttProposalDone'), 'success')
    closeMqttProposalModal()
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSpyInbox.mqttProposalFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

const limitNum = computed(() => Math.min(200, Math.max(1, Number(tableLimit.value) || 50)))

async function refresh() {
  busy.value = true
  loadError.value = null
  const lim = limitNum.value
  try {
    const [
      inboundHead,
      evUnknownTopic,
      evUnknownSignal,
      evConflict,
      proposalsHead,
      skippedHead,
      mqttData,
      discData,
      propData,
      unknownData,
    ] = await Promise.all([
      getMqttInbound({ limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'UNKNOWN_TOPIC', limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'UNKNOWN_SIGNAL', limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'CONFLICT', limit: 1, offset: 0 }),
      getUnsSpyProposals({ limit: 1, offset: 0 }),
      getMqttInbound({ limit: 1, offset: 0, spyClassification: 'OBSERVE_SKIPPED' }),
      getMqttInbound({
        limit: lim,
        offset: 0,
        topicPrefix: str(fMqttTopicPrefix.value) || undefined,
        spyClassification: str(fMqttSpyClass.value) || undefined,
      }),
      getUnsSpyEvents({
        limit: 100,
        offset: 0,
        classification: str(fDiscClassification.value) || undefined,
        topicPrefix: str(fDiscTopicPrefix.value) || undefined,
        eventSource: fDiscEventSource.value === 'all' ? 'all' : fDiscEventSource.value,
      }),
      getUnsSpyProposals({ limit: 100, offset: 0 }),
      getMqttInboundUnknown({ limit: 50, offset: 0 }),
    ])

    summary.value = {
      inboundTotal: inboundHead.total,
      unknownTopic: evUnknownTopic.total,
      unknownSignal: evUnknownSignal.total,
      conflict: evConflict.total,
      proposals: proposalsHead.total,
      skipped: skippedHead.total,
    }
    mqttRows.value = mqttData.items
    mqttTotal.value = mqttData.total
    discoveryRows.value = discData.items
    discoveryTotal.value = discData.total
    proposalRows.value = propData.items
    proposalTotal.value = propData.total
    unknownRows.value = unknownData.items
    unknownTotal.value = unknownData.total
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed'
    loadError.value = msg
    push(msg, 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('unsSpyInbox.title') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('unsSpyInbox.subtitle') }}</p>
        <p class="mt-2 max-w-3xl text-xs text-slate-500">{{ t('unsSpyInbox.subtitleAdapterActions') }}</p>
        <p class="mt-2 text-xs text-slate-500">
          <RouterLink class="text-brand-300 hover:underline" to="/uns/governance">{{ t('menu.unsGovernance') }}</RouterLink>
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="busy"
        @click="refresh"
      >
        {{ busy ? '…' : t('unsSpyInbox.refresh') }}
      </button>
    </div>

    <p v-if="loadError" class="rounded-lg border border-rose-800/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {{ loadError }}
    </p>

    <!-- Summary -->
    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summaryInbound') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-white">{{ summary.inboundTotal }}</p>
        <p class="mt-1 text-xs text-slate-500">{{ t('unsSpyInbox.loadedRows') }}: {{ mqttRows.length }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summaryUnknownTopic') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-amber-200">{{ summary.unknownTopic }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summaryUnknownSignal') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-amber-200">{{ summary.unknownSignal }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summaryConflict') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-rose-200">{{ summary.conflict }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summaryProposals') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-brand-100">{{ summary.proposals }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ t('unsSpyInbox.summarySkipped') }}</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-slate-300">{{ summary.skipped }}</p>
      </div>
    </section>

    <!-- Risk -->
    <section class="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4">
      <h2 class="text-sm font-semibold text-amber-100">{{ t('unsSpyInbox.riskTitle') }}</h2>
      <ul class="mt-2 list-inside list-disc space-y-1.5 text-sm text-amber-100/90">
        <li>{{ t('unsSpyInbox.riskObserve') }}</li>
        <li>{{ t('unsSpyInbox.riskNoTopics') }}</li>
        <li>{{ t('unsSpyInbox.riskNoState') }}</li>
        <li>{{ t('unsSpyInbox.riskNoDashboard') }}</li>
        <li>{{ t('unsSpyInbox.riskEnablement') }}</li>
        <li>{{ t('unsSpyInbox.riskAdapterApproval') }}</li>
      </ul>
    </section>

    <!-- MQTT inbound -->
    <section class="space-y-3">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.mqttTitle') }}</h2>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterTopicPrefix') }}
          <input
            v-model="fMqttTopicPrefix"
            type="text"
            class="mt-1 block w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterSpyClass') }}
          <input
            v-model="fMqttSpyClass"
            type="text"
            placeholder="e.g. UNKNOWN_TOPIC"
            class="mt-1 block w-44 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterLimit') }}
          <input
            v-model.number="tableLimit"
            type="number"
            min="1"
            max="200"
            class="mt-1 block w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          />
        </label>
        <button
          type="button"
          class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          @click="refresh"
        >
          {{ t('unsSpyInbox.refresh') }}
        </button>
      </div>
      <p class="text-xs text-slate-500">{{ mqttTotal }} total · showing {{ mqttRows.length }}</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colReceivedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopic') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSpyClass') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colParseStatus') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colPayloadPreview') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSourceClient') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colQos') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colRetain') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !mqttRows.length">
              <td colspan="8" class="px-3 py-8 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in mqttRows" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="max-w-xs truncate px-3 py-2 font-mono text-xs text-brand-100" :title="row.topic">{{ row.topic }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.spyClassification || '—' }}</td>
              <td class="px-3 py-2 text-xs">{{ parseStatus(row) }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs text-slate-400" :title="row.payloadPreview || ''">
                {{ row.payloadPreview || '—' }}
              </td>
              <td class="px-3 py-2 text-xs text-slate-500">—</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.qos ?? 0 }}</td>
              <td class="px-3 py-2 text-xs text-slate-500">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Discovery -->
    <section class="space-y-3">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.discoveryTitle') }}</h2>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterClassification') }}
          <input
            v-model="fDiscClassification"
            type="text"
            class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterTopicPrefix') }}
          <input
            v-model="fDiscTopicPrefix"
            type="text"
            class="mt-1 block w-48 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          {{ t('unsSpyInbox.filterEventSource') }}
          <select
            v-model="fDiscEventSource"
            class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          >
            <option value="all">{{ t('unsSpyInbox.eventSourceAll') }}</option>
            <option value="mqtt">{{ t('unsSpyInbox.eventSourceMqtt') }}</option>
            <option value="adapter">{{ t('unsSpyInbox.eventSourceAdapter') }}</option>
          </select>
        </label>
        <button
          type="button"
          class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          @click="refresh"
        >
          {{ t('unsSpyInbox.refresh') }}
        </button>
      </div>
      <p class="text-xs text-slate-500">{{ discoveryTotal }} total · showing {{ discoveryRows.length }}</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colClassification') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopicPath') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colProvider') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSuggestedEntity') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSuggestedSignal') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colConfidence') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colReviewStatus') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !discoveryRows.length">
              <td colspan="9" class="px-3 py-8 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in discoveryRows" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="px-3 py-2">
                <span class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">{{ row.classification }}</span>
              </td>
              <td class="max-w-xs truncate px-3 py-2 font-mono text-xs" :title="row.topicPath">{{ row.topicPath }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2 text-xs" :title="discoveryProvider(row)">{{ discoveryProvider(row) }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2 font-mono text-xs">{{ discoverySuggestedEntity(row) }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2 font-mono text-xs">{{ discoverySuggestedSignal(row) }}</td>
              <td class="px-3 py-2 text-xs text-slate-500">—</td>
              <td class="px-3 py-2 text-xs text-slate-400">{{ discoveryReviewStatus(row) }}</td>
              <td class="px-3 py-2">
                <button
                  v-if="isAdapterDiscoveryRow(row) && canWriteSpy"
                  type="button"
                  class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  @click="openActionModal(row)"
                >
                  {{ t('unsSpyInbox.actionsOpen') }}
                </button>
                <span v-else class="text-xs text-slate-600">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Adapter discovery actions -->
    <div
      v-if="actionModalOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="closeActionModal"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl" @click.stop>
        <h3 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.actionsTitle') }}</h3>
        <p v-if="modalEvent" class="mt-1 text-xs text-slate-400">
          {{ String((modalEvent.details || {}).externalEntityId || modalEvent.topicPath) }}
        </p>
        <label class="mt-4 block text-xs text-slate-400">
          {{ t('unsSpyInbox.actionsRideSelect') }}
          <select v-model="modalRideId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
            <option value="">{{ t('unsSpyInbox.actionsRidePlaceholder') }}</option>
            <option v-for="r in rideOptions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label v-if="modalEvent && isAdapterDiscoveryRow(modalEvent)" class="mt-3 flex items-center gap-2 text-xs text-slate-300">
          <input v-model="modalApplyTemplate" type="checkbox" class="rounded border-slate-600" />
          {{ t('unsSpyInbox.actionsApplyTemplate') }}
        </label>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitApprove"
          >
            {{ t('unsSpyInbox.actionsApprove') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-700 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-950/50 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitReject"
          >
            {{ t('unsSpyInbox.actionsReject') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitIgnore"
          >
            {{ t('unsSpyInbox.actionsIgnore') }}
          </button>
          <button type="button" class="ml-auto text-xs text-slate-500 hover:text-slate-300" @click="closeActionModal">
            {{ t('unsSpyInbox.actionsClose') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="mqttProposalModalOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="closeMqttProposalModal"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl" @click.stop>
        <h3 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.mqttProposalTitle') }}</h3>
        <p v-if="modalProposal" class="mt-1 break-all font-mono text-xs text-slate-400">{{ modalProposal.proposedTopic }}</p>
        <label class="mt-4 block text-xs text-slate-400">
          {{ t('unsSpyInbox.mqttProposalRide') }}
          <select v-model="modalMqttRideId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
            <option value="">{{ t('unsSpyInbox.actionsRidePlaceholder') }}</option>
            <option v-for="r in mqttRideOptions" :key="'m-' + r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label class="mt-3 block text-xs text-slate-400">
          {{ t('unsSpyInbox.mqttProposalSignal') }}
          <select v-model="modalSignalCatalogId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
            <option value="">{{ t('unsSpyInbox.actionsRidePlaceholder') }}</option>
            <option v-for="s in mqttSignalOptions" :key="s.signalCatalogId" :value="s.signalCatalogId">
              {{ s.signalCode }} — {{ s.label || s.signalCode }}
            </option>
          </select>
        </label>
        <label class="mt-3 block text-xs text-slate-400">
          {{ t('unsSpyInbox.mqttProposalSource') }}
          <select v-model="modalSignalSource" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
            <option v-for="src in mqttSignalSources" :key="src" :value="src">{{ src }}</option>
          </select>
        </label>
        <label class="mt-3 flex items-center gap-2 text-xs text-slate-300">
          <input v-model="modalActivatePrepared" type="checkbox" class="rounded border-slate-600" />
          {{ t('unsSpyInbox.mqttProposalActivate') }}
        </label>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitMqttProposalApprove"
          >
            {{ t('unsSpyInbox.mqttProposalApprove') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-rose-700 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-950/50 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitMqttProposalReject"
          >
            {{ t('unsSpyInbox.mqttProposalReject') }}
          </button>
          <button type="button" class="ml-auto text-xs text-slate-500 hover:text-slate-300" @click="closeMqttProposalModal">
            {{ t('unsSpyInbox.mqttProposalClose') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Proposals -->
    <section class="space-y-3">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.proposalsTitle') }}</h2>
      <p class="text-xs text-slate-500">{{ proposalTotal }} total · showing {{ proposalRows.length }}</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colProposedTopic') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSignalKey') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colMetric') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSourceType') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colStatus') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colDiscoveryEvent') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !proposalRows.length">
              <td colspan="8" class="px-3 py-8 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in proposalRows" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs" :title="row.proposedTopic">{{ row.proposedTopic }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ proposalSignalKey(row) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ proposalMetric(row) }}</td>
              <td class="px-3 py-2 text-xs">{{ proposalSourceType(row) }}</td>
              <td class="px-3 py-2">
                <span class="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{{ row.status }}</span>
              </td>
              <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-xs" :title="row.discoveryEventId">{{ row.discoveryEventId }}</td>
              <td class="px-3 py-2">
                <button
                  v-if="isPendingProposal(row) && canWriteSpy"
                  type="button"
                  class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  @click="openMqttProposalModal(row)"
                >
                  {{ t('unsSpyInbox.mqttProposalOpen') }}
                </button>
                <span v-else class="text-xs text-slate-600">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Unknown / conflict -->
    <section class="space-y-3">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsSpyInbox.unknownTitle') }}</h2>
      <p class="text-xs text-slate-500">GET /api/v1/mqtt/inbound/unknown — {{ unknownTotal }} total · {{ unknownRows.length }} shown</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colClassification') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopicPath') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSuggestedAction') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !unknownRows.length">
              <td colspan="4" class="px-3 py-8 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in unknownRows" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.classification }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs" :title="row.topicPath">{{ row.topicPath }}</td>
              <td class="max-w-xl px-3 py-2 text-xs text-slate-300">{{ suggestedActionText(row.classification) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
