<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  getDataQualityIssues,
  getIntegrationFeatureFlags,
  getMqttCapabilityGuardStatus,
  getMqttInbound,
  getMqttInboundUnknown,
  getOperationsFactsRide,
  getPlatformAssets,
  getRideSignalCapabilities,
  getRides,
  getUnsLatestState,
  getUnsMqttLiveEvents,
  getUnsRegistryTopics,
  getUnsSpyEvents,
  getUnsSpyProposals,
  listMasterData,
  postActivatePreparedRideUnsTopics,
  postUnsSpyDiscoveryApprove,
  postUnsSpyDiscoveryIgnore,
  postUnsSpyDiscoveryReject,
  postUnsSpyProposalApprove,
  postUnsSpyProposalReject,
  putRideSignalCapabilities,
  resolveDataQualityIssue,
  type DqIssue,
  type IntegrationFeatureFlags,
  type MqttCapabilityGuardStatus,
  type MqttInboundRow,
  type OperationFactRide,
  type RideSignalCapabilitiesPayload,
  type RideSignalCapabilitySignalRow,
  type RideSignalSource,
  type UnsDiscoveryEventRow,
  type UnsLatestState,
  type UnsMqttLiveEvent,
  type UnsRegistryTopicRow,
  type UnsTopicProposalRow,
} from '@/api/client'
import {
  computeRideReadiness,
  evaluateRegistryGovernance,
  governanceReasonLabel,
  governanceTierForSignal,
  kpiKeyForSignalCode,
  latestStateEventTimeForTopic,
  mqttBlockExplanations,
  pickLatestLiveEvent,
  type GovernanceTier,
} from '@/composables/unsGovernanceHelpers'
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

const flags = ref<IntegrationFeatureFlags | null>(null)
const guard = ref<MqttCapabilityGuardStatus | null>(null)

const kpis = ref({
  inbound: 0,
  unknownTopic: 0,
  unknownSignal: 0,
  conflict: 0,
  proposals: 0,
  pendingProposals: 0,
  rejectedProposals: 0,
  skipped: 0,
  blockedMqtt: 0,
  mqttUnknownSignal: 0,
  disabledPrepared: 0,
  staleSignals: 0,
  governanceGreen: 0,
  governanceActiveTopics: 0,
})

const mqttRows = ref<MqttInboundRow[]>([])
const discoveryRows = ref<UnsDiscoveryEventRow[]>([])
const proposalRows = ref<UnsTopicProposalRow[]>([])
const unknownRows = ref<UnsDiscoveryEventRow[]>([])
const dqRows = ref<DqIssue[]>([])

const fTopicPrefix = ref('')
const fEventSource = ref<'all' | 'mqtt' | 'adapter'>('all')
const fDiscClassification = ref('')
const fMqttSpyClass = ref('')
const fGuardDecision = ref<'' | 'ALLOW' | 'WARN' | 'BLOCK' | 'SKIP'>('')
const fProposalStatus = ref<'all' | 'pending' | 'approved' | 'rejected'>('all')
const fProviderContains = ref('')
const fDqSeverity = ref('')
const fSignalSourceContains = ref('')
const restrictToActivePark = ref(true)
const tableLimit = ref(60)

const STALE_MS = 15 * 60 * 1000
const governanceRideId = ref('')
const governanceRideOptions = ref<{ id: string; name: string }[]>([])
const rideCapabilities = ref<RideSignalCapabilitiesPayload | null>(null)
/** Parsed from capability UNS previews — scopes park-wide MQTT buffer rows to the selected governance ride. */
const governanceRideAssetSlug = computed(() => {
  const caps = rideCapabilities.value
  if (!caps?.signals?.length) return ''
  const sample = caps.signals.find((s) => String(s.unsTopicPreview || '').toLowerCase().includes('/rides/'))
  const m = sample?.unsTopicPreview?.match(/\/rides\/([^/]+)\//i)
  return m?.[1]?.trim().toLowerCase() || ''
})
const governanceLiveMatchOpts = computed(() => {
  const s = governanceRideAssetSlug.value.trim()
  return s ? { rideAssetSlug: s } : undefined
})
const liveEvents = ref<UnsMqttLiveEvent[]>([])
const latestStates = ref<UnsLatestState[]>([])
const operationFactRide = ref<OperationFactRide | null>(null)
const fGovernanceTier = ref<'all' | GovernanceTier>('all')
const fActionSeverity = ref<'all' | 'error' | 'warning' | 'info'>('all')

const lineageOpen = ref(false)
const lineageSig = ref<RideSignalCapabilitySignalRow | null>(null)
const lineageMirrorTopic = ref<UnsRegistryTopicRow | null>(null)
const lineageBusy = ref(false)
const enableModalOpen = ref(false)
const enableTargetCatalogId = ref('')
const enablePickSource = ref<RideSignalSource>('MQTT_EDGE')

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
const mqttSignalOptions = ref<RideSignalCapabilitySignalRow[]>([])
const mqttRideOptions = ref<{ id: string; name: string }[]>([])

const mqttSignalSources: RideSignalSource[] = [
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
]

const canWrite = computed(
  () => auth.hasPermission('integrations', 'manage') || auth.hasPermission('rides', 'update')
)
const canDqRead = computed(() => auth.hasPermission('dataquality', 'read'))
const canDqResolve = computed(() => auth.hasPermission('dataquality', 'update'))

const parkSlug = computed(() => String(parkCtx.activePark?.slug || '').trim().toLowerCase())

const limitNum = computed(() => Math.min(200, Math.max(1, Number(tableLimit.value) || 60)))

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function discoveryProvider(row: UnsDiscoveryEventRow): string {
  const d = row.details || {}
  if (typeof d.source === 'string') return d.source
  if (typeof d.provider === 'string') return d.provider
  return ''
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

function isAdapterDiscoveryRow(row: UnsDiscoveryEventRow): boolean {
  return discoveryProvider(row) === 'adapter'
}

function isPendingProposal(row: UnsTopicProposalRow): boolean {
  return String(row.status || '').toLowerCase() === 'pending'
}

function topicText(r: MqttInboundRow | UnsDiscoveryEventRow): string {
  return 'topic' in r ? r.topic : r.topicPath
}

function matchesParkScope(row: MqttInboundRow | UnsDiscoveryEventRow): boolean {
  if (!restrictToActivePark.value || !parkSlug.value) return true
  return topicText(row).toLowerCase().includes(parkSlug.value)
}

function matchesProvider(row: UnsDiscoveryEventRow): boolean {
  const q = fProviderContains.value.trim().toLowerCase()
  if (!q) return true
  return discoveryProvider(row).toLowerCase().includes(q)
}

function matchesSignalSourceProposal(row: UnsTopicProposalRow): boolean {
  const q = fSignalSourceContains.value.trim().toLowerCase()
  if (!q) return true
  return proposalSourceType(row).toLowerCase().includes(q)
}

function matchesDqSeverity(row: DqIssue): boolean {
  const q = fDqSeverity.value.trim().toLowerCase()
  if (!q) return true
  return String(row.severity || '').toLowerCase() === q
}

const mqttFiltered = computed(() => mqttRows.value.filter((r) => matchesParkScope(r)))
const discoveryFiltered = computed(() =>
  discoveryRows.value.filter((r) => matchesParkScope(r) && matchesProvider(r))
)
const proposalsFiltered = computed(() => proposalRows.value.filter((r) => matchesSignalSourceProposal(r)))
const unknownFiltered = computed(() => unknownRows.value.filter((r) => matchesParkScope(r)))
const dqFiltered = computed(() => dqRows.value.filter((r) => matchesDqSeverity(r)))

function severityRank(s: string): number {
  const x = String(s || '').toLowerCase()
  if (x === 'error' || x === 'critical') return 3
  if (x === 'warning' || x === 'warn') return 2
  return 1
}

function matchesActionSeverity(rowSev: string): boolean {
  const f = fActionSeverity.value
  if (f === 'all') return true
  const r = severityRank(rowSev)
  if (f === 'error') return r >= 3
  if (f === 'warning') return r === 2
  if (f === 'info') return r <= 1
  return true
}

const signalHealthRows = computed(() => {
  const caps = rideCapabilities.value
  if (!caps) return []
  const of = operationFactRide.value
  const live = liveEvents.value
  const states = latestStates.value
  return caps.signals.map((s) => {
    const liveEv = pickLatestLiveEvent(s, live)
    const stIso = latestStateEventTimeForTopic(states, s.unsTopicPreview)
    const k = kpiKeyForSignalCode(s.signalCode)
    const obs = k && of ? (of.sourceBreakdown[k]?.source ?? null) : null
    const tier = governanceTierForSignal(s, {
      staleMs: STALE_MS,
      latestStateIso: stIso,
      liveReceivedAt: liveEv?.receivedAt ?? null,
      opsBreakdownSource: obs,
      deprecationHealthOk: true,
    })
    const gov = evaluateRegistryGovernance(s)
    return { signal: s, tier, gov, lastIso: liveEv?.receivedAt || stIso }
  })
})

const filteredSignalHealthRows = computed(() =>
  signalHealthRows.value.filter((row) => {
    if (fGovernanceTier.value !== 'all' && row.tier !== fGovernanceTier.value) return false
    return true
  })
)

const readiness = computed(() =>
  computeRideReadiness({
    capabilities: rideCapabilities.value?.signals ?? [],
    operationFact: operationFactRide.value,
    staleMs: STALE_MS,
    latestStates: latestStates.value,
    liveEvents: liveEvents.value,
    rideAssetSlug: governanceRideAssetSlug.value || null,
  })
)

type ActionQ = {
  id: string
  severity: string
  title: string
  detail: string
  action?: 'proposal' | 'signal' | 'dq'
  refId?: string
}

const actionQueueRows = computed((): ActionQ[] => {
  const out: ActionQ[] = []
  for (const p of proposalRows.value) {
    if (!isPendingProposal(p)) continue
    if (fProposalStatus.value !== 'all' && fProposalStatus.value !== 'pending') continue
    out.push({
      id: `p-${p.id}`,
      severity: 'warning',
      title: `Proposal: ${p.proposedTopic}`,
      detail: String(p.status),
      action: 'proposal',
      refId: p.id,
    })
  }
  for (const row of mqttFiltered.value) {
    if (String(row.capabilityGuardDecision || '').toUpperCase() !== 'BLOCK') continue
    out.push({
      id: `m-${row.id}`,
      severity: 'error',
      title: `Blocked MQTT: ${row.topic}`,
      detail: mqttBlockExplanations(row).join(' · '),
    })
  }
  for (const s of signalHealthRows.value) {
    if (s.signal.signalSource === 'NOT_AVAILABLE' && (s.signal.isPreparedTopic || s.signal.isPreparedSparkplug)) {
      out.push({
        id: `d-${s.signal.signalCatalogId}`,
        severity: 'warning',
        title: `Disabled source, prepared registry: ${s.signal.signalCode}`,
        detail: governanceReasonLabel(s.gov.reason),
        action: 'signal',
        refId: s.signal.signalCatalogId,
      })
    }
    if (
      (s.signal.isActiveTopic || s.signal.isActiveSparkplug) &&
      s.lastIso &&
      Date.now() - Date.parse(s.lastIso) > STALE_MS
    ) {
      out.push({
        id: `s-${s.signal.signalCatalogId}`,
        severity: 'warning',
        title: `Stale signal: ${s.signal.signalCode}`,
        detail: s.lastIso,
        action: 'signal',
        refId: s.signal.signalCatalogId,
      })
    }
  }
  for (const d of dqRows.value) {
    const it = String(d.issueType || '').toLowerCase()
    if (!/mqtt|payload|schema|validation|signal|uns|topic/.test(it)) continue
    out.push({
      id: `q-${d.id}`,
      severity: String(d.severity || 'info'),
      title: `DQ: ${d.issueType}`,
      detail: String(d.message || ''),
      action: 'dq',
      refId: d.id,
    })
  }
  return out.filter((r) => matchesActionSeverity(r.severity))
})

function tierBadgeClass(tier: GovernanceTier): string {
  if (tier === 'GREEN') return 'bg-emerald-900/80 text-emerald-100 ring-emerald-700/40'
  if (tier === 'YELLOW') return 'bg-amber-900/80 text-amber-100 ring-amber-700/40'
  if (tier === 'RED') return 'bg-rose-900/80 text-rose-100 ring-rose-700/40'
  return 'bg-slate-800 text-slate-300 ring-slate-600/40'
}

async function loadGovernanceRideOptions() {
  const pid = parkCtx.activeParkId?.trim()
  governanceRideOptions.value = []
  try {
    if (pid) {
      const assets = await getPlatformAssets({ parkId: pid, assetTypeCode: 'RIDE', limit: 400 })
      governanceRideOptions.value = assets.map((a) => {
        const id = String(a.assetId ?? a.id ?? '')
        const dn = typeof a.displayName === 'string' ? a.displayName.trim() : ''
        const n = typeof a.name === 'string' ? a.name.trim() : ''
        return { id, name: dn || n || id }
      })
    } else {
      const rides = await getRides()
      governanceRideOptions.value = rides.map((r) => ({ id: r.id, name: r.name }))
    }
  } catch {
    governanceRideOptions.value = []
  }
}

async function findMirrorTopicForSignalLocal(
  parkId: string,
  catalogId: string,
  signalCode: string
): Promise<UnsRegistryTopicRow | null> {
  let offset = 0
  const limit = 200
  const maxScan = 4000
  while (offset < maxScan) {
    const res = await getUnsRegistryTopics({ parkId, limit, offset })
    for (const row of res.items) {
      const pj = row.payloadJson || {}
      const sid = pj.signalCatalogId != null ? String(pj.signalCatalogId) : ''
      if (sid && sid === catalogId) return row
      const metric = typeof pj.metric === 'string' ? pj.metric : ''
      if (metric && signalCode && metric.toLowerCase() === signalCode.trim().toLowerCase()) return row
    }
    if (!res.items.length || res.items.length < limit) break
    offset += limit
  }
  return null
}

async function openLineage(sig: RideSignalCapabilitySignalRow) {
  lineageSig.value = sig
  lineageMirrorTopic.value = null
  lineageOpen.value = true
  const pid = parkCtx.activeParkId?.trim()
  if (!pid) return
  lineageBusy.value = true
  try {
    lineageMirrorTopic.value = await findMirrorTopicForSignalLocal(pid, sig.signalCatalogId, sig.signalCode)
  } catch {
    lineageMirrorTopic.value = null
  } finally {
    lineageBusy.value = false
  }
}

function closeLineage() {
  lineageOpen.value = false
  lineageSig.value = null
  lineageMirrorTopic.value = null
}

function openEnableFromLineage() {
  if (!lineageSig.value) return
  enableTargetCatalogId.value = lineageSig.value.signalCatalogId
  enablePickSource.value = 'MQTT_EDGE'
  enableModalOpen.value = true
}

async function submitEnableCapability() {
  const rideId = governanceRideId.value.trim()
  const capId = enableTargetCatalogId.value.trim()
  const caps = rideCapabilities.value
  if (!rideId || !capId || !caps) {
    push(t('unsGovernance.enablePick'), 'error')
    return
  }
  actionBusy.value = true
  try {
    rideCapabilities.value = await putRideSignalCapabilities(rideId, {
      capabilities: caps.signals.map((s) => ({
        signalCatalogId: s.signalCatalogId,
        signalSource: s.signalCatalogId === capId ? enablePickSource.value : s.signalSource,
        valueType: s.valueType,
      })),
    })
    push(t('unsGovernance.enableSaved'), 'success')
    enableModalOpen.value = false
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsGovernance.enableFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

async function submitActivatePreparedAll() {
  const rideId = governanceRideId.value.trim()
  if (!rideId) return
  actionBusy.value = true
  try {
    const r = await postActivatePreparedRideUnsTopics(rideId)
    push(t('unsGovernance.activated', { activated: r.activated, skipped: r.skipped }), 'success')
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsGovernance.activateFailed'), 'error')
  } finally {
    actionBusy.value = false
  }
}

function onActionQueueClick(row: ActionQ) {
  if (row.action === 'proposal' && row.refId) {
    const p = proposalRows.value.find((x) => x.id === row.refId)
    if (p && canWrite.value) void openMqttProposalModal(p)
  } else if (row.action === 'signal') {
    document.getElementById('gov-signal-health')?.scrollIntoView({ behavior: 'smooth' })
  }
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

async function resolveDq(id: string) {
  try {
    await resolveDataQualityIssue(id)
    push(t('unsGovernance.dqResolved'), 'success')
    await refresh()
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsGovernance.dqResolveFailed'), 'error')
  }
}

async function refresh() {
  busy.value = true
  loadError.value = null
  const lim = limitNum.value
  const proposalStatusParam =
    fProposalStatus.value === 'all' ? undefined : fProposalStatus.value
  try {
    const heads = await Promise.all([
      getMqttInbound({ limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'UNKNOWN_TOPIC', limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'UNKNOWN_SIGNAL', limit: 1, offset: 0 }),
      getUnsSpyEvents({ classification: 'CONFLICT', limit: 1, offset: 0 }),
      getUnsSpyProposals({ limit: 1, offset: 0 }),
      getUnsSpyProposals({ status: 'pending', limit: 1, offset: 0 }),
      getUnsSpyProposals({ status: 'rejected', limit: 1, offset: 0 }),
      getMqttInbound({ limit: 1, offset: 0, spyClassification: 'OBSERVE_SKIPPED' }),
      getMqttInbound({ capabilityDecision: 'BLOCK', limit: 1, offset: 0 }),
      getMqttInbound({ spyClassification: 'UNKNOWN_SIGNAL', limit: 1, offset: 0 }),
    ])

    const dataLoads: Promise<unknown>[] = [
      getIntegrationFeatureFlags(),
      getMqttCapabilityGuardStatus(),
      getMqttInbound({
        limit: lim,
        offset: 0,
        topicPrefix: str(fTopicPrefix.value) || undefined,
        spyClassification: str(fMqttSpyClass.value) || undefined,
        capabilityDecision: fGuardDecision.value || undefined,
      }),
      getUnsSpyEvents({
        limit: lim,
        offset: 0,
        classification: str(fDiscClassification.value) || undefined,
        topicPrefix: str(fTopicPrefix.value) || undefined,
        eventSource: fEventSource.value,
      }),
      getUnsSpyProposals({ limit: lim, offset: 0, status: proposalStatusParam }),
      getMqttInboundUnknown({ limit: lim, offset: 0, topicPrefix: str(fTopicPrefix.value) || undefined }),
    ]
    if (canDqRead.value) {
      dataLoads.push(getDataQualityIssues({ limit: 100, resolved: false }))
    }

    const results = await Promise.all(dataLoads)
    let i = 0
    flags.value = results[i++] as IntegrationFeatureFlags
    guard.value = results[i++] as MqttCapabilityGuardStatus
    const mqttData = results[i++] as { items: MqttInboundRow[]; total: number }
    const discData = results[i++] as { items: UnsDiscoveryEventRow[]; total: number }
    const propData = results[i++] as { items: UnsTopicProposalRow[]; total: number }
    const unknownData = results[i++] as { items: UnsDiscoveryEventRow[]; total: number }
    if (canDqRead.value) {
      const dq = results[i++] as { data: DqIssue[] }
      dqRows.value = dq.data
    } else {
      dqRows.value = []
    }

    kpis.value = {
      inbound: heads[0].total,
      unknownTopic: heads[1].total,
      unknownSignal: heads[2].total,
      conflict: heads[3].total,
      proposals: heads[4].total,
      pendingProposals: heads[5].total,
      rejectedProposals: heads[6].total,
      skipped: heads[7].total,
      blockedMqtt: heads[8].total,
      mqttUnknownSignal: heads[9].total,
      disabledPrepared: 0,
      staleSignals: 0,
      governanceGreen: 0,
      governanceActiveTopics: 0,
    }
    mqttRows.value = mqttData.items
    discoveryRows.value = discData.items
    proposalRows.value = propData.items
    unknownRows.value = unknownData.items

    await loadGovernanceRideOptions()

    const parkId = parkCtx.activeParkId?.trim()
    const rideId = governanceRideId.value.trim()
    rideCapabilities.value = null
    operationFactRide.value = null
    liveEvents.value = []
    latestStates.value = []
    let disabledPrepared = 0
    let staleSignals = 0
    let governanceGreen = 0
    let governanceActiveTopics = 0
    if (rideId && parkId) {
      const [caps, of, live, states] = await Promise.all([
        getRideSignalCapabilities(rideId).catch(() => null),
        getOperationsFactsRide(rideId).catch(() => null),
        getUnsMqttLiveEvents(parkId, { limit: 400 }).catch(() => []),
        getUnsLatestState(parkId).catch(() => []),
      ])
      rideCapabilities.value = caps
      operationFactRide.value = of
      liveEvents.value = live
      latestStates.value = states
      if (caps) {
        for (const s of caps.signals) {
          if (s.signalSource === 'NOT_AVAILABLE' && (s.isPreparedTopic || s.isPreparedSparkplug)) disabledPrepared += 1
          const liveEv = pickLatestLiveEvent(s, live, governanceLiveMatchOpts.value)
          const stIso = latestStateEventTimeForTopic(states, s.unsTopicPreview)
          const k = kpiKeyForSignalCode(s.signalCode)
          const obs = k && of ? (of.sourceBreakdown[k]?.source ?? null) : null
          const tier = governanceTierForSignal(s, {
            staleMs: STALE_MS,
            latestStateIso: stIso,
            liveReceivedAt: liveEv?.receivedAt ?? null,
            opsBreakdownSource: obs,
            deprecationHealthOk: true,
          })
          if (tier === 'GREEN') governanceGreen += 1
          if (s.isActiveTopic) governanceActiveTopics += 1
          if (
            (s.isActiveTopic || s.isActiveSparkplug) &&
            (liveEv?.receivedAt || stIso) &&
            Date.now() - Date.parse(String(liveEv?.receivedAt || stIso)) > STALE_MS
          ) {
            staleSignals += 1
          }
        }
      }
    }
    kpis.value = {
      ...kpis.value,
      disabledPrepared,
      staleSignals,
      governanceGreen,
      governanceActiveTopics,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed'
    loadError.value = msg
    push(msg, 'error')
  } finally {
    busy.value = false
  }
}

watch(governanceRideId, () => {
  void refresh()
})

watch(
  () => parkCtx.activeParkId,
  () => {
    governanceRideId.value = ''
    void refresh()
  }
)

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('unsGovernance.title') }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('unsGovernance.subtitle') }}</p>
        <div class="mt-2 flex flex-wrap gap-2 text-xs">
          <RouterLink class="text-brand-300 hover:underline" to="/realtime/discovery">{{ t('unsGovernance.linkSpyInbox') }}</RouterLink>
          <span class="text-slate-600">·</span>
          <RouterLink class="text-brand-300 hover:underline" to="/data-quality">{{ t('unsGovernance.linkDataQuality') }}</RouterLink>
          <span class="text-slate-600">·</span>
          <RouterLink class="text-brand-300 hover:underline" to="/realtime/topics">{{ t('unsGovernance.linkSignalView') }}</RouterLink>
          <span class="text-slate-600">·</span>
          <RouterLink class="text-brand-300 hover:underline" to="/diagnostics/registry-mirror">{{ t('unsGovernance.linkRegistryMirror') }}</RouterLink>
          <span class="text-slate-600">·</span>
          <RouterLink class="text-brand-300 hover:underline" :to="{ name: 'master-data', params: { entityType: 'rides' } }">
            {{ t('unsGovernance.linkRideCapabilities') }}
          </RouterLink>
        </div>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="busy"
        @click="refresh"
      >
        {{ busy ? '…' : t('unsGovernance.refresh') }}
      </button>
    </div>

    <p v-if="loadError" class="rounded-lg border border-rose-800/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {{ loadError }}
    </p>

    <p v-if="parkCtx.activePark" class="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
      {{ t('unsGovernance.activePark', { name: parkCtx.activePark.name || parkCtx.activePark.slug || parkCtx.activeParkId }) }}
    </p>
    <p v-else class="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200/90">
      {{ t('unsGovernance.noPark') }}
    </p>

    <!-- KPIs -->
    <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiInbound') }}</p>
        <p class="mt-1 font-mono text-xl text-white">{{ kpis.inbound }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiUnknownTopic') }}</p>
        <p class="mt-1 font-mono text-xl text-amber-200">{{ kpis.unknownTopic }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiUnknownSignal') }}</p>
        <p class="mt-1 font-mono text-xl text-amber-200">{{ kpis.unknownSignal }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiConflict') }}</p>
        <p class="mt-1 font-mono text-xl text-rose-200">{{ kpis.conflict }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiProposals') }}</p>
        <p class="mt-1 font-mono text-xl text-brand-100">{{ kpis.proposals }}</p>
        <p class="mt-0.5 text-[10px] text-slate-500">{{ t('unsGovernance.kpiPendingRejected', { p: kpis.pendingProposals, r: kpis.rejectedProposals }) }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiSkipped') }}</p>
        <p class="mt-1 font-mono text-xl text-slate-300">{{ kpis.skipped }}</p>
      </div>
      <div v-if="guard" class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiGuard24h') }}</p>
        <p class="mt-1 text-xs text-slate-300">
          <span class="text-rose-300">BLOCK {{ guard.blockedLast24h }}</span>
          ·
          <span class="text-amber-200">WARN {{ guard.warnedLast24h }}</span>
          ·
          <span class="text-emerald-300">ALLOW {{ guard.allowedLast24h }}</span>
        </p>
        <p class="mt-1 text-[10px] text-slate-500">{{ t('unsGovernance.guardMode', { mode: guard.mode }) }}</p>
      </div>
      <div v-if="flags" class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiFlags') }}</p>
        <p class="mt-1 text-xs text-slate-300">
          {{ t('unsGovernance.flagSpy', { on: flags.adapterDiscoverySpyEnabled ? 'on' : 'off' }) }} ·
          {{ t('unsGovernance.flagEnforce', { on: flags.mqttEnforceCapabilities ? 'on' : 'off' }) }}
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiBlockedMqtt') }}</p>
        <p class="mt-1 font-mono text-xl text-rose-200">{{ kpis.blockedMqtt }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiInvalidSignal') }}</p>
        <p class="mt-1 font-mono text-xl text-orange-200">{{ kpis.mqttUnknownSignal }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiDisabledPrep') }}</p>
        <p class="mt-1 font-mono text-xl text-slate-200">{{ kpis.disabledPrepared }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiStale') }}</p>
        <p class="mt-1 font-mono text-xl text-amber-200">{{ kpis.staleSignals }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.kpiGreenActive') }}</p>
        <p class="mt-1 font-mono text-lg text-emerald-100">
          {{ kpis.governanceGreen }} <span class="text-slate-500">/</span> {{ kpis.governanceActiveTopics }}
        </p>
      </div>
    </section>

    <!-- Filters -->
    <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ t('unsGovernance.filtersTitle') }}</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <label class="block text-xs text-slate-400">
          {{ t('unsSpyInbox.filterTopicPrefix') }}
          <input v-model="fTopicPrefix" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsSpyInbox.filterEventSource') }}
          <select v-model="fEventSource" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="all">{{ t('unsSpyInbox.eventSourceAll') }}</option>
            <option value="mqtt">{{ t('unsSpyInbox.eventSourceMqtt') }}</option>
            <option value="adapter">{{ t('unsSpyInbox.eventSourceAdapter') }}</option>
          </select>
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsSpyInbox.filterClassification') }}
          <input v-model="fDiscClassification" type="text" placeholder="UNKNOWN_TOPIC …" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsSpyInbox.filterSpyClass') }}
          <input v-model="fMqttSpyClass" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterGuardDecision') }}
          <select v-model="fGuardDecision" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="">{{ t('unsGovernance.filterAll') }}</option>
            <option value="BLOCK">BLOCK</option>
            <option value="WARN">WARN</option>
            <option value="SKIP">SKIP</option>
            <option value="ALLOW">ALLOW</option>
          </select>
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterProposalStatus') }}
          <select v-model="fProposalStatus" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="all">{{ t('unsGovernance.filterAll') }}</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
          </select>
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterProvider') }}
          <input v-model="fProviderContains" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterSignalSource') }}
          <input v-model="fSignalSourceContains" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterDqSeverity') }}
          <input v-model="fDqSeverity" type="text" placeholder="HIGH …" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsSpyInbox.filterLimit') }}
          <input v-model.number="tableLimit" type="number" min="1" max="200" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <label class="flex items-center gap-2 text-xs text-slate-300 sm:col-span-2">
          <input v-model="restrictToActivePark" type="checkbox" class="rounded border-slate-600" />
          {{ t('unsGovernance.filterParkScope') }}
        </label>
      </div>
      <button
        type="button"
        class="mt-3 rounded-lg bg-brand-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        :disabled="busy"
        @click="refresh"
      >
        {{ t('unsGovernance.applyFilters') }}
      </button>
      <div class="mt-4 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterRideGovernance') }}
          <select v-model="governanceRideId" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="">{{ t('unsGovernance.filterAll') }}</option>
            <option v-for="o in governanceRideOptions" :key="'ride-' + o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterGovTier') }}
          <select v-model="fGovernanceTier" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="all">{{ t('unsGovernance.filterAll') }}</option>
            <option value="GREEN">GREEN</option>
            <option value="YELLOW">YELLOW</option>
            <option value="RED">RED</option>
            <option value="GREY">GREY</option>
          </select>
        </label>
        <label class="block text-xs text-slate-400">
          {{ t('unsGovernance.filterActionSeverity') }}
          <select v-model="fActionSeverity" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
            <option value="all">{{ t('unsGovernance.filterAll') }}</option>
            <option value="error">error</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
        </label>
      </div>
    </section>

    <section v-if="governanceRideId" class="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
      <h2 class="text-sm font-semibold text-white">{{ t('unsGovernance.readinessTitle') }}</h2>
      <div class="mt-3 flex flex-wrap gap-2">
        <span
          class="rounded-full px-3 py-1 text-xs font-medium ring-1"
          :class="readiness.operationsFactsReady ? 'bg-emerald-950/80 text-emerald-100 ring-emerald-700/40' : 'bg-rose-950/60 text-rose-100 ring-rose-700/40'"
        >
          {{ t('unsGovernance.readyOps') }}: {{ readiness.operationsFactsReady ? 'OK' : '—' }}
        </span>
        <span
          class="rounded-full px-3 py-1 text-xs font-medium ring-1"
          :class="readiness.addonBoardReady ? 'bg-emerald-950/80 text-emerald-100 ring-emerald-700/40' : 'bg-amber-950/60 text-amber-100 ring-amber-700/40'"
        >
          {{ t('unsGovernance.readyAddon') }}: {{ readiness.addonBoardReady ? 'OK' : '—' }}
        </span>
        <span
          class="rounded-full px-3 py-1 text-xs font-medium ring-1"
          :class="readiness.mlReady ? 'bg-emerald-950/80 text-emerald-100 ring-emerald-700/40' : 'bg-amber-950/60 text-amber-100 ring-amber-700/40'"
        >
          {{ t('unsGovernance.readyMl') }}: {{ readiness.mlReady ? 'OK' : '—' }}
        </span>
      </div>
      <p v-if="readiness.missingApprovedSignals.length" class="mt-2 text-xs text-amber-200">
        {{ t('unsGovernance.missingSignals') }}: {{ readiness.missingApprovedSignals.join(', ') }}
      </p>
      <p v-for="(n, i) in readiness.notes" :key="'rn-' + i" class="mt-1 text-xs text-slate-500">{{ n }}</p>
    </section>

    <section v-if="governanceRideId && rideCapabilities" id="gov-signal-health" class="space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionSignalHealth') }}</h2>
        <button
          v-if="canWrite"
          type="button"
          class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
          @click="submitActivatePreparedAll"
        >
          {{ t('rideSignalCaps.pilotActivateUns') }}
        </button>
      </div>
      <p class="text-xs text-slate-500">{{ t('unsGovernance.signalHealthHint') }}</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsGovernance.filterGovTier') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSignalKey') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.mqttProposalSource') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsGovernance.colSignalWhy') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredSignalHealthRows.length">
              <td colspan="6" class="px-3 py-6 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in filteredSignalHealthRows" :key="row.signal.signalCatalogId" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="px-3 py-2">
                <span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1" :class="tierBadgeClass(row.tier)">{{ row.tier }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.signal.signalCode }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.signal.signalSource }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ row.lastIso ? formatDateTime(row.lastIso) : '—' }}</td>
              <td class="max-w-md px-3 py-2 text-xs text-slate-400">{{ governanceReasonLabel(row.gov.reason) }}</td>
              <td class="px-3 py-2">
                <button
                  type="button"
                  class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  @click="openLineage(row.signal)"
                >
                  {{ t('unsGovernance.trace') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionActionQueue') }}</h2>
      <p class="text-xs text-slate-500">{{ t('unsGovernance.actionQueueHint') }}</p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsGovernance.filterActionSeverity') }}</th>
              <th class="px-3 py-2">{{ t('unsGovernance.sectionActionQueue') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!actionQueueRows.length">
              <td colspan="3" class="px-3 py-6 text-center text-slate-500">{{ t('unsGovernance.actionQueueEmpty') }}</td>
            </tr>
            <tr v-for="q in actionQueueRows" :key="q.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="px-3 py-2 font-mono text-xs">{{ q.severity }}</td>
              <td class="px-3 py-2">
                <p class="font-medium text-slate-100">{{ q.title }}</p>
                <p class="text-xs text-slate-500">{{ q.detail }}</p>
              </td>
              <td class="px-3 py-2">
                <button
                  v-if="q.action && q.action !== 'dq'"
                  type="button"
                  class="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                  @click="onActionQueueClick(q)"
                >
                  {{ t('unsGovernance.actionOpen') }}
                </button>
                <RouterLink v-else-if="q.action === 'dq'" to="/data-quality" class="text-[11px] text-brand-200 underline hover:text-brand-100">DQ</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MQTT + guard -->
    <section class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionMqtt') }}</h2>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colReceivedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopic') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSpyClass') }}</th>
              <th class="px-3 py-2">{{ t('unsGovernance.colGuard') }}</th>
              <th class="px-3 py-2">{{ t('unsGovernance.colGuardReason') }}</th>
              <th class="px-3 py-2">{{ t('unsGovernance.colWhyBlock') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !mqttFiltered.length">
              <td colspan="6" class="px-3 py-6 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in mqttFiltered" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs" :title="row.topic">{{ row.topic }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.spyClassification || '—' }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded px-1.5 py-0.5 text-xs"
                  :class="{
                    'bg-rose-900/50 text-rose-200': row.capabilityGuardDecision === 'BLOCK',
                    'bg-amber-900/40 text-amber-200': row.capabilityGuardDecision === 'WARN',
                    'bg-slate-800 text-slate-300': !row.capabilityGuardDecision || row.capabilityGuardDecision === 'ALLOW',
                  }"
                >
                  {{ row.capabilityGuardDecision || '—' }}
                </span>
              </td>
              <td class="max-w-xs truncate px-3 py-2 text-xs text-slate-400" :title="row.capabilityGuardReason || ''">
                {{ row.capabilityGuardReason || '—' }}
              </td>
              <td class="max-w-sm px-3 py-2 text-xs text-slate-400" :title="mqttBlockExplanations(row).join(' ')">
                {{ mqttBlockExplanations(row)[0] || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Unknown MQTT -->
    <section class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionUnknownMqtt') }}</h2>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colClassification') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopicPath') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !unknownFiltered.length">
              <td colspan="3" class="px-3 py-6 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in unknownFiltered" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.classification }}</td>
              <td class="max-w-lg truncate px-3 py-2 font-mono text-xs" :title="row.topicPath">{{ row.topicPath }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Discovery -->
    <section class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionDiscovery') }}</h2>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colClassification') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colTopicPath') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colProvider') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !discoveryFiltered.length">
              <td colspan="5" class="px-3 py-6 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in discoveryFiltered" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.classification }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs" :title="row.topicPath">{{ row.topicPath }}</td>
              <td class="max-w-[8rem] truncate px-3 py-2 text-xs">{{ discoveryProvider(row) || '—' }}</td>
              <td class="px-3 py-2">
                <button
                  v-if="isAdapterDiscoveryRow(row) && canWrite"
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

    <!-- Proposals -->
    <section class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionProposals') }}</h2>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colCreatedAt') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colProposedTopic') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSignalKey') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colSourceType') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colStatus') }}</th>
              <th class="px-3 py-2">{{ t('unsSpyInbox.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !proposalsFiltered.length">
              <td colspan="6" class="px-3 py-6 text-center text-slate-500">—</td>
            </tr>
            <tr v-for="row in proposalsFiltered" :key="row.id" class="border-t border-slate-800/90 hover:bg-slate-900/40">
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.createdAt) }}</td>
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs" :title="row.proposedTopic">{{ row.proposedTopic }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ proposalSignalKey(row) }}</td>
              <td class="px-3 py-2 text-xs">{{ proposalSourceType(row) }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.status }}</td>
              <td class="px-3 py-2">
                <button
                  v-if="isPendingProposal(row) && canWrite"
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

    <!-- Data quality -->
    <section v-if="canDqRead" class="space-y-2">
      <h2 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.sectionDq') }}</h2>
      <ul class="space-y-2">
        <li
          v-for="r in dqFiltered"
          :key="r.id"
          class="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm"
        >
          <div>
            <p class="font-mono text-xs text-brand-200">{{ r.issueType }} · {{ r.severity }}</p>
            <p class="text-slate-300">{{ r.message }}</p>
            <p class="text-xs text-slate-500">{{ formatDateTime(r.createdAt) }}</p>
          </div>
          <button
            v-if="canDqResolve"
            type="button"
            class="shrink-0 rounded bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600"
            @click="resolveDq(r.id)"
          >
            {{ t('unsGovernance.dqResolve') }}
          </button>
        </li>
      </ul>
      <p v-if="!busy && !dqFiltered.length" class="text-sm text-slate-500">{{ t('unsGovernance.dqEmpty') }}</p>
    </section>

    <p class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
      {{ t('unsGovernance.opsFactsHint') }}
    </p>

    <!-- Modals (reuse unsSpyInbox copy) -->
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
            <option v-for="r in mqttRideOptions" :key="'g-' + r.id" :value="r.id">{{ r.name }}</option>
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

    <div
      v-if="lineageOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="closeLineage"
    >
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl" @click.stop>
        <h3 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.lineageTitle') }}</h3>
        <p v-if="lineageSig" class="mt-1 font-mono text-sm text-brand-100">{{ lineageSig.signalCode }}</p>
        <div v-if="lineageBusy" class="mt-4 text-sm text-slate-400">…</div>
        <dl v-else-if="lineageSig" class="mt-4 space-y-3 text-sm text-slate-300">
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceInbound') }}</dt>
            <dd class="mt-1 text-xs">{{ t('unsGovernance.traceInboundHint') }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceRegistry') }}</dt>
            <dd class="mt-1 font-mono text-xs break-all">{{ lineageMirrorTopic?.topicPath || lineageSig.unsTopicPreview || '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceCatalog') }}</dt>
            <dd class="mt-1 font-mono text-xs">{{ lineageSig.signalCatalogId }} · {{ lineageSig.label || '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceCapability') }}</dt>
            <dd class="mt-1 text-xs">{{ lineageSig.signalSource }} · UNS prep {{ lineageSig.isPreparedTopic }} · UNS active {{ lineageSig.isActiveTopic }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceOps') }}</dt>
            <dd class="mt-1 text-xs">
              {{
                (() => {
                  const k = kpiKeyForSignalCode(lineageSig.signalCode)
                  if (!k || !operationFactRide) return '—'
                  const b = operationFactRide.sourceBreakdown[k]
                  return b ? `${b.source}: ${b.reason}` : '—'
                })()
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceLive') }}</dt>
            <dd class="mt-1 font-mono text-xs break-all">
              {{
                (() => {
                  const e = pickLatestLiveEvent(lineageSig, liveEvents, governanceLiveMatchOpts)
                  return e ? `${formatDateTime(e.receivedAt)} · ${e.canonicalUnsTopic || e.metric || '—'}` : '—'
                })()
              }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">{{ t('unsGovernance.traceBoardMl') }}</dt>
            <dd class="mt-1 text-xs text-slate-400">{{ t('unsGovernance.traceBoardMlHint') }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-if="lineageSig && canWrite && lineageSig.signalSource === 'NOT_AVAILABLE'"
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            @click="openEnableFromLineage"
          >
            {{ t('unsGovernance.enableOpen') }}
          </button>
          <button
            v-if="lineageSig && canWrite && lineageSig.isPreparedTopic && !lineageSig.isActiveTopic"
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="submitActivatePreparedAll"
          >
            {{ t('rideSignalCaps.pilotActivateUns') }}
          </button>
          <button type="button" class="ml-auto text-xs text-slate-500 hover:text-slate-300" @click="closeLineage">
            {{ t('unsSpyInbox.mqttProposalClose') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="enableModalOpen"
      class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="enableModalOpen = false"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl" @click.stop>
        <h3 class="font-display text-lg font-semibold text-white">{{ t('unsGovernance.enableTitle') }}</h3>
        <label class="mt-4 block text-xs text-slate-400">
          {{ t('unsSpyInbox.mqttProposalSource') }}
          <select v-model="enablePickSource" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
            <option v-for="src in mqttSignalSources" :key="'en-' + src" :value="src">{{ src }}</option>
          </select>
        </label>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            :disabled="actionBusy"
            @click="submitEnableCapability"
          >
            {{ t('unsGovernance.enableSave') }}
          </button>
          <button type="button" class="text-xs text-slate-500 hover:text-slate-300" @click="enableModalOpen = false">
            {{ t('unsSpyInbox.mqttProposalClose') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
