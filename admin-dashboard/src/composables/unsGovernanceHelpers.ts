import type {
  MqttInboundRow,
  OperationFactRide,
  RideSignalCapabilitySignalRow,
  RideSignalSource,
  UnsLatestState,
  UnsMqttLiveEvent,
} from '@/api/client'
import {
  collectMatchingLiveEvents as collectMatchingLiveEventsCore,
  type CollectMatchingLiveEventsOpts,
} from '@/utils/unsMqttLiveSignalMatch'

export type { CollectMatchingLiveEventsOpts }

/** Mirrors backend `TOPIC_SOURCES` in ride-signal-capability.service.js */
const TOPIC_SOURCES_NEED_PATH = new Set<RideSignalSource>([
  'MANUAL',
  'ADAPTER',
  'SIMULATION',
  'ML',
  'MQTT_EDGE',
])

export type GovernanceTier = 'GREEN' | 'YELLOW' | 'RED' | 'GREY'

export type GovernanceEvaluation = {
  ok: boolean
  reason: string
}

/**
 * Mirrors `evaluateRegistryGovernanceSync` in approved-operational-signal.service.js
 * (read-only, for console display).
 */
export function evaluateRegistryGovernance(sig: RideSignalCapabilitySignalRow): GovernanceEvaluation {
  const src = sig.signalSource
  if (src === 'NOT_AVAILABLE') return { ok: false, reason: 'capability_not_available' }
  const needsTopic = TOPIC_SOURCES_NEED_PATH.has(src)
  if (!needsTopic) return { ok: true, reason: 'source_no_activation_topic' }
  const unsActive = Boolean(sig.isActiveTopic)
  const sparkActive = Boolean(sig.isActiveSparkplug)
  if (src === 'MQTT_EDGE') {
    if (unsActive || sparkActive) return { ok: true, reason: 'mqtt_edge_active_path' }
    return { ok: false, reason: 'mqtt_edge_no_active_registry_path' }
  }
  if (unsActive) return { ok: true, reason: 'uns_active_topic' }
  return { ok: false, reason: 'no_active_prepared_topic' }
}

const REASON_MESSAGES: Record<string, string> = {
  capability_not_available: 'Capability source is NOT_AVAILABLE — enable a signal source (for example MQTT_EDGE) in ride signal capabilities.',
  mqtt_edge_no_active_registry_path:
    'MQTT_EDGE requires an active UNS registry topic or active Sparkplug metric path — prepare and activate topics, or approve an MQTT topic proposal.',
  no_active_prepared_topic:
    'This signal source requires an active UNS registry topic — prepare topics and activate when ready.',
  source_no_activation_topic: 'Source does not require UNS activation for basic governance.',
  uns_active_topic: 'UNS registry topic path is active.',
  mqtt_edge_active_path: 'MQTT edge path is active (UNS or Sparkplug).',
  not_configured: 'No ride capability row or prepared registry mapping for this catalog signal.',
}

export function governanceReasonLabel(reason: string): string {
  return REASON_MESSAGES[reason] || reason
}

export function mqttBlockExplanations(row: MqttInboundRow): string[] {
  const out: string[] = []
  const dec = String(row.capabilityGuardDecision || '').toUpperCase()
  if (dec === 'BLOCK' || row.spyClassification === 'CAPABILITY_GUARD_BLOCK') {
    const r = String(row.capabilityGuardReason || '').trim()
    if (r) out.push(`Capability guard: ${r}`)
    else out.push('Capability guard blocked this inbound message (enforce mode or policy).')
    const det = row.capabilityGuardDetails
    if (det && typeof det === 'object') {
      const code = det.code != null ? String(det.code) : ''
      const msg = det.message != null ? String(det.message) : ''
      if (code || msg) out.push([code, msg].filter(Boolean).join(' — '))
    }
  }
  if (row.spyClassification === 'UNKNOWN_TOPIC') out.push('UNS Spy classified topic as UNKNOWN_TOPIC — no approved mapping for this MQTT topic.')
  if (row.spyClassification === 'UNKNOWN_SIGNAL') out.push('UNS Spy classified payload as UNKNOWN_SIGNAL — metric not mapped to signal catalog.')
  if (row.spyClassification === 'CONFLICT') out.push('UNS Spy reported CONFLICT — duplicate or ambiguous signal/topic definitions.')
  return out.length ? out : ['No block classification on this row (observe-only or allowed).']
}

/** Mirrors backend `kpiKeyForSignalCode` (operations-facts.service.js). */
export function kpiKeyForSignalCode(code: string): string | null {
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

/** UNS Live events that belong to this capability row (canonical topic, metric name, or Sparkplug path). Newest first after sort. */
export function collectMatchingLiveEvents(
  signal: RideSignalCapabilitySignalRow,
  events: UnsMqttLiveEvent[],
  opts?: CollectMatchingLiveEventsOpts
): UnsMqttLiveEvent[] {
  return collectMatchingLiveEventsCore<UnsMqttLiveEvent>(signal, events, opts)
}

export function pickLatestLiveEvent(
  signal: RideSignalCapabilitySignalRow,
  events: UnsMqttLiveEvent[],
  opts?: CollectMatchingLiveEventsOpts
): UnsMqttLiveEvent | null {
  const candidates = collectMatchingLiveEvents(signal, events, opts)
  return candidates.length ? candidates[0] : null
}

export function latestStateEventTimeForTopic(
  states: UnsLatestState[],
  unsTopicPreview: string | null | undefined
): string | null {
  const p = (unsTopicPreview || '').trim()
  if (!p) return null
  let best: string | null = null
  for (const s of states) {
    const tp = (s.topicPath || '').trim()
    if (tp !== p) continue
    const t = s.eventTime
    if (!best || Date.parse(t) > Date.parse(best)) best = t
  }
  return best
}

export function governanceTierForSignal(
  sig: RideSignalCapabilitySignalRow,
  opts: {
    staleMs: number
    latestStateIso: string | null
    liveReceivedAt: string | null
    opsBreakdownSource: string | null
    deprecationHealthOk: boolean
  }
): GovernanceTier {
  if (!sig.capabilityId && !sig.isPreparedTopic && !sig.isPreparedSparkplug) return 'GREY'

  const ev = evaluateRegistryGovernance(sig)
  if (!ev.ok) return 'RED'

  const freshIso = opts.liveReceivedAt || opts.latestStateIso
  if (sig.isActiveTopic || sig.isActiveSparkplug) {
    if (!freshIso) return 'YELLOW'
    if (Date.now() - Date.parse(freshIso) > opts.staleMs) return 'YELLOW'
  }

  const obs = String(opts.opsBreakdownSource || '').toUpperCase()
  if (obs === 'LEGACY_UNS' || obs === 'MISSING' || obs === 'CONFLICT') return 'YELLOW'

  if (!opts.deprecationHealthOk) return 'YELLOW'

  return 'GREEN'
}

export function computeRideReadiness(params: {
  capabilities: RideSignalCapabilitySignalRow[]
  operationFact: OperationFactRide | null
  staleMs: number
  latestStates: UnsLatestState[]
  liveEvents: UnsMqttLiveEvent[]
  /** Limits MQTT buffer matching to this ride (same as asset slug in UNS paths). */
  rideAssetSlug?: string | null
}): {
  operationsFactsReady: boolean
  addonBoardReady: boolean
  mlReady: boolean
  missingApprovedSignals: string[]
  notes: string[]
} {
  const notes: string[] = []
  const missingApprovedSignals: string[] = []

  const of = params.operationFact
  const coreKeys = ['queueTime', 'status'] as const
  let operationsFactsReady = false
  if (of) {
    const missing = coreKeys.filter((k) => {
      const b = of.sourceBreakdown[k]
      return !b || String(b.source).toUpperCase() === 'MISSING'
    })
    operationsFactsReady = missing.length === 0 && (of.warnings?.length ?? 0) === 0
    if (missing.length) missingApprovedSignals.push(...missing.map((k) => `operations:${k}`))
  } else {
    notes.push('Operations Facts: no ride payload returned (check park scope and ride id).')
  }

  const liveOpts = params.rideAssetSlug?.trim()
    ? { rideAssetSlug: params.rideAssetSlug.trim() }
    : undefined

  const greenSignals = params.capabilities.filter((s) => {
    const live = pickLatestLiveEvent(s, params.liveEvents, liveOpts)
    const st = latestStateEventTimeForTopic(params.latestStates, s.unsTopicPreview)
    return (
      governanceTierForSignal(s, {
        staleMs: params.staleMs,
        latestStateIso: st,
        liveReceivedAt: live?.receivedAt ?? null,
        opsBreakdownSource: (() => {
          const k = kpiKeyForSignalCode(s.signalCode)
          if (!k || !of) return null
          return of.sourceBreakdown[k]?.source ?? null
        })(),
        deprecationHealthOk: true,
      }) === 'GREEN'
    )
  })
  const addonBoardReady = greenSignals.length >= 2
  const mlReady = greenSignals.length >= 3 && operationsFactsReady

  return { operationsFactsReady, addonBoardReady, mlReady, missingApprovedSignals, notes }
}
