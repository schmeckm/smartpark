<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getIntegrationSettings,
  getMqttCapabilityGuardStatus,
  getMqttInbound,
  getMqttInboundUnknown,
  getOperationsFactsRide,
  getOperationsFactsRideParkScoped,
  getPlatformAssets,
  getRideSignalCapabilities,
  getRegistrySignalDeprecations,
  getUnsMqttLiveEvents,
  getUnsRegistryTopics,
  getUnsSpyEvents,
  tryGetRideSignalDeprecationHealthBySignalKey,
  type MqttCapabilityGuardStatus,
  type MqttInboundRow,
  type OperationFactRide,
  type OperationsFactsParkRidePayload,
  type RideSignalCapabilitySignalRow,
  type RideSignalCapabilitiesPayload,
  type RegistrySignalDeprecationHealth,
  type RegistrySignalDeprecationListRow,
  type RegistrySignalDeprecationsPayload,
  type UnsDiscoveryEventRow,
  type UnsMqttLiveEvent,
  type UnsRegistryTopicRow,
} from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useParkContextStore } from '@/stores/parkContext'

const { t } = useI18n()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()
const parkCtx = useParkContextStore()

type RegistryRollupState = 'NOT_PREPARED' | 'PREPARED' | 'ACTIVE'

const rideAssets = ref<PlatformAsset[]>([])
const rideId = ref('')
const signalCatalogId = ref('')

const capabilities = ref<RideSignalCapabilitiesPayload | null>(null)
const deprecations = ref<RegistrySignalDeprecationsPayload | null>(null)
const deprecationsLoadFailed = ref(false)

const mirrorTopic = ref<UnsRegistryTopicRow | null>(null)
const mqttInboundRows = ref<MqttInboundRow[]>([])
const mqttUnknownRows = ref<UnsDiscoveryEventRow[]>([])
const spyEventRows = ref<UnsDiscoveryEventRow[]>([])
const liveEvent = ref<UnsMqttLiveEvent | null>(null)

const mqttLiveGroupId = ref('')

const operationFactRide = ref<OperationFactRide | null>(null)
const operationFactsParkDoc = ref<OperationsFactsParkRidePayload | null>(null)
const operationFactsError = ref<string | null>(null)

const phase11AltHealth = ref<RegistrySignalDeprecationHealth | null>(null)

const capabilityGuardStatus = ref<MqttCapabilityGuardStatus | null>(null)
const mqttInboundCapFilter = ref<'' | 'ALLOW' | 'WARN' | 'BLOCK' | 'SKIP'>('')

const busyRide = ref(false)
const busySignal = ref(false)
const busyRefresh = ref(false)
const loadError = ref<string | null>(null)

function slugifyParkKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function assetIdOf(a: PlatformAsset): string {
  const raw = a.assetId ?? a.id
  return raw != null ? String(raw) : ''
}

function assetLabel(a: PlatformAsset): string {
  const dn = a.displayName
  const n = a.name
  const name =
    typeof dn === 'string' && dn.trim()
      ? dn.trim()
      : typeof n === 'string' && n.trim()
        ? n.trim()
        : ''
  return name || assetIdOf(a)
}

async function loadCapabilityGuardStatus() {
  try {
    capabilityGuardStatus.value = await getMqttCapabilityGuardStatus()
  } catch {
    capabilityGuardStatus.value = null
  }
}

async function resolveMqttGroupId() {
  try {
    const settings = await getIntegrationSettings()
    const key = typeof settings.unsParkKey === 'string' ? settings.unsParkKey.trim() : ''
    mqttLiveGroupId.value =
      key ||
      ((settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId as string) ||
      'europa_park'
    mqttLiveGroupId.value = slugifyParkKey(mqttLiveGroupId.value)
  } catch {
    mqttLiveGroupId.value = ''
  }
}

/** Mirrors backend `kpiKeyForSignalCode` (operations-facts.service.js). */
function kpiKeyForSignalCode(code: string): string | null {
  const n = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  const map: Record<string, string> = {
    queue_time: 'queueTime',
    queue_time_min: 'queueTime',
    wait_time: 'queueTime',
    predicted_wait_time: 'predictedWaitTime',
    forecast_wait_time_60: 'predictedWaitTime',
    throughput_actual: 'throughputActual',
    throughput_theoretical: 'throughputTheoretical',
    capacity_utilization: 'capacityUtilization',
    vehicles_active: 'vehiclesActive',
    staff_actual: 'staffActual',
    downtime_minutes: 'downtimeMinutes',
    ride_status: 'status',
    operating_status: 'status',
    status: 'status',
  }
  return map[n] || null
}

function topicRollup(isPrepared: boolean, isActive: boolean): RegistryRollupState {
  if (isActive) return 'ACTIVE'
  if (isPrepared) return 'PREPARED'
  return 'NOT_PREPARED'
}

function mirrorTopicRollup(row: UnsRegistryTopicRow | null): RegistryRollupState | null {
  if (!row) return null
  const prep = row.isPrepared ?? Boolean((row.payloadJson as { isPrepared?: boolean })?.isPrepared)
  const act = row.isActive ?? Boolean((row.payloadJson as { isActive?: boolean })?.isActive)
  return topicRollup(prep, act)
}

const sortedSignals = computed(() => {
  const list = capabilities.value?.signals ?? []
  return [...list].sort((a, b) => {
    const la = (a.label || a.signalCode).toLowerCase()
    const lb = (b.label || b.signalCode).toLowerCase()
    return la.localeCompare(lb, undefined, { sensitivity: 'base' })
  })
})

const selectedSignal = computed<RideSignalCapabilitySignalRow | null>(() => {
  if (!signalCatalogId.value || !capabilities.value) return null
  return capabilities.value.signals.find((s) => s.signalCatalogId === signalCatalogId.value) ?? null
})

const deprecationRow = computed<RegistrySignalDeprecationListRow | null>(() => {
  const id = signalCatalogId.value
  if (!id || !deprecations.value) return null
  return deprecations.value.signals.find((row) => row.signalCatalogId === id) ?? null
})

const opsKpiKey = computed(() => {
  const c = selectedSignal.value?.signalCode
  return c ? kpiKeyForSignalCode(c) : null
})

const opsBreakdownForSignal = computed(() => {
  const ride = operationFactRide.value
  const key = opsKpiKey.value
  if (!ride || !key) return null
  return ride.sourceBreakdown[key] ?? null
})

const opsFactValue = computed(() => {
  const ride = operationFactRide.value
  const key = opsKpiKey.value
  if (!ride || !key) return null
  const v = (ride as Record<string, unknown>)[key]
  return v === undefined ? null : v
})

const summaryOpsSource = computed(() => {
  const b = opsBreakdownForSignal.value
  if (b?.source) return String(b.source)
  if (selectedSignal.value && !opsKpiKey.value) return 'UNMAPPED'
  return 'MISSING'
})

function capabilityGuardBadgeClass(decision: string | null | undefined): string {
  const d = String(decision || '').toUpperCase()
  if (d === 'BLOCK') return 'bg-rose-950/90 text-rose-100 ring-1 ring-rose-700/50'
  if (d === 'WARN') return 'bg-amber-950/90 text-amber-100 ring-1 ring-amber-700/50'
  if (d === 'ALLOW') return 'bg-emerald-950/90 text-emerald-100 ring-1 ring-emerald-700/50'
  if (d === 'SKIP') return 'bg-slate-800/90 text-slate-300 ring-1 ring-slate-600/40'
  return 'bg-slate-800/90 text-slate-400 ring-1 ring-slate-600/40'
}

function sourceBadgeClass(src: string): string {
  const s = String(src || 'UNKNOWN').toUpperCase()
  const map: Record<string, string> = {
    REGISTRY: 'bg-emerald-950/90 text-emerald-100 ring-1 ring-emerald-700/50',
    LEGACY_UNS: 'bg-amber-950/90 text-amber-100 ring-1 ring-amber-700/50',
    CANONICAL: 'bg-sky-950/90 text-sky-100 ring-1 ring-sky-700/50',
    OBSERVATION: 'bg-slate-700/90 text-slate-100 ring-1 ring-slate-600/50',
    MISSING: 'bg-rose-950/90 text-rose-100 ring-1 ring-rose-700/50',
    UNKNOWN: 'bg-violet-950/90 text-violet-100 ring-1 ring-violet-700/50',
    CONFLICT: 'bg-orange-950/90 text-orange-100 ring-1 ring-orange-700/50',
    UNMAPPED: 'bg-slate-800/90 text-slate-300 ring-1 ring-slate-600/40',
    CAPABILITY_GUARD_BLOCK: 'bg-rose-950/90 text-rose-100 ring-1 ring-rose-700/50',
  }
  return map[s] || map.UNKNOWN
}

function topicParentPrefix(topicPath: string | null | undefined): string {
  const tpath = (topicPath || '').trim()
  if (!tpath) return ''
  const parts = tpath.split('/').filter(Boolean)
  if (parts.length <= 1) return tpath
  return parts.slice(0, -1).join('/')
}

function formatLiveValue(e: UnsMqttLiveEvent): string {
  if (e.valueDisplay) return e.valueDisplay
  const v = e.value
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function pickLatestLiveEvent(
  signal: RideSignalCapabilitySignalRow,
  events: UnsMqttLiveEvent[]
): UnsMqttLiveEvent | null {
  const preview = signal.unsTopicPreview?.trim()
  const code = signal.signalCode.trim()
  const spark = signal.sparkplugMetricPreview?.trim()
  const sparkTail = spark ? spark.split('/').pop() || spark : ''

  const candidates = events.filter((e) => {
    if (preview && e.canonicalUnsTopic && e.canonicalUnsTopic === preview) return true
    const m = (e.metric || '').trim()
    if (code && m && m.toLowerCase() === code.toLowerCase()) return true
    if (sparkTail && e.sparkplugTopic && e.sparkplugTopic.toLowerCase().includes(sparkTail.toLowerCase())) return true
    return false
  })
  if (!candidates.length) return null
  candidates.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
  return candidates[0]
}

function spyMatchesSignal(ev: UnsDiscoveryEventRow, signalCode: string): boolean {
  const code = signalCode.trim().toLowerCase()
  const p = (ev.topicPath || '').toLowerCase()
  if (!code) return false
  return p.endsWith(`/${code}`) || p.includes(`/${code}/`) || p.endsWith(code)
}

function inboundMatchesSignal(row: MqttInboundRow, signalCode: string): boolean {
  const code = signalCode.trim().toLowerCase()
  const topic = (row.topic || '').toLowerCase()
  if (!code) return false
  return topic.includes(code)
}

function failingHealthDetails(h: RegistrySignalDeprecationHealth): string[] {
  return (h.checks ?? []).filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
}

async function findMirrorTopicForSignal(
  parkId: string,
  catalogId: string,
  signalCode: string
): Promise<UnsRegistryTopicRow | null> {
  let offset = 0
  const limit = 200
  const maxScan = 6000
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

async function loadRideAssets() {
  rideAssets.value = []
  const pid = parkCtx.activeParkId
  if (!pid) return
  try {
    const rows = await getPlatformAssets({ parkId: pid, assetTypeCode: 'RIDE', limit: 500 })
    rideAssets.value = [...rows].sort((a, b) =>
      assetLabel(a).localeCompare(assetLabel(b), undefined, { sensitivity: 'base' })
    )
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSignalView.ridesLoadFailed'), 'error')
  }
}

async function loadRideBundle() {
  const id = rideId.value.trim()
  capabilities.value = null
  deprecations.value = null
  deprecationsLoadFailed.value = false
  signalCatalogId.value = ''
  mirrorTopic.value = null
  mqttInboundRows.value = []
  mqttUnknownRows.value = []
  spyEventRows.value = []
  liveEvent.value = null
  operationFactRide.value = null
  operationFactsParkDoc.value = null
  operationFactsError.value = null
  phase11AltHealth.value = null
  if (!id) return

  busyRide.value = true
  loadError.value = null
  try {
    const [caps, deps] = await Promise.all([
      getRideSignalCapabilities(id),
      getRegistrySignalDeprecations(id).catch(() => {
        deprecationsLoadFailed.value = true
        return null
      }),
    ])
    capabilities.value = caps
    deprecations.value = deps
    if (caps.signals.length) {
      signalCatalogId.value = caps.signals[0].signalCatalogId
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : t('unsSignalView.capabilitiesLoadFailed')
    loadError.value = msg
    push(msg, 'error')
  } finally {
    busyRide.value = false
  }
}

async function loadOperationsFactsBlock() {
  operationFactRide.value = null
  operationFactsParkDoc.value = null
  operationFactsError.value = null
  const assetId = rideId.value.trim()
  const parkId = parkCtx.activeParkId
  if (!assetId || !parkId) return

  try {
    const [regFirst, parkScoped] = await Promise.all([
      getOperationsFactsRide(assetId).catch((e) => {
        operationFactsError.value = e instanceof Error ? e.message : t('unsSignalView.opsFactsLoadFailed')
        return null
      }),
      getOperationsFactsRideParkScoped({ parkId, rideAssetId: assetId }).catch(() => null),
    ])
    if (regFirst) operationFactRide.value = regFirst
    if (parkScoped) operationFactsParkDoc.value = parkScoped
  } catch (e) {
    operationFactsError.value = e instanceof Error ? e.message : t('unsSignalView.opsFactsLoadFailed')
  }
}

async function loadPhase11Alternates(assetId: string, signalKey: string) {
  phase11AltHealth.value = await tryGetRideSignalDeprecationHealthBySignalKey(assetId, signalKey)
}

async function loadSignalDiagnostics() {
  const sig = selectedSignal.value
  const caps = capabilities.value
  mirrorTopic.value = null
  mqttInboundRows.value = []
  mqttUnknownRows.value = []
  spyEventRows.value = []
  liveEvent.value = null
  if (!sig || !caps?.parkId) return

  busySignal.value = true
  try {
    const topicPath = (sig.unsTopicPreview || '').trim()
    const parentPrefix = topicParentPrefix(topicPath)
    const code = sig.signalCode.trim()

    const tasks: Promise<void>[] = []

    tasks.push(
      findMirrorTopicForSignal(caps.parkId, sig.signalCatalogId, sig.signalCode).then((row) => {
        mirrorTopic.value = row
      })
    )

    if (topicPath) {
      tasks.push(
        getMqttInbound({
          topicPrefix: topicPath,
          limit: 12,
          offset: 0,
          capabilityDecision: mqttInboundCapFilter.value || undefined,
        }).then((page) => {
          const rows = page.items.filter((r) => inboundMatchesSignal(r, code))
          mqttInboundRows.value = rows.slice(0, 8)
        })
      )
    }

    const spyPrefix = parentPrefix || topicPath
    if (spyPrefix) {
      tasks.push(
        getUnsSpyEvents({ topicPrefix: spyPrefix, limit: 40, offset: 0 }).then((page) => {
          spyEventRows.value = page.items.filter((ev) => spyMatchesSignal(ev, code)).slice(0, 8)
        })
      )
      tasks.push(
        getMqttInboundUnknown({ topicPrefix: spyPrefix, limit: 15, offset: 0 }).then((page) => {
          mqttUnknownRows.value = page.items.filter((ev) => spyMatchesSignal(ev, code)).slice(0, 6)
        })
      )
    }

    const gid = mqttLiveGroupId.value
    if (gid) {
      tasks.push(
        getUnsMqttLiveEvents(gid, { limit: 1500 }).then((events) => {
          liveEvent.value = pickLatestLiveEvent(sig, events)
        })
      )
    }

    tasks.push(loadOperationsFactsBlock())
    tasks.push(loadPhase11Alternates(caps.rideAssetId, sig.signalCode))

    await Promise.all(tasks)
  } catch (e) {
    push(e instanceof Error ? e.message : t('unsSignalView.signalDiagnosticsFailed'), 'warning')
  } finally {
    busySignal.value = false
  }
}

async function refreshAll() {
  busyRefresh.value = true
  try {
    await Promise.all([resolveMqttGroupId(), loadRideAssets(), loadCapabilityGuardStatus()])
    await loadRideBundle()
    if (selectedSignal.value && capabilities.value?.parkId) {
      await loadSignalDiagnostics()
    }
  } finally {
    busyRefresh.value = false
  }
}

function yesNo(v: boolean): string {
  return v ? t('unsSignalView.yes') : t('unsSignalView.no')
}

function capabilityEnabled(sig: RideSignalCapabilitySignalRow): boolean {
  return Boolean(sig.capabilityId) && sig.signalSource !== 'NOT_AVAILABLE'
}

function topicPathDisplay(sig: RideSignalCapabilitySignalRow): string {
  return mirrorTopic.value?.topicPath || sig.unsTopicPreview || '—'
}

function mirrorActivatedAtRaw(row: UnsRegistryTopicRow | null): string | null {
  if (!row) return null
  if (row.activatedAt) return String(row.activatedAt)
  const pj = row.payloadJson as { activatedAt?: unknown }
  const a = pj?.activatedAt
  return a != null && String(a).trim() !== '' ? String(a) : null
}

function formatMirrorActivatedAt(row: UnsRegistryTopicRow | null): string {
  const raw = mirrorActivatedAtRaw(row)
  return raw ? formatDateTime(raw) : '—'
}

function payloadPreviewFromSpy(ev: UnsDiscoveryEventRow): string {
  const nested = ev.mqttInboundMessage?.payloadPreview
  if (typeof nested === 'string' && nested.trim()) return nested
  try {
    return JSON.stringify(ev.details ?? {}).slice(0, 280)
  } catch {
    return '—'
  }
}

const parkHint = computed(() => {
  const p = parkCtx.activePark
  if (!parkCtx.activeParkId) return t('unsSignalView.parkContextMissing')
  return t('unsSignalView.parkContextActive', { name: p?.name ?? parkCtx.activeParkId })
})

onMounted(async () => {
  await Promise.all([resolveMqttGroupId(), loadRideAssets(), loadCapabilityGuardStatus()])
})

watch(
  () => parkCtx.activeParkId,
  () => {
    rideId.value = ''
    void loadRideAssets()
  }
)

watch(rideId, () => {
  void loadRideBundle()
})

watch(selectedSignal, (sig) => {
  if (sig && capabilities.value?.parkId) void loadSignalDiagnostics()
})

watch(mqttInboundCapFilter, () => {
  if (selectedSignal.value && capabilities.value?.parkId) void loadSignalDiagnostics()
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <header class="space-y-1">
      <h1 class="font-display text-xl font-semibold text-white">{{ t('unsSignalView.title') }}</h1>
      <p class="max-w-3xl text-sm text-slate-400">{{ t('unsSignalView.subtitle') }}</p>
    </header>

    <section class="flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div class="min-w-[12rem] flex-1 text-xs text-slate-400">
        <p class="font-medium text-slate-300">{{ t('unsSignalView.filterPark') }}</p>
        <p class="mt-1 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200">
          {{ parkHint }}
        </p>
      </div>
      <label class="block min-w-[14rem] flex-1 text-xs font-medium text-slate-400">
        {{ t('unsSignalView.selectRide') }}
        <select
          v-model="rideId"
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          :disabled="!parkCtx.activeParkId"
        >
          <option value="">{{ t('unsSignalView.ridePlaceholder') }}</option>
          <option v-for="r in rideAssets" :key="assetIdOf(r)" :value="assetIdOf(r)">{{ assetLabel(r) }}</option>
        </select>
      </label>
      <label class="block min-w-[16rem] flex-1 text-xs font-medium text-slate-400">
        {{ t('unsSignalView.selectSignal') }}
        <select
          v-model="signalCatalogId"
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          :disabled="!sortedSignals.length || busyRide"
        >
          <option v-for="s in sortedSignals" :key="s.signalCatalogId" :value="s.signalCatalogId">
            {{ s.label || s.signalCode }} ({{ s.signalCode }})
          </option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        :disabled="busyRefresh || busyRide"
        @click="refreshAll"
      >
        {{ t('unsSignalView.refresh') }}
      </button>
      <p v-if="busyRide" class="text-xs text-slate-500">{{ t('unsSignalView.loadingRide') }}</p>
    </section>

    <p v-if="loadError" class="rounded-lg border border-rose-800/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {{ loadError }}
    </p>

    <template v-if="selectedSignal && capabilities">
      <!-- Summary cards -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('unsSignalView.cardCapabilitySource') }}
          </p>
          <p class="mt-2">
            <span class="inline-flex rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-100 ring-1 ring-slate-600/40">
              {{ selectedSignal.signalSource }}
            </span>
          </p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('unsSignalView.cardRegistryTopic') }}
          </p>
          <p class="mt-2 font-mono text-sm text-white">
            {{ topicRollup(selectedSignal.isPreparedTopic, selectedSignal.isActiveTopic) }}
          </p>
          <p v-if="mirrorTopicRollup(mirrorTopic)" class="mt-1 text-[10px] text-slate-500">
            {{ t('unsSignalView.cardMirrorHint', { state: mirrorTopicRollup(mirrorTopic) }) }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('unsSignalView.cardSparkplug') }}
          </p>
          <p class="mt-2 font-mono text-sm text-white">
            {{ topicRollup(selectedSignal.isPreparedSparkplug, selectedSignal.isActiveSparkplug) }}
          </p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('unsSignalView.cardOpsFactsSource') }}
          </p>
          <p class="mt-2">
            <span class="inline-flex rounded-md px-2 py-0.5 font-mono text-xs" :class="sourceBadgeClass(summaryOpsSource)">
              {{ summaryOpsSource }}
            </span>
          </p>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {{ t('unsSignalView.cardDeprecationHealth') }}
          </p>
          <p v-if="deprecationRow" class="mt-2">
            <span
              class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium"
              :class="
                deprecationRow.health.ok ? 'bg-emerald-950/80 text-emerald-200' : 'bg-rose-950/80 text-rose-200'
              "
            >
              {{ deprecationRow.health.ok ? t('unsSignalView.healthPass') : t('unsSignalView.healthFail') }}
            </span>
          </p>
          <p v-else-if="deprecationsLoadFailed" class="mt-2 text-xs text-slate-500">
            {{ t('unsSignalView.deprecationNeutralUnavailable') }}
          </p>
          <p v-else class="mt-2 text-xs text-slate-500">{{ t('unsSignalView.deprecationNoRowShort') }}</p>
        </div>
      </div>

      <p v-if="busySignal" class="text-xs text-slate-500">{{ t('unsSignalView.loadingSignal') }}</p>

      <!-- Panel A — Capability -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-violet-400/90">
          {{ t('unsSignalView.panelCapability') }}
        </h2>
        <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldSignalKey') }}</dt>
            <dd class="mt-0.5 font-mono text-slate-100">{{ selectedSignal.signalCode }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldLabel') }}</dt>
            <dd class="mt-0.5 text-slate-100">{{ selectedSignal.label || '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldUnit') }}</dt>
            <dd class="mt-0.5 text-slate-200">{{ selectedSignal.unit || '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldValueType') }}</dt>
            <dd class="mt-0.5 font-mono text-slate-200">{{ selectedSignal.valueType }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldSignalSource') }}</dt>
            <dd class="mt-0.5">
              <span class="inline-flex rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-100 ring-1 ring-slate-600/40">
                {{ selectedSignal.signalSource }}
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldEnabled') }}</dt>
            <dd class="mt-0.5 text-slate-200">
              {{ capabilityEnabled(selectedSignal) ? t('unsSignalView.enabledYes') : t('unsSignalView.enabledNo') }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Panel B — Registry -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
          {{ t('unsSignalView.panelRegistry') }}
        </h2>
        <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div class="sm:col-span-2">
            <dt class="text-slate-500">{{ t('unsSignalView.fieldUnsTopicPath') }}</dt>
            <dd class="mt-0.5 break-all font-mono text-xs text-brand-100">{{ topicPathDisplay(selectedSignal) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldRegistrySource') }}</dt>
            <dd class="mt-0.5 text-slate-200">{{ mirrorTopic?.registrySource ?? selectedSignal.registrySource ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldRollupStatus') }}</dt>
            <dd class="mt-0.5 font-mono text-slate-100">
              {{ topicRollup(selectedSignal.isPreparedTopic, selectedSignal.isActiveTopic) }}
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldIsPrepared') }}</dt>
            <dd class="mt-0.5">{{ yesNo(selectedSignal.isPreparedTopic) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldIsActive') }}</dt>
            <dd class="mt-0.5">{{ yesNo(selectedSignal.isActiveTopic) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldActivatedAt') }}</dt>
            <dd class="mt-0.5 text-slate-300">
              {{ formatMirrorActivatedAt(mirrorTopic) }}
            </dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldRegistryTopicId') }}</dt>
            <dd class="mt-0.5 break-all font-mono text-[11px] text-slate-400">
              {{ mirrorTopic?.id ?? selectedSignal.topicRowId ?? '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Panel C — Sparkplug -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-amber-400/90">
          {{ t('unsSignalView.panelSparkplug') }}
        </h2>
        <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldGroupId') }}</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-200">{{ liveEvent?.groupId ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldEdgeNodeId') }}</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-200">{{ liveEvent?.edgeNodeId ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldDeviceId') }}</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-200">{{ liveEvent?.deviceId ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldMetricName') }}</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-200">{{ liveEvent?.metric ?? selectedSignal.signalCode }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldIsPrepared') }}</dt>
            <dd class="mt-0.5">{{ yesNo(selectedSignal.isPreparedSparkplug) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.fieldIsActive') }}</dt>
            <dd class="mt-0.5">{{ yesNo(selectedSignal.isActiveSparkplug) }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-slate-500">{{ t('unsSignalView.fieldSparkplugPreview') }}</dt>
            <dd class="mt-0.5 break-all font-mono text-[11px] text-slate-500">
              {{ selectedSignal.sparkplugMetricPreview || liveEvent?.sparkplugTopic || '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Panel D — MQTT / Spy -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-cyan-400/90">
          {{ t('unsSignalView.panelMqttSpy') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('unsSignalView.panelMqttSpyHint') }}</p>

        <div
          v-if="capabilityGuardStatus?.mode === 'warn_only'"
          class="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100/90"
        >
          {{ t('unsSignalView.capabilityGuardWarnOnlyHint') }}
        </div>

        <div
          v-if="capabilityGuardStatus"
          class="mt-4 grid gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <p class="text-slate-500">{{ t('unsSignalView.capabilityGuardMode') }}</p>
            <p class="mt-0.5 font-mono text-slate-100">{{ capabilityGuardStatus.mode }}</p>
          </div>
          <div>
            <p class="text-slate-500">{{ t('unsSignalView.capabilityGuardWarn24h') }}</p>
            <p class="mt-0.5 font-mono text-slate-100">{{ capabilityGuardStatus.warnedLast24h }}</p>
          </div>
          <div>
            <p class="text-slate-500">{{ t('unsSignalView.capabilityGuardBlock24h') }}</p>
            <p class="mt-0.5 font-mono text-slate-100">{{ capabilityGuardStatus.blockedLast24h }}</p>
          </div>
          <div>
            <p class="text-slate-500">{{ t('unsSignalView.capabilityGuardAllow24h') }}</p>
            <p class="mt-0.5 font-mono text-slate-100">{{ capabilityGuardStatus.allowedLast24h }}</p>
          </div>
        </div>

        <div class="mt-4 space-y-6">
          <div>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {{ t('unsSignalView.mqttInboundTitle') }}
              </h3>
              <label class="flex items-center gap-2 text-[10px] text-slate-500">
                <span>{{ t('unsSignalView.capabilityGuardFilter') }}</span>
                <select
                  v-model="mqttInboundCapFilter"
                  class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                >
                  <option value="">{{ t('unsSignalView.capabilityGuardFilterAll') }}</option>
                  <option value="ALLOW">ALLOW</option>
                  <option value="WARN">WARN</option>
                  <option value="BLOCK">BLOCK</option>
                  <option value="SKIP">SKIP</option>
                </select>
              </label>
            </div>
            <div v-if="!mqttInboundRows.length" class="mt-2 text-sm text-slate-500">{{ t('unsSignalView.emptyMqttInbound') }}</div>
            <div v-else class="mt-2 overflow-x-auto">
              <table class="min-w-full text-left text-xs">
                <thead class="text-slate-500">
                  <tr>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colTopic') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colClassification') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colCapabilityGuard') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colPayloadPreview') }}</th>
                    <th class="py-1.5">{{ t('unsSignalView.colCreatedAt') }}</th>
                  </tr>
                </thead>
                <tbody class="text-slate-200">
                  <tr v-for="row in mqttInboundRows" :key="row.id" class="border-t border-slate-800/80">
                    <td class="py-2 pr-3 font-mono text-[10px] text-brand-100">{{ row.topic }}</td>
                    <td class="py-2 pr-3">
                      <span
                        v-if="row.spyClassification"
                        class="rounded px-1.5 py-0.5 font-mono text-[10px]"
                        :class="
                          sourceBadgeClass(
                            row.spyClassification === 'CONFLICT'
                              ? 'CONFLICT'
                              : row.spyClassification === 'UNKNOWN_TOPIC' || row.spyClassification === 'UNKNOWN_SIGNAL'
                                ? 'MISSING'
                                : 'UNKNOWN'
                          )
                        "
                      >
                        {{ row.spyClassification }}
                      </span>
                      <span v-else class="text-slate-500">—</span>
                    </td>
                    <td class="py-2 pr-3">
                      <span
                        v-if="row.capabilityGuardDecision"
                        class="rounded px-1.5 py-0.5 font-mono text-[10px]"
                        :class="capabilityGuardBadgeClass(row.capabilityGuardDecision)"
                      >
                        {{ row.capabilityGuardDecision }}
                      </span>
                      <span v-else class="text-slate-500">—</span>
                    </td>
                    <td class="max-w-[14rem] truncate py-2 pr-3 text-[10px] text-slate-400">
                      {{ row.payloadPreview || '—' }}
                    </td>
                    <td class="py-2 whitespace-nowrap text-[10px] text-slate-500">{{ formatDateTime(row.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {{ t('unsSignalView.spyEventsTitle') }}
            </h3>
            <div v-if="!spyEventRows.length" class="mt-2 text-sm text-slate-500">{{ t('unsSignalView.emptySpyEvents') }}</div>
            <div v-else class="mt-2 overflow-x-auto">
              <table class="min-w-full text-left text-xs">
                <thead class="text-slate-500">
                  <tr>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colTopic') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colClassification') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colPayloadPreview') }}</th>
                    <th class="py-1.5">{{ t('unsSignalView.colCreatedAt') }}</th>
                  </tr>
                </thead>
                <tbody class="text-slate-200">
                  <tr v-for="ev in spyEventRows" :key="ev.id" class="border-t border-slate-800/80">
                    <td class="py-2 pr-3 font-mono text-[10px] text-brand-100">{{ ev.topicPath }}</td>
                    <td class="py-2 pr-3">
                      <span class="rounded px-1.5 py-0.5 font-mono text-[10px]" :class="sourceBadgeClass(ev.classification)">
                        {{ ev.classification }}
                      </span>
                    </td>
                    <td class="max-w-[14rem] truncate py-2 pr-3 text-[10px] text-slate-400">
                      {{ payloadPreviewFromSpy(ev) }}
                    </td>
                    <td class="py-2 whitespace-nowrap text-[10px] text-slate-500">{{ formatDateTime(ev.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {{ t('unsSignalView.mqttUnknownTitle') }}
            </h3>
            <div v-if="!mqttUnknownRows.length" class="mt-2 text-sm text-slate-500">{{ t('unsSignalView.emptyMqttUnknown') }}</div>
            <div v-else class="mt-2 overflow-x-auto">
              <table class="min-w-full text-left text-xs">
                <thead class="text-slate-500">
                  <tr>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colTopic') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colClassification') }}</th>
                    <th class="py-1.5 pr-3">{{ t('unsSignalView.colPayloadPreview') }}</th>
                    <th class="py-1.5">{{ t('unsSignalView.colCreatedAt') }}</th>
                  </tr>
                </thead>
                <tbody class="text-slate-200">
                  <tr v-for="ev in mqttUnknownRows" :key="ev.id" class="border-t border-slate-800/80">
                    <td class="py-2 pr-3 font-mono text-[10px] text-brand-100">{{ ev.topicPath }}</td>
                    <td class="py-2 pr-3">
                      <span class="rounded px-1.5 py-0.5 font-mono text-[10px]" :class="sourceBadgeClass(ev.classification)">
                        {{ ev.classification }}
                      </span>
                    </td>
                    <td class="max-w-[14rem] truncate py-2 pr-3 text-[10px] text-slate-400">
                      {{ payloadPreviewFromSpy(ev) }}
                    </td>
                    <td class="py-2 whitespace-nowrap text-[10px] text-slate-500">{{ formatDateTime(ev.createdAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- Panel E — Operations Facts -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-sky-400/90">
          {{ t('unsSignalView.panelOpsFacts') }}
        </h2>
        <p v-if="operationFactsError" class="mt-2 text-sm text-amber-200/90">{{ operationFactsError }}</p>
        <template v-else-if="operationFactRide">
          <p v-if="!opsKpiKey" class="mt-2 text-sm text-slate-500">{{ t('unsSignalView.opsFactsUnmapped') }}</p>
          <dl v-else class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.opsFactsKpiField') }}</dt>
              <dd class="mt-0.5 font-mono text-slate-100">{{ opsKpiKey }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.opsFactsValue') }}</dt>
              <dd class="mt-0.5 text-slate-100">
                {{
                  opsFactValue !== null && opsFactValue !== undefined
                    ? typeof opsFactValue === 'object'
                      ? JSON.stringify(opsFactValue)
                      : String(opsFactValue)
                    : '—'
                }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.opsFactsSource') }}</dt>
              <dd class="mt-0.5">
                <span
                  v-if="opsBreakdownForSignal"
                  class="inline-flex rounded-md px-2 py-0.5 font-mono text-xs"
                  :class="sourceBadgeClass(opsBreakdownForSignal.source)"
                >
                  {{ opsBreakdownForSignal.source }}
                </span>
                <span v-else class="text-slate-500">—</span>
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.opsFactsConfidence') }}</dt>
              <dd class="mt-0.5 text-slate-200">{{ opsBreakdownForSignal?.confidence ?? '—' }}</dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-slate-500">{{ t('unsSignalView.opsFactsReason') }}</dt>
              <dd class="mt-0.5 break-words font-mono text-[11px] text-slate-400">
                {{ opsBreakdownForSignal?.reason ?? '—' }}
              </dd>
            </div>
          </dl>
          <div v-if="operationFactRide.warnings?.length" class="mt-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-amber-400/90">
              {{ t('unsSignalView.opsFactsWarnings') }}
            </p>
            <ul class="mt-2 list-inside list-disc space-y-1 text-xs text-amber-100/90">
              <li v-for="(w, i) in operationFactRide.warnings" :key="i">{{ w }}</li>
            </ul>
          </div>
        </template>
        <p v-else class="mt-2 text-sm text-slate-500">{{ t('unsSignalView.opsFactsEmpty') }}</p>

        <div
          v-if="operationFactsParkDoc && Object.keys(operationFactsParkDoc.facts || {}).length > 0"
          class="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
        >
          <p class="text-[11px] font-medium text-slate-400">{{ t('unsSignalView.opsFactsParkScopedPayload') }}</p>
          <pre class="mt-2 max-h-40 overflow-auto font-mono text-[10px] text-slate-500">{{
            JSON.stringify(operationFactsParkDoc.facts, null, 2)
          }}</pre>
        </div>
      </section>

      <!-- Panel F — Phase 11 -->
      <section class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-rose-400/90">
          {{ t('unsSignalView.panelDeprecation') }}
        </h2>
        <p class="mt-1 text-[11px] text-slate-500">{{ t('unsSignalView.deprecationPhaseNote') }}</p>

        <div v-if="phase11AltHealth" class="mt-3 rounded-lg border border-violet-900/50 bg-violet-950/20 p-3">
          <p class="text-[11px] font-semibold text-violet-200">{{ t('unsSignalView.phase11AltHealthTitle') }}</p>
          <p class="mt-1 text-xs text-slate-300">
            {{ phase11AltHealth.ok ? t('unsSignalView.healthPass') : t('unsSignalView.healthFail') }}
          </p>
          <ul v-if="!phase11AltHealth.ok" class="mt-2 list-inside list-disc text-xs text-rose-200/90">
            <li v-for="(line, idx) in failingHealthDetails(phase11AltHealth)" :key="idx">{{ line }}</li>
          </ul>
        </div>

        <div v-if="deprecationRow">
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.depRegistryAuthoritative') }}</dt>
              <dd class="mt-0.5 font-medium text-slate-100">
                {{ deprecationRow.deprecation ? yesNo(deprecationRow.deprecation.registryAuthoritative) : t('unsSignalView.notConfigured') }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.depLegacyFallbackDisabled') }}</dt>
              <dd class="mt-0.5 font-medium text-slate-100">
                {{ deprecationRow.deprecation ? yesNo(deprecationRow.deprecation.legacyFallbackDisabled) : t('unsSignalView.notConfigured') }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.depLegacyPublishDisabled') }}</dt>
              <dd class="mt-0.5 font-medium text-slate-100">
                {{ deprecationRow.deprecation ? yesNo(deprecationRow.deprecation.legacyPublishDisabled) : t('unsSignalView.notConfigured') }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">{{ t('unsSignalView.depHealth') }}</dt>
              <dd class="mt-0.5">
                <span
                  class="rounded px-2 py-0.5 text-xs font-medium"
                  :class="
                    deprecationRow.health.ok ? 'bg-emerald-950/80 text-emerald-200' : 'bg-rose-950/80 text-rose-200'
                  "
                >
                  {{ deprecationRow.health.ok ? t('unsSignalView.healthPass') : t('unsSignalView.healthFail') }}
                </span>
              </dd>
            </div>
          </dl>
          <ul
            v-if="!deprecationRow.health.ok"
            class="mt-3 list-inside list-disc space-y-1 text-xs text-rose-200/90"
          >
            <li v-for="(line, idx) in failingHealthDetails(deprecationRow.health)" :key="idx">{{ line }}</li>
          </ul>
        </div>

        <p
          v-if="!deprecationRow && !phase11AltHealth && deprecationsLoadFailed"
          class="mt-3 text-sm text-slate-400"
        >
          {{ t('unsSignalView.deprecationNeutralUnavailable') }}
        </p>
        <p
          v-else-if="!deprecationRow && !phase11AltHealth && deprecations"
          class="mt-3 text-sm text-slate-500"
        >
          {{ t('unsSignalView.deprecationNoRow') }}
        </p>
      </section>

      <!-- Live value (optional quick context) -->
      <section v-if="liveEvent" class="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-amber-400/90">
          {{ t('unsSignalView.liveSliceTitle') }}
        </h2>
        <dl class="mt-3 flex flex-wrap gap-6 text-sm">
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.liveLatest') }}</dt>
            <dd class="font-mono text-lg text-white">{{ formatLiveValue(liveEvent) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">{{ t('unsSignalView.liveSource') }}</dt>
            <dd class="text-slate-200">{{ liveEvent.source }}</dd>
          </div>
          <div class="min-w-[12rem]">
            <dt class="text-slate-500">{{ t('unsSignalView.liveReceivedAt') }}</dt>
            <dd class="text-xs text-slate-500">{{ formatDateTime(liveEvent.receivedAt) }}</dd>
          </div>
        </dl>
      </section>
    </template>

    <p v-else-if="rideId && !busyRide && capabilities && !sortedSignals.length" class="text-sm text-slate-500">
      {{ t('unsSignalView.noSignals') }}
    </p>
    <p v-else-if="!rideId" class="text-sm text-slate-500">{{ t('unsSignalView.pickRide') }}</p>
  </div>
</template>
