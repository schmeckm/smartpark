'use strict';

const fs = require('fs');
const path = require('path');

/** @type {unknown} */
let cached;

function loadParkDefaultScoringProfile() {
  if (cached !== undefined) return cached;
  const p = path.join(__dirname, '../../data/pdm/park-default-scoring-profile.json');
  const raw = fs.readFileSync(p, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

function resetParkDefaultScoringProfileCacheForTests() {
  cached = undefined;
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Record<string, unknown>} assetPlain
 * @param {Array<Record<string, unknown>>} signals
 * @param {Array<Record<string, unknown>>} metricTrends
 * @returns {{
 *   healthScore: number;
 *   healthState: string;
 *   healthTrend: string;
 *   confidence: string;
 *   deductions: Array<{ code: string; amount: number }>;
 * }}
 */
function computePdHealthScore(profile, assetPlain, signals, metricTrends) {
  const w = /** @type {Record<string, number>} */ (profile?.weights || {});
  const bands = /** @type {Record<string, number>} */ (profile?.healthStateBands || {});
  const critMax = Number.isFinite(Number(bands.criticalMax)) ? Number(bands.criticalMax) : 40;
  const warnMax = Number.isFinite(Number(bands.warningMax)) ? Number(bands.warningMax) : 65;
  const watchMax = Number.isFinite(Number(bands.watchMax)) ? Number(bands.watchMax) : 85;

  /** @type {Array<{ code: string; amount: number }>} */
  const deductions = [];
  let score = 100;

  const sigs = Array.isArray(signals) ? signals : [];
  const trendsByMetric = new Map(
    (Array.isArray(metricTrends) ? metricTrends : []).map((t) => [String(t.metricName || ''), t])
  );

  const now = Date.now();
  const staleMin = Number(w.staleThresholdMinutes) || 25;

  for (const s of sigs) {
    const st = String(s.status || '');
    if (st === 'CRITICAL') deductions.push({ code: 'THRESHOLD_CRITICAL', amount: Number(w.criticalViolation) || 22 });
    else if (st === 'WARN') deductions.push({ code: 'THRESHOLD_WARN', amount: Number(w.warnViolation) || 11 });
    else if (st === 'NO_DATA') deductions.push({ code: 'NO_DATA', amount: Number(w.noData) || 7 });

    const telem = String(s.telemetrySource || 'none');
    if (telem === 'simulated') deductions.push({ code: 'SIMULATED_TELEMETRY', amount: Number(w.simulatedTelemetryPenalty) || 4 });

    const name = String(s.metricName || '').toLowerCase();
    let severityMult = 1;
    if (name.includes('vibration')) severityMult = Number(w.vibrationSeverityMultiplier) || 1.35;
    if (name.includes('temperature') || name.includes('_temp')) severityMult = Math.max(severityMult, Number(w.temperatureSeverityMultiplier) || 1.2);

    const at = s.liveReceivedAt != null ? Date.parse(String(s.liveReceivedAt)) : NaN;
    if (telem === 'live' && Number.isFinite(at)) {
      const ageMin = (now - at) / 60000;
      if (ageMin > staleMin) {
        const rate = Number(w.staleTelemetryPenaltyPerMinute) || 0.12;
        deductions.push({ code: 'STALE_TELEMETRY', amount: Math.min(18, (ageMin - staleMin) * rate) });
      }
    }

    const tr = trendsByMetric.get(String(s.metricName || ''));
    if (tr && typeof tr === 'object') {
      const tstate = String(tr.trend || '');
      if (tstate === 'DECLINING') deductions.push({ code: 'TREND_DECLINING', amount: (Number(w.decliningTrendPenalty) || 7) * severityMult });
      if (tstate === 'UNSTABLE') {
        deductions.push({ code: 'TREND_UNSTABLE', amount: (Number(w.unstableTrendPenalty) || 9) * severityMult });
        if (name.includes('rpm')) {
          deductions.push({ code: 'RPM_INSTABILITY', amount: Number(w.rpmInstabilityPenalty) || 6 });
        }
      }
      const spikes = Number(tr.spikeCount);
      if (Number.isFinite(spikes) && spikes >= 2) {
        deductions.push({ code: 'SPIKE_BURST', amount: Number(w.spikeFrequencyPenalty) || 5 });
      }
    }
  }

  for (const d of deductions) {
    score -= d.amount;
  }

  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));

  let healthState = 'OK';
  if (score <= critMax) healthState = 'CRITICAL';
  else if (score <= warnMax) healthState = 'WARNING';
  else if (score <= watchMax) healthState = 'WATCH';

  const tStates = (Array.isArray(metricTrends) ? metricTrends : []).map((t) => String(t.trend || ''));
  let healthTrend = 'STABLE';
  if (tStates.includes('UNSTABLE')) healthTrend = 'UNSTABLE';
  else if (tStates.filter((x) => x === 'DECLINING').length > tStates.filter((x) => x === 'IMPROVING').length) {
    healthTrend = 'DECLINING';
  } else if (tStates.filter((x) => x === 'IMPROVING').length > tStates.filter((x) => x === 'DECLINING').length) {
    healthTrend = 'IMPROVING';
  }

  let liveN = 0;
  let simN = 0;
  let noneN = 0;
  for (const s of sigs) {
    const t = String(s.telemetrySource || 'none');
    if (t === 'live') liveN += 1;
    else if (t === 'simulated') simN += 1;
    else noneN += 1;
  }
  let confidence = 'HIGH';
  if (noneN > 0 && liveN === 0) confidence = 'LOW';
  else if (simN > 0 && liveN > 0) confidence = 'MEDIUM';
  else if (simN > 0 && liveN === 0) confidence = 'MEDIUM';

  return { healthScore: score, healthState, healthTrend, confidence, deductions };
}

module.exports = {
  loadParkDefaultScoringProfile,
  computePdHealthScore,
  resetParkDefaultScoringProfileCacheForTests,
};
