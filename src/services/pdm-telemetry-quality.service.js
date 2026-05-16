'use strict';

const env = require('../config/env');

/**
 * @param {string|null|undefined} liveReceivedAtIso
 * @param {'live'|'simulated'|'none'} telemetrySource
 * @param {(s: string) => boolean} [isStaleClock]
 */
function signalTelemetryQuality(liveReceivedAtIso, telemetrySource, isStaleClock) {
  const src = String(telemetrySource || 'none');
  if (src === 'simulated') return { status: 'SIMULATED', detail: 'Deterministic demo telemetry (no live Sparkplug row for this evaluation).' };
  if (src === 'none') return { status: 'NO_DATA', detail: 'No numeric sample available for this metric.' };

  const at = liveReceivedAtIso != null ? Date.parse(String(liveReceivedAtIso)) : NaN;
  if (!Number.isFinite(at)) return { status: 'NO_DATA', detail: 'Live source indicated but timestamp missing.' };

  const staleThresholdMs =
    typeof isStaleClock === 'function'
      ? null
      : Math.max(60_000, Number(env.ingestionMaxAgeMs) || 20 * 60 * 1000);

  const age = Date.now() - at;
  const staleMs =
    typeof isStaleClock === 'function' ? null : staleThresholdMs != null ? staleThresholdMs * 2 : 2_400_000;
  if (staleMs != null && age > staleMs) {
    return { status: 'STALE', detail: `Last sample age ${Math.round(age / 60000)}m exceeds staleness budget.` };
  }

  return { status: 'LIVE', detail: 'Recent Sparkplug-backed sample in this process buffer.' };
}

/**
 * @param {Array<Record<string, unknown>>} signals
 */
function parkTelemetryCoverageSummary(signals) {
  const sigs = Array.isArray(signals) ? signals : [];
  const statuses = sigs.map((s) =>
    signalTelemetryQuality(
      s.liveReceivedAt != null ? String(s.liveReceivedAt) : null,
      /** @type {'live'|'simulated'|'none'} */ (String(s.telemetrySource || 'none'))
    ).status
  );
  const liveN = statuses.filter((x) => x === 'LIVE').length;
  const simN = statuses.filter((x) => x === 'SIMULATED').length;
  const noN = statuses.filter((x) => x === 'NO_DATA').length;
  const staleN = statuses.filter((x) => x === 'STALE').length;

  let overall = 'LIVE';
  if (!sigs.length) overall = 'NO_DATA';
  else if (liveN === sigs.length) overall = 'LIVE';
  else if (simN === sigs.length) overall = 'SIMULATED';
  else if (noN === sigs.length) overall = 'NO_DATA';
  else overall = 'PARTIAL';

  return {
    overall,
    counts: { LIVE: liveN, SIMULATED: simN, NO_DATA: noN, STALE: staleN },
    perSignal: sigs.map((s) => ({
      metricName: String(s.metricName || ''),
      ...signalTelemetryQuality(
        s.liveReceivedAt != null ? String(s.liveReceivedAt) : null,
        /** @type {'live'|'simulated'|'none'} */ (String(s.telemetrySource || 'none'))
      ),
    })),
  };
}

module.exports = {
  signalTelemetryQuality,
  parkTelemetryCoverageSummary,
};
