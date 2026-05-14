<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, withDefaults } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  getRideSignalCapabilities,
  putRideSignalCapabilities,
  postPrepareRideUnsTopics,
  postPrepareRideSparkplugMetrics,
  getSparkplugTopicPreviewForAsset,
  getUnsLatestState,
  getUnsMqttLiveEvents,
  type RideSignalCapabilitiesPayload,
  type RideSignalCapabilitySignalRow,
  type RideSignalSource,
  type SparkplugTopicPreviewPayload,
  type UnsLatestState,
  type UnsMqttLiveEvent,
} from '@/api/client'
import * as signalAvailabilityResolverNs from '@smartpark-root-utils/signal-availability-resolver.js'
import type { SignalAvailabilityKind } from '@smartpark-root-utils/signal-availability-resolver.js'
import { collectMatchingLiveEvents } from '@/composables/unsGovernanceHelpers'
import { useToast } from '@/composables/useToast'
import { parseTpunsTopic } from '@/lib/unsTopicsEntityModel'
import { slugifyName } from '@/lib/sparkplugTopicBuild'
import { setApiParkContextId } from '@/utils/apiParkContext'
import type { RideSignalCapsPanelExpose } from './rideSignalCapabilitiesPanel.types'

/** CJS `module.exports` — use namespace so Rollup/Vite can attach synthetic named exports. */
const {
  computeReadiness,
  DEFAULT_FRESHNESS_MS,
  DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES,
  expectsRealtimeUns,
  resolveSignalAvailability,
} = signalAvailabilityResolverNs
const props = withDefaults(defineProps<{ rideAssetId: string; assetSlug?: string }>(), {
  assetSlug: '',
})

/** Stable map key for draft state — avoids UUID casing mismatches between UI and save payload. */
function catalogKey(signalCatalogId: string): string {
  return String(signalCatalogId || '').trim().toLowerCase()
}

const { t } = useI18n()
const { push } = useToast()

const busy = ref(false)
const payload = ref<RideSignalCapabilitiesPayload | null>(null)
const draft = ref<Record<string, RideSignalSource>>({})
const draftValueType = ref<Record<string, string>>({})
const draftUseForMl = ref<Record<string, boolean>>({})
const draftUseForForecast = ref<Record<string, boolean>>({})

/** Resolver preview: same DDATA topic base for all signals on this ride (Sparkplug path). */
const sparkplugRidePreview = ref<SparkplugTopicPreviewPayload | null>(null)
const sparkplugRidePreviewErr = ref<string | null>(null)

/** Right drawer: MQTT live buffer rows matched to the clicked signal. */
const telemetrySignal = ref<RideSignalCapabilitySignalRow | null>(null)
/** Shared MQTT live buffer for availability column + telemetry drawer. */
const mqttLiveBuffer = ref<UnsMqttLiveEvent[]>([])
const unsLatestStates = ref<UnsLatestState[]>([])
const realtimeLoading = ref(false)
const mqttLiveLoading = ref(false)
const mqttLiveErr = ref<string | null>(null)
let mqttLivePollTimer: ReturnType<typeof setInterval> | null = null
let realtimePollTimer: ReturnType<typeof setInterval> | null = null

const FRESHNESS_MS = DEFAULT_FRESHNESS_MS

const availabilityFilter = ref<
  'all' | 'live' | 'stale' | 'missing' | 'not_expected' | 'ml' | 'forecast'
>('all')

/** Expanded detail rows (source + technical previews). */
const expandedDetail = ref<Record<string, boolean>>({})

function toggleDetailRow(catalogId: string) {
  const k = catalogKey(catalogId)
  expandedDetail.value = { ...expandedDetail.value, [k]: !expandedDetail.value[k] }
}

const resolvedAssetSlug = computed(() => {
  const s = props.assetSlug?.trim()
  if (s) return s
  const signals = payload.value?.signals
  const preview = signals?.find((x) => x.unsTopicPreview)?.unsTopicPreview
  const m = preview?.match(/\/rides\/([^/]+)\//i)
  if (m?.[1]) return m[1]
  const tp = sparkplugRidePreview.value?.topicPreview
  if (tp) {
    const parts = tp.split('/').filter(Boolean)
    if (parts.length >= 5 && String(parts[2]).toUpperCase() === 'DDATA') {
      return parts[parts.length - 1] || ''
    }
  }
  return ''
})

const perRowAvailability = computed(() => {
  const map = new Map<string, ReturnType<typeof resolveSignalAvailability>>()
  const park = payload.value
  if (!park?.signals?.length) return map
  const slug = resolvedAssetSlug.value
  const now = Date.now()
  for (const row of park.signals) {
    const k = catalogKey(row.signalCatalogId)
    const src = draft.value[k] ?? row.signalSource
    const required = DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES.has(row.signalCode.trim().toLowerCase())
    map.set(
      k,
      resolveSignalAvailability({
        nowMs: now,
        freshnessThresholdMs: FRESHNESS_MS,
        assetSlug: slug,
        signalCode: row.signalCode,
        canonicalUnsTopic: row.unsTopicPreview,
        sparkplugMetricPreview: row.sparkplugMetricPreview,
        mqttLiveEvents: mqttLiveBuffer.value,
        unsLatestStates: unsLatestStates.value,
        signalSource: src,
        required,
        enabled: true,
      })
    )
  }
  return map
})

const readiness = computed(() => {
  const park = payload.value
  if (!park?.signals?.length) return null
  const rows = park.signals.map((row) => {
    const k = catalogKey(row.signalCatalogId)
    const av = perRowAvailability.value.get(k)
    if (!av) return null
    const src = draft.value[k] ?? row.signalSource
    const persistedMl = typeof row.useForMl === 'boolean' ? row.useForMl : row.signalSource === 'ML'
    const useMl = draftUseForMl.value[k] ?? persistedMl
    const persistedFc =
      typeof row.useForForecast === 'boolean' ? row.useForForecast : persistedMl
    const useForecast = draftUseForForecast.value[k] ?? persistedFc
    const required = DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES.has(row.signalCode.trim().toLowerCase())
    return {
      kind: av.kind as SignalAvailabilityKind,
      required,
      signalSource: src,
      useForMl: useMl,
      useForForecast: useForecast,
    }
  })
  const clean = rows.filter((x): x is NonNullable<typeof x> => x != null)
  return computeReadiness(clean)
})

const summaryCounts = computed(() => {
  const park = payload.value
  let live = 0
  let stale = 0
  if (!park?.signals?.length) return { live, stale }
  for (const row of park.signals) {
    const k = catalogKey(row.signalCatalogId)
    const av = perRowAvailability.value.get(k)
    if (av?.kind === 'LIVE_AVAILABLE') live += 1
    else if (av?.kind === 'LIVE_STALE') stale += 1
  }
  return { live, stale }
})

const filterChips = computed(() => [
  { id: 'all' as const, i18n: 'filterAll' },
  { id: 'live' as const, i18n: 'filterLive' },
  { id: 'stale' as const, i18n: 'filterStale' },
  { id: 'missing' as const, i18n: 'filterMissing' },
  { id: 'not_expected' as const, i18n: 'filterNotExpected' },
  { id: 'ml' as const, i18n: 'filterMl' },
  { id: 'forecast' as const, i18n: 'filterForecast' },
])

const filteredSignals = computed(() => {
  const sigs = payload.value?.signals ?? []
  const f = availabilityFilter.value
  if (f === 'all') return sigs
  return sigs.filter((row) => {
    const k = catalogKey(row.signalCatalogId)
    const av = perRowAvailability.value.get(k)
    const persistedMl = typeof row.useForMl === 'boolean' ? row.useForMl : row.signalSource === 'ML'
    const useMl = draftUseForMl.value[k] ?? persistedMl
    const persistedFc =
      typeof row.useForForecast === 'boolean' ? row.useForForecast : persistedMl
    const useFc = draftUseForForecast.value[k] ?? persistedFc
    if (f === 'live') return av?.kind === 'LIVE_AVAILABLE'
    if (f === 'stale') return av?.kind === 'LIVE_STALE'
    if (f === 'missing') return av?.kind === 'MISSING'
    if (f === 'not_expected') return av?.kind === 'NOT_EXPECTED'
    if (f === 'ml') return useMl
    if (f === 'forecast') return useFc
    return true
  })
})

function availabilityBadge(av: ReturnType<typeof resolveSignalAvailability> | undefined): {
  emoji: string
  labelKey: string
} {
  switch (av?.kind) {
    case 'LIVE_AVAILABLE':
      return { emoji: '🟢', labelKey: 'rideSignalCaps.availLive' }
    case 'LIVE_STALE':
      return { emoji: '🟡', labelKey: 'rideSignalCaps.availStale' }
    case 'MISSING':
      return { emoji: '🔴', labelKey: 'rideSignalCaps.availMissing' }
    default:
      return { emoji: '⚪', labelKey: 'rideSignalCaps.availNotExpected' }
  }
}

function rowAvailabilityClass(av: ReturnType<typeof resolveSignalAvailability> | undefined): string {
  switch (av?.kind) {
    case 'LIVE_AVAILABLE':
      return 'border-l-4 border-emerald-600/70 bg-emerald-950/25'
    case 'LIVE_STALE':
      return 'border-l-4 border-amber-600/70 bg-amber-950/20'
    case 'MISSING':
      return av.required
        ? 'border-l-4 border-rose-600/80 bg-rose-950/25'
        : 'border-l-4 border-rose-900/50 bg-rose-950/15'
    default:
      return 'border-l-4 border-slate-700/50 bg-slate-950/40'
  }
}

function rowWarnings(row: RideSignalCapabilitySignalRow): string[] {
  const k = catalogKey(row.signalCatalogId)
  const av = perRowAvailability.value.get(k)
  const src = draft.value[k] ?? row.signalSource
  const persistedMl = typeof row.useForMl === 'boolean' ? row.useForMl : row.signalSource === 'ML'
  const useMl = draftUseForMl.value[k] ?? persistedMl
  const persistedFc =
    typeof row.useForForecast === 'boolean' ? row.useForForecast : persistedMl
  const useFc = draftUseForForecast.value[k] ?? persistedFc
  const rt = expectsRealtimeUns(src)
  const req = DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES.has(row.signalCode.trim().toLowerCase())
  const out: string[] = []
  if (useMl && av?.kind === 'MISSING' && rt) out.push(t('rideSignalCaps.warnMlMissing'))
  if (useFc && av?.kind === 'MISSING' && rt) out.push(t('rideSignalCaps.warnForecastMissing'))
  if (req && rt && av?.kind === 'MISSING') out.push(t('rideSignalCaps.warnRequiredMissing'))
  return out
}

/** Prefer wizard slug; else parse `/rides/{slug}/` from the row’s UNS preview so telemetry stays ride-scoped. */
const telemetryRideSlug = computed(() => {
  const s = resolvedAssetSlug.value.trim().toLowerCase()
  if (s) return s
  const sig = telemetrySignal.value
  if (!sig) return ''
  const m = String(sig.unsTopicPreview || '').match(/\/rides\/([^/]+)\//i)
  return m?.[1]?.trim().toLowerCase() || ''
})

const telemetryMatches = computed(() => {
  const sig = telemetrySignal.value
  if (!sig) return []
  const slug = telemetryRideSlug.value
  return collectMatchingLiveEvents(sig, mqttLiveBuffer.value, slug ? { rideAssetSlug: slug } : undefined).slice(0, 40)
})

function stopMqttLivePoll() {
  if (mqttLivePollTimer != null) {
    clearInterval(mqttLivePollTimer)
    mqttLivePollTimer = null
  }
}

function closeTelemetryPanel() {
  telemetrySignal.value = null
  stopMqttLivePoll()
}

async function loadRealtimeData() {
  const parkId = payload.value?.parkId?.trim()
  if (!parkId) return
  realtimeLoading.value = true
  try {
    setApiParkContextId(parkId)
    const [mqtt, uns] = await Promise.all([
      getUnsMqttLiveEvents(parkId, { limit: 1500 }),
      getUnsLatestState(parkId),
    ])
    mqttLiveBuffer.value = mqtt
    unsLatestStates.value = uns
  } catch (e) {
    mqttLiveBuffer.value = []
    unsLatestStates.value = []
    push(e instanceof Error ? e.message : t('rideSignalCaps.realtimeLoadFailed'), 'warning')
  } finally {
    realtimeLoading.value = false
  }
}

function stopRealtimePoll() {
  if (realtimePollTimer != null) {
    clearInterval(realtimePollTimer)
    realtimePollTimer = null
  }
}

async function fetchMqttLiveBuffer() {
  const parkId = payload.value?.parkId?.trim()
  if (!parkId) return
  mqttLiveLoading.value = true
  mqttLiveErr.value = null
  try {
    setApiParkContextId(parkId)
    mqttLiveBuffer.value = await getUnsMqttLiveEvents(parkId, { limit: 1500 })
  } catch (e) {
    mqttLiveErr.value = e instanceof Error ? e.message : 'MQTT live load failed'
    mqttLiveBuffer.value = []
  } finally {
    mqttLiveLoading.value = false
  }
}

function onSignalNameClick(row: RideSignalCapabilitySignalRow) {
  if (telemetrySignal.value?.signalCatalogId === row.signalCatalogId) {
    closeTelemetryPanel()
    return
  }
  telemetrySignal.value = row
  stopMqttLivePoll()
  void fetchMqttLiveBuffer()
  mqttLivePollTimer = setInterval(() => {
    void fetchMqttLiveBuffer()
  }, 8000)
}

function formatTelemetryValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const sources: RideSignalSource[] = [
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
]

const SOURCE_LABELS: Record<RideSignalSource, string> = {
  NOT_AVAILABLE: 'Nicht verfuegbar',
  MASTER_DATA: 'Asset-Daten',
  MANUAL: 'Manuell',
  ADAPTER: 'Adapter',
  MQTT_EDGE: 'MQTT Edge',
  SIMULATION: 'Simulation',
  ML: 'ML',
}

const SOURCE_HINTS: Record<RideSignalSource, string> = {
  NOT_AVAILABLE: 'Signal ist fuer diesen Ride nicht verfuegbar.',
  MASTER_DATA: 'Wert kommt aus Asset-Datenprofilen.',
  MANUAL: 'Wert wird manuell gepflegt.',
  ADAPTER: 'Wert kommt aus Integrations-/Adapterdaten.',
  MQTT_EDGE: 'Wert kommt live aus MQTT/Edge.',
  SIMULATION: 'Wert wird aus Simulationslogik erzeugt.',
  ML: 'Wert wird von einem ML-Modell geliefert.',
}

function sourceLabel(src: RideSignalSource): string {
  return SOURCE_LABELS[src]
}

function sourceHint(src: RideSignalSource): string {
  return SOURCE_HINTS[src]
}

const dirty = computed(() => {
  if (!payload.value) return false
  for (const s of payload.value.signals) {
    const k = catalogKey(s.signalCatalogId)
    const draftSrc = draft.value[k]
    if (draftSrc !== undefined && draftSrc !== s.signalSource) return true
    const vt = String(draftValueType.value[k] ?? '').trim() || s.valueType || 'number'
    if (vt !== String(s.valueType || 'number')) return true
    const persistedUseForMl = typeof s.useForMl === 'boolean' ? s.useForMl : s.signalSource === 'ML'
    const currentUseForMl = draftUseForMl.value[k] ?? persistedUseForMl
    if (currentUseForMl !== persistedUseForMl) return true
    const persistedUseForForecast = typeof s.useForForecast === 'boolean' ? s.useForForecast : persistedUseForMl
    const currentUseForForecast = draftUseForForecast.value[k] ?? persistedUseForForecast
    if (currentUseForForecast !== persistedUseForForecast) return true
  }
  return false
})

function initDraftFromPayload(p: RideSignalCapabilitiesPayload) {
  const next: Record<string, RideSignalSource> = {}
  const vt: Record<string, string> = {}
  const useMl: Record<string, boolean> = {}
  const useForecast: Record<string, boolean> = {}
  for (const s of p.signals) {
    const k = catalogKey(s.signalCatalogId)
    next[k] = s.signalSource
    vt[k] = s.valueType || 'number'
    const inferredMl = typeof s.useForMl === 'boolean' ? s.useForMl : s.signalSource === 'ML'
    useMl[k] = inferredMl
    useForecast[k] = typeof s.useForForecast === 'boolean' ? s.useForForecast : inferredMl
  }
  draft.value = next
  draftValueType.value = vt
  draftUseForMl.value = useMl
  draftUseForForecast.value = useForecast
}

function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.length >= 19 ? iso.slice(0, 19).replace('T', ' ') : iso
}

async function loadSparkplugRidePreview() {
  sparkplugRidePreview.value = null
  sparkplugRidePreviewErr.value = null
  const parkId = payload.value?.parkId?.trim()
  if (!parkId || !props.rideAssetId) return
  try {
    setApiParkContextId(parkId)
    sparkplugRidePreview.value = await getSparkplugTopicPreviewForAsset(parkId, {
      assetId: props.rideAssetId,
      messageType: 'DDATA',
    })
  } catch (e) {
    sparkplugRidePreviewErr.value = e instanceof Error ? e.message : 'Sparkplug topic preview failed'
  }
}

async function load() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const p = await getRideSignalCapabilities(props.rideAssetId)
    payload.value = p
    initDraftFromPayload(p)
    await Promise.all([loadSparkplugRidePreview(), loadRealtimeData()])
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load signal capabilities', 'error')
  } finally {
    busy.value = false
  }
}

async function save(): Promise<boolean> {
  if (!props.rideAssetId || !payload.value) return false
  busy.value = true
  try {
    const capabilities = payload.value.signals.map((s) => {
      const k = catalogKey(s.signalCatalogId)
      const persistedMl = typeof s.useForMl === 'boolean' ? s.useForMl : s.signalSource === 'ML'
      const persistedFc =
        typeof s.useForForecast === 'boolean' ? s.useForForecast : persistedMl
      const draftMl = draftUseForMl.value[k]
      const draftFc = draftUseForForecast.value[k]
      return {
        signalCatalogId: s.signalCatalogId,
        signalSource: draft.value[k] ?? s.signalSource,
        valueType: draftValueType.value[k] || s.valueType,
        useForMl: draftMl !== undefined ? Boolean(draftMl) : persistedMl,
        useForForecast:
          draftFc !== undefined ? Boolean(draftFc) : draftMl !== undefined ? Boolean(draftMl) : persistedFc,
      }
    })
    const p = await putRideSignalCapabilities(props.rideAssetId, { capabilities })
    payload.value = p
    initDraftFromPayload(p)
    push(t('rideSignalCaps.saved'), 'success')
    return true
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
    return false
  } finally {
    busy.value = false
  }
}

/** Called by Master Data wizard footer Save so UNS/signal usage is not lost when only the footer is used. */
async function flushSignalCapabilitiesIfDirty(): Promise<boolean> {
  if (!dirty.value) return true
  return save()
}

defineExpose({ flushSignalCapabilitiesIfDirty } satisfies RideSignalCapsPanelExpose)

async function prepareTopics() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postPrepareRideUnsTopics(props.rideAssetId)
    push(t('rideSignalCaps.preparedTopics', { created: r.created, updated: r.updated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Prepare failed', 'error')
  } finally {
    busy.value = false
  }
}

async function prepareSparkplug() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postPrepareRideSparkplugMetrics(props.rideAssetId)
    push(t('rideSignalCaps.preparedSparkplug', { created: r.created, updated: r.updated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Prepare failed', 'error')
  } finally {
    busy.value = false
  }
}

const TOPIC_SOURCES = new Set(['MANUAL', 'ADAPTER', 'SIMULATION', 'ML', 'MQTT_EDGE'])

function statusLabel(row: RideSignalCapabilitySignalRow): string {
  const src = draft.value[catalogKey(row.signalCatalogId)] ?? row.signalSource
  if (src !== row.signalSource) return t('rideSignalCaps.statusUnsaved')
  if (src === 'NOT_AVAILABLE') return t('rideSignalCaps.statusNotAvailable')
  if (src === 'MASTER_DATA') return t('rideSignalCaps.statusMasterData')
  if (TOPIC_SOURCES.has(src)) {
    if (row.isPreparedTopic && !row.isActiveTopic) {
      if (src === 'MQTT_EDGE' && !row.isPreparedSparkplug) {
        return t('rideSignalCaps.statusPreparedUnsNoSparkplug')
      }
      return t('rideSignalCaps.statusPreparedInactive')
    }
    if (row.isPreparedTopic && row.isActiveTopic) {
      if (src === 'MQTT_EDGE' && !row.isActiveSparkplug) {
        return t('rideSignalCaps.statusUnsActiveSparkplugInactive')
      }
      return t('rideSignalCaps.statusActive')
    }
    return t('rideSignalCaps.statusNotPrepared')
  }
  return t('rideSignalCaps.statusDraft')
}

function showLiveWithoutConfiguredRealtime(row: RideSignalCapabilitySignalRow): boolean {
  const k = catalogKey(row.signalCatalogId)
  const av = perRowAvailability.value.get(k)
  const src = draft.value[k] ?? row.signalSource
  if (!av || (av.kind !== 'LIVE_AVAILABLE' && av.kind !== 'LIVE_STALE')) return false
  return !expectsRealtimeUns(src)
}

/** UNS `tpuns/.../rides/{ride}/{metric}` + Sparkplug metric path `rides/{ride}/{metric}` for MQTT integrators. */
const suggestedTopicsByCatalogKey = computed(() => {
  type Suggested = {
    unsTpuns: string | null
    sparkplugMetricPath: string | null
    matchesRegistryUns: boolean | null
  }
  const map = new Map<string, Suggested>()
  const signals = payload.value?.signals
  if (!signals?.length) return map
  const sp = sparkplugRidePreview.value
  const resolvedRide = slugifyName(resolvedAssetSlug.value || '')
  for (const row of signals) {
    const parsed = row.unsTopicPreview ? parseTpunsTopic(row.unsTopicPreview) : null
    const parkSlug =
      slugifyName(sp?.parkSlug || '') ||
      (parsed?.park ? slugifyName(parsed.park) : '') ||
      ''
    const rideSlug =
      slugifyName(sp?.assetSlug || '') ||
      resolvedRide ||
      (parsed?.assetSlug ? slugifyName(parsed.assetSlug) : '') ||
      ''
    const metric = slugifyName(row.signalCode)
    const k = catalogKey(row.signalCatalogId)
    if (!metric) {
      map.set(k, { unsTpuns: null, sparkplugMetricPath: null, matchesRegistryUns: null })
      continue
    }
    const unsTpuns =
      parkSlug && rideSlug ? `tpuns/${parkSlug}/v1/rides/${rideSlug}/${metric}` : null
    const sparkplugMetricPath = rideSlug ? `rides/${rideSlug}/${metric}` : null
    const reg = (row.unsTopicPreview || '').trim()
    const matchesRegistryUns =
      unsTpuns && reg ? unsTpuns.toLowerCase() === reg.toLowerCase() : null
    map.set(k, { unsTpuns, sparkplugMetricPath, matchesRegistryUns })
  }
  return map
})

function rowSuggestedTopics(row: RideSignalCapabilitySignalRow): {
  unsTpuns: string | null
  sparkplugMetricPath: string | null
  matchesRegistryUns: boolean | null
} {
  return (
    suggestedTopicsByCatalogKey.value.get(catalogKey(row.signalCatalogId)) ?? {
      unsTpuns: null,
      sparkplugMetricPath: null,
      matchesRegistryUns: null,
    }
  )
}

onMounted(() => {
  void load()
  stopRealtimePoll()
  realtimePollTimer = setInterval(() => {
    void loadRealtimeData()
  }, 15_000)
})

watch(
  () => props.rideAssetId,
  () => {
    closeTelemetryPanel()
    expandedDetail.value = {}
    unsLatestStates.value = []
    mqttLiveBuffer.value = []
    void load()
  }
)

watch(
  () => props.assetSlug,
  () => {
    void loadRealtimeData()
  }
)

onUnmounted(() => {
  stopMqttLivePoll()
  stopRealtimePoll()
})
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:items-start">
    <div class="min-w-0 flex-1 space-y-4">
    <div class="space-y-3">
      <p class="text-xs text-slate-400">{{ t('rideSignalCaps.intro') }}</p>
      <p class="text-[11px] text-slate-500">{{ t('rideSignalCaps.readinessFlagsHint') }}</p>
      <div class="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2">
        <p class="text-[11px] font-semibold text-slate-200">{{ t('rideSignalCaps.quickCheckTitle') }}</p>
        <ol class="mt-1 list-decimal space-y-1 pl-4 text-[11px] text-slate-300">
          <li>{{ t('rideSignalCaps.quickCheckStep1') }}</li>
          <li>{{ t('rideSignalCaps.quickCheckStep2') }}</li>
          <li>{{ t('rideSignalCaps.quickCheckStep3') }}</li>
        </ol>
        <p class="mt-1 text-[10px] text-slate-500">
          Hinweis: Diese Ansicht konfiguriert die Signalnutzung. Live-Werte siehst du in UNS/MQTT-Ansichten.
        </p>
        <div class="mt-2 flex flex-wrap gap-2">
          <RouterLink
            :to="{ name: 'master-data-signal-catalog' }"
            class="inline-flex rounded border border-emerald-800/70 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-950/40"
          >
            Signal-Katalog pflegen
          </RouterLink>
          <RouterLink
            to="/realtime/live"
            class="inline-flex rounded border border-slate-600 px-2.5 py-1 text-[11px] text-brand-300 hover:bg-slate-800"
          >
            UNS Live oeffnen
          </RouterLink>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          :disabled="busy || !dirty"
          @click="save"
        >
          {{ t('rideSignalCaps.save') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-brand-700/60 bg-brand-950/40 px-2.5 py-1.5 text-[11px] text-brand-100 hover:bg-brand-900/50 disabled:opacity-50"
          :disabled="busy"
          @click="prepareTopics"
        >
          {{ t('rideSignalCaps.prepareTopics') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
          :disabled="busy"
          @click="prepareSparkplug"
        >
          {{ t('rideSignalCaps.prepareSparkplug') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800"
          :disabled="busy"
          @click="load"
        >
          {{ t('rideSignalCaps.reload') }}
        </button>
      </div>
      <div v-if="busy && !payload" class="text-xs text-slate-500">{{ t('rideSignalCaps.loading') }}</div>
      <div v-else-if="!payload?.signals?.length" class="text-xs text-slate-500">{{ t('rideSignalCaps.empty') }}</div>
      <div v-else class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-2 py-2">
            <p class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('rideSignalCaps.summaryLive') }}</p>
            <p class="text-xl font-semibold text-emerald-300">{{ summaryCounts.live }}</p>
          </div>
          <div class="rounded-lg border border-amber-900/45 bg-amber-950/25 px-2 py-2">
            <p class="text-[9px] font-medium uppercase tracking-wide text-slate-500">{{ t('rideSignalCaps.summaryStale') }}</p>
            <p class="text-xl font-semibold text-amber-200">{{ summaryCounts.stale }}</p>
          </div>
        </div>

        <div v-if="readiness" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
          <span :class="readiness.operationalReady ? 'text-emerald-300' : 'text-rose-300'">
            {{ t('rideSignalCaps.readinessOps') }}: {{ readiness.operationalReady ? '✓' : '✗' }}
          </span>
          <span :class="readiness.realtimeHealthy ? 'text-emerald-300' : 'text-amber-300'">
            {{ t('rideSignalCaps.readinessRealtime') }}: {{ readiness.realtimeHealthy ? '✓' : '✗' }}
          </span>
          <span :class="readiness.mlReady ? 'text-emerald-300' : 'text-amber-300'">
            {{ t('rideSignalCaps.readinessMl') }}: {{ readiness.mlReady ? '✓' : '✗' }}
          </span>
          <span :class="readiness.forecastReady ? 'text-emerald-300' : 'text-amber-300'">
            {{ t('rideSignalCaps.readinessForecast') }}: {{ readiness.forecastReady ? '✓' : '✗' }}
          </span>
          <span v-if="realtimeLoading" class="text-slate-500">{{ t('rideSignalCaps.realtimeRefreshing') }}</span>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in filterChips"
            :key="chip.id"
            type="button"
            class="rounded-full border px-2.5 py-0.5 text-[10px] transition-colors"
            :class="
              availabilityFilter === chip.id
                ? 'border-brand-500 bg-brand-950/50 text-brand-100'
                : 'border-slate-600 text-slate-400 hover:border-slate-500'
            "
            @click="availabilityFilter = chip.id"
          >
            {{ t(`rideSignalCaps.${chip.i18n}`) }}
          </button>
        </div>

        <div class="overflow-x-auto rounded-lg border border-slate-700">
          <table class="min-w-full text-left text-[11px] text-slate-200">
            <thead class="bg-slate-800/90 text-[11px] text-slate-200">
              <tr>
                <th class="w-8 px-1 py-2" aria-hidden="true" />
                <th class="px-2 py-2 font-semibold">{{ t('rideSignalCaps.colSignal') }}</th>
                <th class="px-2 py-2 font-semibold">{{ t('rideSignalCaps.colAvailability') }}</th>
                <th class="px-2 py-2 font-semibold">{{ t('rideSignalCaps.colLastSeen') }}</th>
                <th class="px-2 py-2 font-semibold">{{ t('rideSignalCaps.colLastValue') }}</th>
                <th class="px-2 py-2 font-semibold">{{ t('rideSignalCaps.colQuality') }}</th>
                <th class="px-2 py-2 font-semibold">
                  <span class="block">{{ t('rideSignalCaps.colMl') }}</span>
                  <span class="mt-0.5 block text-[9px] font-normal normal-case text-slate-500">{{
                    t('rideSignalCaps.colMlHint')
                  }}</span>
                </th>
                <th class="px-2 py-2 font-semibold">
                  <span class="block">{{ t('rideSignalCaps.colForecast') }}</span>
                  <span class="mt-0.5 block text-[9px] font-normal normal-case text-slate-500">{{
                    t('rideSignalCaps.colForecastHint')
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredSignals" :key="row.signalCatalogId">
                <tr
                  class="border-t border-slate-800/80"
                  :class="rowAvailabilityClass(perRowAvailability.get(catalogKey(row.signalCatalogId)))"
                >
                  <td class="px-1 py-1.5 align-top">
                    <button
                      type="button"
                      class="rounded p-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                      :title="t('rideSignalCaps.expandTechnical')"
                      @click="toggleDetailRow(row.signalCatalogId)"
                    >
                      {{ expandedDetail[catalogKey(row.signalCatalogId)] ? '▼' : '▶' }}
                    </button>
                  </td>
                  <td class="px-2 py-1.5 align-top">
                    <button
                      type="button"
                      class="max-w-[12rem] truncate text-left font-mono text-[11px] text-brand-100/90 underline decoration-brand-500/40 underline-offset-2 hover:decoration-brand-400"
                      :title="t('rideSignalCaps.telemetryOpenHint')"
                      @click="onSignalNameClick(row)"
                    >
                      {{ row.signalCode }}
                    </button>
                  </td>
                  <td class="px-2 py-1.5 align-top">
                    <span class="inline-flex items-center gap-1 rounded border border-slate-700/80 bg-slate-900/80 px-1.5 py-0.5 font-medium">
                      <span>{{ availabilityBadge(perRowAvailability.get(catalogKey(row.signalCatalogId))).emoji }}</span>
                      <span>{{ t(availabilityBadge(perRowAvailability.get(catalogKey(row.signalCatalogId))).labelKey) }}</span>
                    </span>
                    <p
                      v-if="showLiveWithoutConfiguredRealtime(row)"
                      class="mt-1 max-w-[11rem] text-[9px] leading-snug text-sky-300/90"
                    >
                      {{ t('rideSignalCaps.availLiveUnsetSourceHint') }}
                    </p>
                  </td>
                  <td class="px-2 py-1.5 align-top font-mono text-[10px] text-slate-400">
                    {{
                      formatIsoShort(perRowAvailability.get(catalogKey(row.signalCatalogId))?.lastSeenIso || null)
                    }}
                  </td>
                  <td
                    class="max-w-[10rem] truncate px-2 py-1.5 align-top font-mono text-[10px] text-slate-200"
                    :title="perRowAvailability.get(catalogKey(row.signalCatalogId))?.lastValueDisplay || ''"
                  >
                    {{ perRowAvailability.get(catalogKey(row.signalCatalogId))?.lastValueDisplay || '—' }}
                  </td>
                  <td class="px-2 py-1.5 align-top text-[10px] text-slate-400">
                    {{ perRowAvailability.get(catalogKey(row.signalCatalogId))?.quality || '—' }}
                  </td>
                  <td class="px-2 py-1.5 align-top">
                    <label
                      class="inline-flex cursor-help items-center gap-1 text-[10px] text-slate-300"
                      :title="t('rideSignalCaps.tooltipUseForMl')"
                    >
                      <input v-model="draftUseForMl[catalogKey(row.signalCatalogId)]" type="checkbox" class="rounded border-slate-600" />
                      {{ t('rideSignalCaps.colMl') }}
                    </label>
                    <ul v-if="rowWarnings(row).length" class="mt-1 max-w-[11rem] space-y-0.5 text-[9px] leading-snug text-rose-300/95">
                      <li v-for="(w, wi) in rowWarnings(row)" :key="wi">{{ w }}</li>
                    </ul>
                  </td>
                  <td class="px-2 py-1.5 align-top">
                    <label
                      class="inline-flex cursor-help items-center gap-1 text-[10px] text-slate-300"
                      :title="t('rideSignalCaps.tooltipUseForForecast')"
                    >
                      <input v-model="draftUseForForecast[catalogKey(row.signalCatalogId)]" type="checkbox" class="rounded border-slate-600" />
                      {{ t('rideSignalCaps.colForecast') }}
                    </label>
                  </td>
                </tr>
                <tr
                  v-if="expandedDetail[catalogKey(row.signalCatalogId)]"
                  class="border-t border-slate-800/60 bg-slate-950/90"
                >
                  <td colspan="8" class="px-3 py-2 align-top">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {{ t('rideSignalCaps.technicalDetailTitle') }}
                    </p>
                    <div class="mt-2 grid gap-3 lg:grid-cols-2">
                      <div class="space-y-2">
                        <label class="block text-[9px] uppercase text-slate-500">{{ t('rideSignalCaps.colSource') }}</label>
                        <select
                          v-model="draft[catalogKey(row.signalCatalogId)]"
                          class="w-full max-w-xs rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                        >
                          <option v-for="src in sources" :key="src" :value="src">
                            {{ sourceLabel(src) }}
                          </option>
                        </select>
                        <p class="text-[10px] text-slate-500">{{ sourceHint(draft[catalogKey(row.signalCatalogId)] ?? row.signalSource) }}</p>
                        <p class="text-[10px] text-slate-500">
                          <span class="font-medium text-slate-400">{{ t('rideSignalCaps.colDescription') }}:</span>
                          {{ row.description || '—' }}
                        </p>
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-[10px] text-slate-500">{{ t('rideSignalCaps.colUnit') }}: {{ row.unit || '—' }}</span>
                          <label class="text-[10px] text-slate-500">
                            {{ t('rideSignalCaps.colValueType') }}
                            <input
                              v-model="draftValueType[catalogKey(row.signalCatalogId)]"
                              type="text"
                              class="ml-1 w-20 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px]"
                            />
                          </label>
                        </div>
                        <p class="text-[10px] text-slate-400">{{ t('rideSignalCaps.registryPrepStatus') }}: {{ statusLabel(row) }}</p>
                      </div>
                      <div class="space-y-1 text-[10px] text-slate-300">
                        <p class="font-semibold uppercase tracking-wide text-emerald-200/80">{{ t('rideSignalCaps.mqttTopicPreviewTitle') }}</p>
                        <dl class="grid gap-1 sm:grid-cols-[7rem_1fr]">
                          <dt class="text-slate-500">{{ t('rideSignalCaps.colUnsPreview') }}</dt>
                          <dd class="break-all font-mono">
                            <template v-if="(row.unsTopicPreview || '').trim()">
                              <span class="text-emerald-100/85">{{ row.unsTopicPreview }}</span>
                              <span class="ml-1 align-middle text-[9px] font-sans font-normal text-slate-500">{{
                                t('rideSignalCaps.previewRegistryStored')
                              }}</span>
                            </template>
                            <template v-else-if="rowSuggestedTopics(row).unsTpuns">
                              <span class="text-emerald-100/80">{{ rowSuggestedTopics(row).unsTpuns }}</span>
                              <span class="ml-1 align-middle text-[9px] font-sans font-normal text-cyan-500/90">{{
                                t('rideSignalCaps.previewConventionBadge')
                              }}</span>
                            </template>
                            <span v-else class="text-slate-600">—</span>
                          </dd>
                          <dt class="text-slate-500">{{ t('rideSignalCaps.colSparkplugPreview') }}</dt>
                          <dd class="break-all font-mono">
                            <template v-if="(row.sparkplugMetricPreview || '').trim()">
                              <span class="text-amber-100/85">{{ row.sparkplugMetricPreview }}</span>
                              <span class="ml-1 align-middle text-[9px] font-sans font-normal text-slate-500">{{
                                t('rideSignalCaps.previewRegistryStored')
                              }}</span>
                            </template>
                            <template v-else-if="rowSuggestedTopics(row).sparkplugMetricPath">
                              <span class="text-amber-100/80">{{ rowSuggestedTopics(row).sparkplugMetricPath }}</span>
                              <span class="ml-1 align-middle text-[9px] font-sans font-normal text-cyan-500/90">{{
                                t('rideSignalCaps.previewConventionBadge')
                              }}</span>
                            </template>
                            <span v-else class="text-slate-600">—</span>
                          </dd>
                          <dt class="text-slate-500">DDATA</dt>
                          <dd class="break-all font-mono text-sky-100/85">
                            <span v-if="sparkplugRidePreview?.topicPreview">{{ sparkplugRidePreview.topicPreview }}</span>
                            <span v-else-if="sparkplugRidePreviewErr" class="text-rose-300/90">{{ sparkplugRidePreviewErr }}</span>
                            <span v-else class="text-slate-500">—</span>
                          </dd>
                          <template v-if="sparkplugRidePreview">
                            <dt class="text-slate-500">group · edge</dt>
                            <dd class="font-mono text-slate-400">
                              {{ sparkplugRidePreview.groupId || '—' }} · {{ sparkplugRidePreview.edgeNodeId || '—' }}
                            </dd>
                          </template>
                        </dl>
                        <div
                          v-if="rowSuggestedTopics(row).unsTpuns || rowSuggestedTopics(row).sparkplugMetricPath"
                          class="mt-2 border-t border-slate-800/90 pt-2"
                        >
                          <p class="font-semibold uppercase tracking-wide text-cyan-200/85">
                            {{ t('rideSignalCaps.expectedTopicsTitle') }}
                          </p>
                          <p class="mt-0.5 text-[9px] leading-snug text-slate-500">
                            {{ t('rideSignalCaps.expectedTopicsIntro') }}
                          </p>
                          <dl class="mt-1.5 grid gap-1 sm:grid-cols-[7rem_1fr]">
                            <dt class="text-slate-500">{{ t('rideSignalCaps.expectedUnsTpuns') }}</dt>
                            <dd class="break-all font-mono text-cyan-100/90">
                              <span v-if="rowSuggestedTopics(row).unsTpuns">{{ rowSuggestedTopics(row).unsTpuns }}</span>
                              <span v-else class="text-slate-600">—</span>
                              <span
                                v-if="
                                  rowSuggestedTopics(row).matchesRegistryUns === true &&
                                  (row.unsTopicPreview || '').trim()
                                "
                                class="ml-1 text-[9px] text-emerald-400/95"
                                >{{ t('rideSignalCaps.topicMatchesRegistry') }}</span
                              >
                              <span
                                v-else-if="
                                  rowSuggestedTopics(row).matchesRegistryUns === false &&
                                  (row.unsTopicPreview || '').trim()
                                "
                                class="ml-1 text-[9px] text-amber-400/95"
                                >{{ t('rideSignalCaps.topicDiffersRegistry') }}</span
                              >
                            </dd>
                            <dt class="text-slate-500">{{ t('rideSignalCaps.expectedSparkplugMetricPath') }}</dt>
                            <dd class="break-all font-mono text-violet-100/88">
                              {{ rowSuggestedTopics(row).sparkplugMetricPath || '—' }}
                            </dd>
                          </dl>
                          <p class="mt-1.5 text-[9px] leading-snug text-slate-500">
                            {{ t('rideSignalCaps.expectedSparkplugDdataNote') }}
                          </p>
                        </div>
                        <p
                          v-else-if="expectsRealtimeUns(draft[catalogKey(row.signalCatalogId)] ?? row.signalSource)"
                          class="mt-2 border-t border-slate-800/90 pt-2 text-[9px] text-slate-500"
                        >
                          {{ t('rideSignalCaps.expectedTopicsUnavailable') }}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </div>

    <aside
      v-if="telemetrySignal"
      class="flex max-h-[min(70vh,36rem)] w-full shrink-0 flex-col overflow-hidden rounded-lg border border-emerald-900/50 bg-slate-950/95 p-3 shadow-lg lg:sticky lg:top-2 lg:w-[min(22rem,100%)]"
    >
      <div class="flex items-start justify-between gap-2 border-b border-slate-800 pb-2">
        <div class="min-w-0">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/90">
            {{ t('rideSignalCaps.telemetryTitle') }}
          </p>
          <p class="mt-0.5 truncate font-mono text-[12px] text-brand-100">{{ telemetrySignal.signalCode }}</p>
          <p class="mt-1 text-[9px] leading-snug text-slate-500">{{ t('rideSignalCaps.telemetryHint') }}</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
          @click="closeTelemetryPanel"
        >
          {{ t('rideSignalCaps.telemetryClose') }}
        </button>
      </div>

      <div class="mt-2">
        <button
          type="button"
          class="rounded border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          :disabled="mqttLiveLoading"
          @click="fetchMqttLiveBuffer"
        >
          {{ t('rideSignalCaps.telemetryRefresh') }}
        </button>
      </div>

      <p v-if="mqttLiveErr" class="mt-2 text-[10px] text-rose-300/90">{{ mqttLiveErr }}</p>

      <p v-else-if="mqttLiveLoading && telemetryMatches.length === 0" class="mt-3 text-[10px] text-slate-500">
        {{ t('rideSignalCaps.telemetryLoading') }}
      </p>

      <div v-else-if="!mqttLiveLoading && telemetryMatches.length === 0" class="mt-3 text-[10px] leading-relaxed text-slate-500">
        {{ t('rideSignalCaps.telemetryEmpty') }}
      </div>

      <ul v-else class="mt-2 flex-1 space-y-2 overflow-y-auto pr-0.5 text-[10px]">
        <li
          v-for="ev in telemetryMatches"
          :key="ev.id"
          class="rounded border border-slate-800/80 bg-slate-900/50 p-2"
        >
          <div class="flex justify-between gap-2 text-slate-400">
            <span class="font-mono text-emerald-200/80">{{ formatIsoShort(ev.receivedAt) }}</span>
            <span v-if="ev.quality" class="text-slate-500">Q: {{ ev.quality }}</span>
          </div>
          <div class="mt-1 font-mono text-[11px] text-slate-100">{{ formatTelemetryValue(ev.value) }}</div>
          <div v-if="ev.valueDisplay" class="mt-0.5 text-slate-400">{{ ev.valueDisplay }}</div>
          <div class="mt-1 truncate font-mono text-[9px] text-slate-500" :title="ev.metric || ''">
            {{ t('rideSignalCaps.telemetryColMetric') }}: {{ ev.metric || '—' }}
          </div>
          <div class="break-all font-mono text-[9px] text-sky-300/70" :title="ev.sparkplugTopic">
            {{ ev.sparkplugTopic || '—' }}
          </div>
          <div v-if="ev.canonicalUnsTopic" class="mt-0.5 break-all font-mono text-[9px] text-emerald-300/60" :title="ev.canonicalUnsTopic">
            UNS: {{ ev.canonicalUnsTopic }}
          </div>
        </li>
      </ul>
    </aside>
  </div>
</template>
