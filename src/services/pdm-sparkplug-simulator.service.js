/**
 * Deterministic Sparkplug-style telemetry simulation for Predictive Maintenance demos
 * when no live MQTT has reached this process yet.
 *
 * Values are pure functions of { assetId, metricName, timestampBucket } — no Math.random().
 */
'use strict';

const crypto = require('crypto');

/**
 * @typedef {{ metricName: string; lo: number; hi: number; periodMin: number; decimals: number }} PdmSimMetricDef
 */

/** @type {ReadonlyArray<PdmSimMetricDef>} */
const PDM_SIM_METRIC_DEFS = Object.freeze([
  { metricName: 'motor_rpm', lo: 600, hi: 1800, periodMin: 47, decimals: 0 },
  { metricName: 'pump_rpm', lo: 900, hi: 3200, periodMin: 41, decimals: 0 },
  { metricName: 'motor_power_kw', lo: 5, hi: 120, periodMin: 31, decimals: 1 },
  { metricName: 'bearing_vibration_mm_s', lo: 0.05, hi: 8.0, periodMin: 53, decimals: 3 },
  { metricName: 'water_flow_l_min', lo: 10, hi: 300, periodMin: 37, decimals: 1 },
  { metricName: 'hydraulic_pressure_bar', lo: 20, hi: 180, periodMin: 43, decimals: 1 },
  { metricName: 'oil_temperature_c', lo: 25, hi: 95, periodMin: 59, decimals: 1 },
]);

const METRIC_DEF_BY_NAME = new Map(PDM_SIM_METRIC_DEFS.map((d) => [d.metricName, d]));

const PDM_SIM_METRIC_NAMES = Object.freeze(PDM_SIM_METRIC_DEFS.map((d) => d.metricName));

function hashUnitInterval(assetId, salt) {
  const h = crypto.createHash('sha256').update(`${String(assetId || '')}\0${salt}`, 'utf8').digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

function roundDecimals(v, decimals) {
  const d = Math.max(0, Math.min(6, Number(decimals) || 0));
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/**
 * Mid-range sinusoid + harmonic noise + rare deterministic spike (same bucket across requests).
 * @param {string} assetId
 * @param {string} metricName
 * @param {number} tMs
 */
function pdmSimNumericAt(assetId, metricName, tMs) {
  const def = METRIC_DEF_BY_NAME.get(String(metricName || '').trim());
  if (!def) return null;
  const aid = String(assetId || '');
  const mid = (def.lo + def.hi) / 2;
  const amp = (def.hi - def.lo) / 2;
  const phase = hashUnitInterval(aid, def.metricName) * Math.PI * 2;
  const tuney = hashUnitInterval(aid, `${def.metricName}:tune`);
  const periodMs = def.periodMin * 60 * 1000 * (0.85 + 0.3 * tuney);
  const theta = (tMs / periodMs) * Math.PI * 2 + phase;
  const wave = Math.sin(theta) * amp + Math.sin(theta * 2.1) * (amp * 0.18);
  const bucketMs = 8 * 60 * 1000;
  const slot = Math.floor(tMs / bucketMs);
  const spikeSalt = hashUnitInterval(aid, `${def.metricName}:spike:${slot}`);
  let v = mid + wave;
  if (spikeSalt > 0.985) {
    v += amp * (1.4 + spikeSalt * 0.5);
  }
  const softHi = def.hi * 1.06;
  const softLo = def.lo * 0.97;
  v = Math.max(softLo, Math.min(softHi, v));
  return roundDecimals(v, def.decimals);
}

function isPdSimMetricName(metricName) {
  return METRIC_DEF_BY_NAME.has(String(metricName || '').trim());
}

/**
 * @param {string} assetId
 * @param {string} sparkplugDeviceId
 * @returns {Array<{ metricName: string; sparkplugDeviceId: string; lastReceivedAt: string; lastValue: number; source: 'simulated' }>}
 */
function buildSimulatedSparkplugMetricRows(assetId, sparkplugDeviceId) {
  const dev = String(sparkplugDeviceId || '').trim() || 'ride';
  const now = Date.now();
  const iso = new Date(now).toISOString();
  return PDM_SIM_METRIC_DEFS.map((d) => ({
    metricName: d.metricName,
    sparkplugDeviceId: dev,
    lastReceivedAt: iso,
    lastValue: pdmSimNumericAt(assetId, d.metricName, now),
    source: /** @type {const} */ ('simulated'),
  }));
}

/**
 * @param {string} assetId
 * @param {string} metricName
 * @param {{ points?: number; stepSeconds?: number; endMs?: number }} [opts]
 * @returns {Array<{ t: string; v: number }>}
 */
function buildSimulatedSparkplugSeries(assetId, metricName, opts = {}) {
  const m = String(metricName || '').trim();
  if (!isPdSimMetricName(m)) return [];
  const points = Math.min(240, Math.max(12, Number(opts.points) || 72));
  const stepSec = Math.min(3600, Math.max(30, Number(opts.stepSeconds) || 300));
  const endMs = Number.isFinite(Number(opts.endMs)) ? Number(opts.endMs) : Date.now();
  const stepMs = stepSec * 1000;
  /** @type {Array<{ t: string; v: number }>} */
  const out = [];
  for (let i = points - 1; i >= 0; i -= 1) {
    const t = endMs - i * stepMs;
    const v = pdmSimNumericAt(assetId, m, t);
    if (v == null) continue;
    out.push({ t: new Date(t).toISOString(), v });
  }
  return out;
}

module.exports = {
  PDM_SIM_METRIC_DEFS,
  PDM_SIM_METRIC_NAMES,
  pdmSimNumericAt,
  isPdSimMetricName,
  buildSimulatedSparkplugMetricRows,
  buildSimulatedSparkplugSeries,
};
