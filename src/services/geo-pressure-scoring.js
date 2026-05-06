'use strict';

/**
 * Pure formulas for geo pressure — transparent, testable, no DB.
 * @see docs/adr/0001-forecast-architecture.md for forecast inputs (reused upstream).
 */

const STATUS = Object.freeze({
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  RED: 'RED',
  CRITICAL: 'CRITICAL',
});

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Equivalent people in queue from steady-state flow: (wait hours) * throughput.
 * @param {number} waitMin
 * @param {number} capacityPerHour
 */
function theoreticalQueuePeople(waitMin, capacityPerHour) {
  const w = Math.max(0, Number(waitMin) || 0);
  const c = Math.max(0, Number(capacityPerHour) || 0);
  return (w / 60) * c;
}

/**
 * Default expected wait when no target is set (ops-neutral prior).
 * @param {number} capacityPerHour
 */
function defaultExpectedWaitMinutes(capacityPerHour) {
  const c = Math.max(1, Number(capacityPerHour) || 1);
  if (c >= 1400) return 22;
  if (c >= 800) return 18;
  if (c >= 400) return 15;
  return 12;
}

/**
 * @param {number} actualWaitMin
 * @param {number|null|undefined} targetWaitMin from asset_targets
 * @param {number} capacityPerHour
 */
function stressFactor(actualWaitMin, targetWaitMin, capacityPerHour) {
  const actual = Math.max(0, Number(actualWaitMin) || 0);
  const expected =
    targetWaitMin != null && Number.isFinite(Number(targetWaitMin)) && Number(targetWaitMin) > 0
      ? Number(targetWaitMin)
      : defaultExpectedWaitMinutes(capacityPerHour);
  return actual / Math.max(1, expected);
}

/**
 * @param {boolean} downtimeActive
 * @param {number} capacityLossPct 0..100
 */
function capacityLossPct(downtimeActive, trainsRemovedHint = false) {
  if (!downtimeActive && !trainsRemovedHint) return 0;
  if (downtimeActive) return 100;
  return trainsRemovedHint ? 35 : 0;
}

/**
 * Ride pressure 0..100 — combines wait stress, implied queue mass, downtime.
 * @param {{
 *   waitMin: number;
 *   forecastWaitMin?: number|null;
 *   capacityPerHour: number;
 *   targetWaitMin?: number|null;
 *   downtimeActive?: boolean;
 * }} p
 */
function ridePressureScore(p) {
  const waitMin = clamp(p.waitMin, 0, 300);
  const cap = Math.max(1, Number(p.capacityPerHour) || 1);
  const stress = stressFactor(waitMin, p.targetWaitMin, cap);
  const queueMass = theoreticalQueuePeople(waitMin, cap);
  const massNorm = clamp(queueMass / 2500, 0, 1);
  const stressNorm = clamp((stress - 1) / 2.5, 0, 1);
  let score = clamp(28 * stressNorm + 42 * massNorm + waitMin * 0.12, 0, 100);
  if (p.downtimeActive) score = clamp(score * 1.35 + 18, 0, 100);
  const fWait = p.forecastWaitMin != null && Number.isFinite(Number(p.forecastWaitMin)) ? Number(p.forecastWaitMin) : null;
  if (fWait != null && fWait > waitMin) {
    score = clamp(score + Math.min(22, (fWait - waitMin) * 0.35), 0, 100);
  }
  return Math.round(score);
}

/**
 * F&B / retail proxy when only queue wait exists.
 */
function venuePressureScore({ waitMin = 0, downtimeActive = false }) {
  const w = clamp(waitMin, 0, 180);
  let score = clamp(w * 0.85 + (w > 25 ? (w - 25) * 0.4 : 0), 0, 100);
  if (downtimeActive) score = clamp(score + 15, 0, 100);
  return Math.round(score);
}

function statusFromScore(score) {
  const s = clamp(score, 0, 100);
  if (s < 32) return STATUS.GREEN;
  if (s < 52) return STATUS.YELLOW;
  if (s < 72) return STATUS.RED;
  return STATUS.CRITICAL;
}

/** Haversine distance in meters */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Gaussian kernel weight 0..1 at distance d (m), characteristic length = radiusM / 2.
 * @param {number} dMeters
 * @param {number} radiusM
 */
function kernelWeight(dMeters, radiusM) {
  const r = Math.max(20, Number(radiusM) || 80);
  const sigma = r / 2;
  const d = Math.max(0, Number(dMeters) || 0);
  if (d > r * 1.35) return 0;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

module.exports = {
  STATUS,
  clamp,
  theoreticalQueuePeople,
  defaultExpectedWaitMinutes,
  stressFactor,
  capacityLossPct,
  ridePressureScore,
  venuePressureScore,
  statusFromScore,
  distanceMeters,
  kernelWeight,
};
