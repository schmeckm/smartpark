'use strict';

/**
 * Pure helpers for PdM telemetry trend analysis (rolling slope, variability, spikes).
 */

/**
 * Ordinary least squares slope on index 0..n-1 vs values.
 * @param {number[]} values
 * @returns {number} slope per step (not time-normalized)
 */
function linearRegressionSlope(values) {
  const y = values.filter((v) => Number.isFinite(v));
  const n = y.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return 0;
  return (n * sumXY - sumX * sumY) / den;
}

/**
 * Sample coefficient of variation (std / mean), when |mean| is meaningful.
 * @param {number[]} values
 * @returns {number|null}
 */
function coefficientOfVariation(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (Math.abs(mean) < 1e-9) return null;
  const varSum = xs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(Math.max(0, varSum));
  if (sd === 0) return null;
  return sd / Math.abs(mean);
}

function median(xs) {
  const a = [...xs].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Count upward jumps larger than k * robust MAD of first differences.
 * @param {number[]} values
 */
function spikeCount(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 4) return 0;
  /** @type {number[]} */
  const d = [];
  for (let i = 1; i < v.length; i += 1) d.push(v[i] - v[i - 1]);
  const m = median(d);
  if (m == null) return 0;
  const absDev = d.map((x) => Math.abs(x - m)).sort((a, b) => a - b);
  const mid = Math.floor(absDev.length / 2);
  const mad = absDev.length % 2 ? absDev[mid] : (absDev[mid - 1] + absDev[mid]) / 2;
  const thresh = Math.max(mad * 6, 1e-6);
  let spikes = 0;
  for (const x of d) {
    if (x - m > thresh) spikes += 1;
  }
  return spikes;
}

/**
 * @param {Array<{ t: string; v: number }>} points chronological
 */
function valuesFromPoints(points) {
  return points.map((p) => p.v);
}

module.exports = {
  linearRegressionSlope,
  coefficientOfVariation,
  spikeCount,
  valuesFromPoints,
};
