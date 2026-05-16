'use strict';

const LOW_FACTOR = 0.0012;
const MID_FACTOR = 0.0022;
const HIGH_FACTOR = 0.0035;

const INBOUND_PRESSURE_BANDS = [0, 25, 50, 75, 100];

function clamp(n, lo, hi) {
  const x = Number(n);
  if (Number.isNaN(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Legacy snapshots stored delayPercent as ratio 0..1; newer rows use percent 0..100.
 * @param {number|null|undefined} stored
 * @returns {number}
 */
function normalizeStoredDelayPercentAs100(stored) {
  const v = Number(stored);
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v <= 1) return v * 100;
  return clamp(v, 0, 1000);
}

/**
 * delayMinutes = max(0, current - baseline); delayPercent = delay/baseline*100 (percent points 0..+inf, clamped for scores).
 * @param {{
 *   currentTravelTimeMin: number,
 *   baselineTravelTimeMin: number,
 *   direction: string,
 *   weight?: number,
 *   incidentCount?: number,
 * }} p
 */
function computeSnapshotMetrics(p) {
  const base = Number(p.baselineTravelTimeMin);
  const cur = Number(p.currentTravelTimeMin);
  const delay_minutes = Math.max(0, cur - base);
  let delay_percent = 0;
  if (base > 0) delay_percent = (delay_minutes / base) * 100;
  const congestion_score = clamp(delay_percent, 0, 100);
  const inbound_pressure_score =
    p.direction === 'outbound'
      ? 0
      : computeInboundPressureMvp({
          delayPercent: delay_percent,
          congestionScore: congestion_score,
          incidentCount: p.incidentCount ?? 0,
          weight: p.weight ?? 1,
        });
  return { delay_min: delay_minutes, delay_percent, congestion_score, inbound_pressure_score };
}

/**
 * MVP discrete pressure 0 / 25 / 50 / 75 / 100 from delay, congestion, incidents, corridor weight.
 * @param {{ delayPercent: number, congestionScore: number, incidentCount?: number, weight?: number }} p
 */
function computeInboundPressureMvp(p) {
  const d = clamp(Number(p.delayPercent) || 0, 0, 100);
  const c = clamp(Number(p.congestionScore) || 0, 0, 100);
  const inc = clamp((Number(p.incidentCount) || 0) * 12, 0, 48);
  const w = clamp(Number(p.weight) || 1, 0.1, 10);
  const wBoost = clamp((w - 1) * 10, 0, 25);
  const raw = clamp(0.42 * d + 0.42 * c + 0.08 * inc + 0.08 * wBoost, 0, 100);
  let best = INBOUND_PRESSURE_BANDS[0];
  let bestDist = Infinity;
  for (const b of INBOUND_PRESSURE_BANDS) {
    const dist = Math.abs(b - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}

/**
 * @param {{ inbound_pressure_score: number, weight: number }[]} rows
 */
function computeWeightedTrafficPressure(rows) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const w = Number(r.weight);
    if (!w || w <= 0) continue;
    num += Number(r.inbound_pressure_score) * w;
    den += w;
  }
  if (den <= 0) return 0;
  return clamp(num / den, 0, 100);
}

/**
 * @param {{ traffic_pressure_score: number, parking_pressure_score: number, weather_score: number, holiday_score: number, event_score: number }} p
 */
function computeExternalDemandPressure(p) {
  const t = Number(p.traffic_pressure_score) || 0;
  const park = Number(p.parking_pressure_score) || 0;
  const w = Number(p.weather_score) || 0;
  const h = Number(p.holiday_score) || 0;
  const e = Number(p.event_score) || 0;
  const raw = t * 0.5 + park * 0.2 + w * 0.1 + h * 0.1 + e * 0.1;
  return clamp(raw, 0, 100);
}

/**
 * @param {number} plannedTotal
 * @param {number} externalScore 0..100
 */
function computeProbabilisticAdditionalDemand(plannedTotal, externalScore) {
  const pt = Math.max(0, Math.round(Number(plannedTotal) || 0));
  const ex = clamp(Number(externalScore) || 0, 0, 100);
  const additional_demand_low = Math.round(pt * ex * LOW_FACTOR);
  const additional_demand_mid = Math.round(pt * ex * MID_FACTOR);
  const additional_demand_high = Math.round(pt * ex * HIGH_FACTOR);
  return {
    additional_demand_low,
    additional_demand_mid,
    additional_demand_high,
    expected_attendance_low: pt + additional_demand_low,
    expected_attendance_mid: pt + additional_demand_mid,
    expected_attendance_high: pt + additional_demand_high,
  };
}

function mapForecastStatus(externalDemandPressureScore) {
  const s = Number(externalDemandPressureScore) || 0;
  if (s <= 30) return 'normal';
  if (s <= 60) return 'elevated';
  if (s <= 80) return 'high';
  return 'critical';
}

function buildRecommendations(status) {
  if (status === 'normal') return ['Monitor demand.'];
  if (status === 'elevated') return ['Prepare gate capacity and parking staff.'];
  if (status === 'high') {
    return [
      'Open additional gate lanes.',
      'Increase parking staff.',
      'Strengthen entrance security.',
      'Prepare F&B capacity.',
    ];
  }
  return [
    'Activate overflow parking.',
    'Increase shuttle capacity.',
    'Activate realtime guest routing.',
    'Send management alert.',
  ];
}

const LEADING_INDICATOR_NOTE =
  'Traffic is used as a leading indicator for potential spontaneous demand pressure. It is not converted directly into visitor count.';

/**
 * @param {{ corridorSnapshotCount: number, weatherProvided: boolean, holidayProvided: boolean, eventProvided: boolean, parkingProvided: boolean }} ctx
 */
function computeConfidenceScore(ctx) {
  let c = 0.25;
  c += Math.min(0.45, (Number(ctx.corridorSnapshotCount) || 0) * 0.12);
  if (ctx.weatherProvided) c += 0.08;
  if (ctx.holidayProvided) c += 0.08;
  if (ctx.eventProvided) c += 0.07;
  if (ctx.parkingProvided) c += 0.07;
  return clamp(c, 0, 1) * 100;
}

function buildExplanationJson({ traffic_pressure_score, external_demand_pressure_score }) {
  return {
    leadingIndicatorPrinciple: LEADING_INDICATOR_NOTE,
    trafficPressureScore: traffic_pressure_score,
    externalDemandPressureScore: external_demand_pressure_score,
    separation: {
      plannedDemand: 'Baseline plan from visit planning or ops input.',
      knownRegisteredExpected: 'Registered or ticketed demand already counted toward planned_total.',
      externalDemandPressure:
        'Composite pressure from traffic corridor snapshots (leading indicator), parking, weather, holiday, events — traffic is not visitor count.',
      probabilisticAdditionalDemand:
        'Low / high scenarios from planned_total × external pressure × calibrated factors — not a traffic-to-guests conversion.',
    },
  };
}

module.exports = {
  LOW_FACTOR,
  MID_FACTOR,
  HIGH_FACTOR,
  clamp,
  computeSnapshotMetrics,
  computeInboundPressureMvp,
  normalizeStoredDelayPercentAs100,
  computeWeightedTrafficPressure,
  computeExternalDemandPressure,
  computeProbabilisticAdditionalDemand,
  mapForecastStatus,
  buildRecommendations,
  computeConfidenceScore,
  buildExplanationJson,
  LEADING_INDICATOR_NOTE,
};
