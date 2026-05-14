import { collectMatchingLiveEvents } from './uns-mqtt-live-signal-match.mjs';

/** Sources that expect IT/OT realtime via UNS / MQTT buffer for availability coloring. */
export const EXPECTS_REALTIME_UNS = new Set(['MQTT_EDGE', 'SIMULATION', 'ADAPTER']);

/** Default operational signals treated as required when source expects realtime (MVP). */
export const DEFAULT_REQUIRED_OPERATIONAL_SIGNAL_CODES = new Set(['queue_time', 'status']);

export const DEFAULT_FRESHNESS_MS = 60_000;

export function expectsRealtimeUns(signalSource) {
  return EXPECTS_REALTIME_UNS.has(String(signalSource || ''));
}

function signalRowStub(signalCode, unsTopicPreview, sparkplugMetricPreview) {
  return { signalCode, unsTopicPreview, sparkplugMetricPreview };
}

/**
 * UNS latest-state rows that may belong to this signal + asset.
 * @param {Array<{ topicPath?: string, eventTime?: string, payloadJson?: object, quality?: string|null }>} states
 */
export function filterLatestStatesForSignal(states, { canonicalUnsTopic, assetSlug, signalCode }) {
  const canon = (canonicalUnsTopic || '').trim();
  const slug = (assetSlug || '').trim().toLowerCase();
  const code = (signalCode || '').trim().toLowerCase();
  const out = [];
  for (const s of states || []) {
    const tp = (s.topicPath || '').trim();
    if (!tp) continue;
    if (canon && tp === canon) {
      out.push(s);
      continue;
    }
    if (slug && code) {
      const lower = tp.toLowerCase();
      const needle = `/rides/${slug}/`;
      if (lower.includes(needle) && (lower.endsWith(`/${code}`) || lower.includes(`/${code}/`))) {
        out.push(s);
      }
    }
  }
  out.sort((a, b) => Date.parse(String(b.eventTime)) - Date.parse(String(a.eventTime)));
  return out;
}

function extractPayloadValue(payloadJson) {
  if (payloadJson == null || typeof payloadJson !== 'object') return null;
  if ('value' in payloadJson && payloadJson.value !== undefined) return payloadJson.value;
  if ('metricValue' in payloadJson && payloadJson.metricValue !== undefined) return payloadJson.metricValue;
  try {
    return JSON.stringify(payloadJson);
  } catch {
    return String(payloadJson);
  }
}

function formatValueForDisplay(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * Best merged observation from MQTT live buffer + UNS latest-state (newest wins).
 */
export function pickMergedObservation(signalRow, assetSlug, mqttLiveEvents, unsLatestStates) {
  const stub = signalRowStub(
    signalRow.signalCode,
    signalRow.unsTopicPreview,
    signalRow.sparkplugMetricPreview
  );
  const mqttSorted = collectMatchingLiveEvents(stub, mqttLiveEvents || [], {
    rideAssetSlug: assetSlug || null,
  });
  const mqttBest = mqttSorted[0] || null;
  const stateSorted = filterLatestStatesForSignal(unsLatestStates || [], {
    canonicalUnsTopic: signalRow.unsTopicPreview,
    assetSlug,
    signalCode: signalRow.signalCode,
  });
  const stateBest = stateSorted[0] || null;

  const mt = mqttBest ? Date.parse(String(mqttBest.receivedAt)) : -Infinity;
  const st = stateBest ? Date.parse(String(stateBest.eventTime)) : -Infinity;

  if (mqttBest && mt >= st) {
    return {
      lastSeenIso: String(mqttBest.receivedAt),
      lastValueDisplay: formatValueForDisplay(
        mqttBest.valueDisplay != null && mqttBest.valueDisplay !== ''
          ? mqttBest.valueDisplay
          : mqttBest.value
      ),
      quality: mqttBest.quality != null ? String(mqttBest.quality) : null,
    };
  }
  if (stateBest) {
    const raw = extractPayloadValue(stateBest.payloadJson);
    return {
      lastSeenIso: String(stateBest.eventTime),
      lastValueDisplay: formatValueForDisplay(raw),
      quality: stateBest.quality != null ? String(stateBest.quality) : null,
    };
  }
  return null;
}

/**
 * @typedef {'LIVE_AVAILABLE'|'LIVE_STALE'|'MISSING'|'NOT_EXPECTED'} SignalAvailabilityKind
 */

/**
 * Business rule: availability from MQTT/UNS only; independent of ML/Forecast flags.
 *
 * @param {object} params
 * @param {number} params.nowMs
 * @param {number} [params.freshnessThresholdMs]
 * @param {string} params.assetSlug
 * @param {string} params.signalCode
 * @param {string|null|undefined} params.canonicalUnsTopic
 * @param {string|null|undefined} params.sparkplugMetricPreview
 * @param {readonly object[]} params.mqttLiveEvents
 * @param {readonly object[]} params.unsLatestStates
 * @param {string} params.signalSource
 * @param {boolean} params.required
 * @param {boolean} params.enabled — if false, treat as not expecting realtime (NOT_EXPECTED)
 */
export function resolveSignalAvailability(params) {
  const freshnessThresholdMs =
    typeof params.freshnessThresholdMs === 'number' && params.freshnessThresholdMs > 0
      ? params.freshnessThresholdMs
      : DEFAULT_FRESHNESS_MS;

  if (params.enabled === false) {
    return {
      kind: /** @type {SignalAvailabilityKind} */ ('NOT_EXPECTED'),
      lastSeenIso: null,
      lastValueDisplay: null,
      quality: null,
      required: Boolean(params.required),
    };
  }

  const expectsConfig = expectsRealtimeUns(params.signalSource);

  const obs = pickMergedObservation(
    {
      signalCode: params.signalCode,
      unsTopicPreview: params.canonicalUnsTopic,
      sparkplugMetricPreview: params.sparkplugMetricPreview,
    },
    params.assetSlug,
    params.mqttLiveEvents,
    params.unsLatestStates
  );

  /** No configured realtime source (e.g. NOT_AVAILABLE): still surface MQTT/UNS observation so ops see parity with UNS Live. */
  if (!expectsConfig) {
    if (!obs || !obs.lastSeenIso) {
      return {
        kind: /** @type {SignalAvailabilityKind} */ ('NOT_EXPECTED'),
        lastSeenIso: null,
        lastValueDisplay: null,
        quality: null,
        required: Boolean(params.required),
      };
    }
    const age = params.nowMs - Date.parse(obs.lastSeenIso);
    const kind =
      age <= freshnessThresholdMs
        ? /** @type {SignalAvailabilityKind} */ ('LIVE_AVAILABLE')
        : /** @type {SignalAvailabilityKind} */ ('LIVE_STALE');
    return {
      kind,
      lastSeenIso: obs.lastSeenIso,
      lastValueDisplay: obs.lastValueDisplay,
      quality: obs.quality,
      required: Boolean(params.required),
    };
  }

  if (!obs || !obs.lastSeenIso) {
    return {
      kind: /** @type {SignalAvailabilityKind} */ ('MISSING'),
      lastSeenIso: null,
      lastValueDisplay: null,
      quality: null,
      required: Boolean(params.required),
    };
  }

  const age = params.nowMs - Date.parse(obs.lastSeenIso);
  const kind =
    age <= freshnessThresholdMs
      ? /** @type {SignalAvailabilityKind} */ ('LIVE_AVAILABLE')
      : /** @type {SignalAvailabilityKind} */ ('LIVE_STALE');

  return {
    kind,
    lastSeenIso: obs.lastSeenIso,
    lastValueDisplay: obs.lastValueDisplay,
    quality: obs.quality,
    required: Boolean(params.required),
  };
}

/**
 * @param {Array<{ kind: SignalAvailabilityKind, required: boolean, useForMl?: boolean, useForForecast?: boolean, signalSource: string }>} rows
 */
export function computeReadiness(rows) {
  const requiredRows = rows.filter((r) => r.required && expectsRealtimeUns(r.signalSource));
  const operationalReady =
    requiredRows.length === 0 ||
    requiredRows.every((r) => r.kind === 'LIVE_AVAILABLE' || r.kind === 'LIVE_STALE');

  const realtimeHealthy =
    requiredRows.length === 0 || requiredRows.every((r) => r.kind === 'LIVE_AVAILABLE');

  function mlOrForecastReady(useFlag) {
    return rows.every((r) => {
      if (!r[useFlag]) return true;
      if (!expectsRealtimeUns(r.signalSource)) return true;
      return r.kind === 'LIVE_AVAILABLE' || r.kind === 'LIVE_STALE';
    });
  }

  const mlReady = mlOrForecastReady('useForMl');
  const forecastReady = mlOrForecastReady('useForForecast');

  return { operationalReady, realtimeHealthy, mlReady, forecastReady };
}
