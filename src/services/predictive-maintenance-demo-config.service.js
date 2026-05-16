'use strict';

const env = require('../config/env');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { mergeAdapterInstallConfig } = require('../utils/adapter-install-config-merge');
const { PDM_SIM_METRIC_NAMES } = require('./pdm-sparkplug-simulator.service');

const ADAPTER_KEY = 'predictive_maintenance';
const DEFAULT_SPARKPLUG_EDGE = 'predictive_gateway';

/** Profile → ordered metric list (deterministic catalog). */
const PROFILE_METRICS = Object.freeze({
  standard_pdm: ['motor_rpm', 'pump_rpm', 'motor_power_kw', 'bearing_vibration_mm_s'],
  extended_pdm: [...PDM_SIM_METRIC_NAMES],
});

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function coerceDemoBool(v) {
  if (v === true || v === false) return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return null;
}

function hasDemoKey(obj) {
  return obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, 'demoTelemetryEnabled');
}

function pickDemoTelemetryEnabled(layered) {
  const o = layered && typeof layered === 'object' ? layered : {};
  if (hasDemoKey(o)) {
    const c = coerceDemoBool(o.demoTelemetryEnabled);
    return c === null ? false : c;
  }
  const e = trim(process.env.PDM_DEMO_TELEMETRY_ENABLED);
  if (e !== '') {
    const c = coerceDemoBool(process.env.PDM_DEMO_TELEMETRY_ENABLED);
    return c === null ? false : c;
  }
  return false;
}

function pickParkSlug(layered) {
  const o = layered && typeof layered === 'object' ? layered : {};
  return trim(o.parkSlug) || trim(o.sparkplugGroupId) || '';
}

/**
 * Merge semantics:
 * - `mergedInstall` is typically `{ ...contextJson, ...configJson }` (config wins on overlaps).
 * - `contextRaw` is reapplied last so **contextJson overrides configJson** for demo keys (operator intent).
 *
 * Resolution tail: environment variables → hardcoded defaults (handled per-field).
 *
 * @param {Record<string, unknown>} contextRaw install contextJson
 * @param {Record<string, unknown>} mergedInstall merged install blob / config layer
 */
function resolvePredictiveMaintenanceSimulatorConfig(contextRaw = {}, mergedInstall = {}) {
  const ctx = contextRaw && typeof contextRaw === 'object' ? contextRaw : {};
  const merged = mergedInstall && typeof mergedInstall === 'object' ? mergedInstall : {};
  const layered = { ...merged, ...ctx };

  const demoTelemetryEnabled = pickDemoTelemetryEnabled(layered);
  const parkSlug = pickParkSlug(layered);

  const profileRaw = trim(layered.demoMetricProfile) || 'standard_pdm';
  const demoMetricProfile = profileRaw || 'standard_pdm';

  const maxFromLayered = Number(layered.maxAssets);
  const maxFromEnv = Number(process.env.PDM_DEMO_MAX_ASSETS);
  let maxAssets = 50;
  if (Number.isFinite(maxFromLayered) && maxFromLayered > 0) maxAssets = Math.min(500, Math.floor(maxFromLayered));
  else if (Number.isFinite(maxFromEnv) && maxFromEnv > 0) maxAssets = Math.min(500, Math.floor(maxFromEnv));

  const scanEntityTypes = normalizeScanEntityTypes(layered.scanEntityTypes);

  const sparkplugGroupId =
    trim(layered.sparkplugGroupId) ||
    (parkSlug ? slugifyName(parkSlug) : '') ||
    trim(env.sparkplugGroupId);

  let sparkplugEdgeNode = trim(layered.sparkplugEdgeNode);
  if (demoTelemetryEnabled && !sparkplugEdgeNode) {
    sparkplugEdgeNode = trim(process.env.PDM_DEMO_SPARKPLUG_EDGE_NODE) || DEFAULT_SPARKPLUG_EDGE;
  }

  const metrics = resolveMetricList(layered.metrics, demoMetricProfile);

  return {
    demoTelemetryEnabled,
    parkSlug,
    demoMetricProfile,
    metrics,
    maxAssets,
    scanEntityTypes,
    sparkplugGroupId,
    sparkplugEdgeNode,
    adapterKey: ADAPTER_KEY,
    defaultSparkplugEdge: DEFAULT_SPARKPLUG_EDGE,
  };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeScanEntityTypes(raw) {
  const fallback = ['ride', 'attraction'];
  if (!Array.isArray(raw) || !raw.length) return [...fallback];
  const map = new Map([
    ['ride', 'RIDE'],
    ['attraction', 'ATTRACTION'],
    ['show', 'SHOW'],
    ['restaurant', 'RESTAURANT'],
  ]);
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const k = trim(x).toLowerCase();
    const upper = map.get(k) || trim(x).toUpperCase();
    if (!upper || seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out.length ? out : ['RIDE', 'ATTRACTION'];
}

/**
 * @param {unknown} metricsRaw
 * @param {string} profile
 */
function resolveMetricList(metricsRaw, profile) {
  const allowed = new Set(PDM_SIM_METRIC_NAMES);
  if (Array.isArray(metricsRaw) && metricsRaw.length) {
    return [...new Set(metricsRaw.map((m) => trim(String(m))).filter((m) => m && allowed.has(m)))];
  }
  const p = PROFILE_METRICS[profile] ? profile : 'standard_pdm';
  return [...PROFILE_METRICS[p]];
}

/**
 * MQTT encode context: fills Sparkplug gaps when demo telemetry is enabled.
 * @param {Record<string, unknown>} installContext
 * @param {Record<string, unknown>} installConfig
 */
function mergePredictiveMaintenancePollEmitContext(installContext = {}, installConfig = {}) {
  const ctxCopy = installContext && typeof installContext === 'object' ? { ...installContext } : {};
  const cfg = installConfig && typeof installConfig === 'object' ? installConfig : {};
  const merged = mergeAdapterInstallConfig(ctxCopy, cfg);
  const resolved = resolvePredictiveMaintenanceSimulatorConfig(ctxCopy, merged);

  if (!resolved.demoTelemetryEnabled) return ctxCopy;

  if (!trim(ctxCopy.sparkplugEdgeNode) && !trim(cfg.sparkplugEdgeNode)) {
    ctxCopy.sparkplugEdgeNode = resolved.sparkplugEdgeNode || DEFAULT_SPARKPLUG_EDGE;
  }
  if (!trim(ctxCopy.sparkplugGroupId) && !trim(cfg.sparkplugGroupId) && resolved.sparkplugGroupId) {
    ctxCopy.sparkplugGroupId = resolved.sparkplugGroupId;
  }
  return ctxCopy;
}

module.exports = {
  resolvePredictiveMaintenanceSimulatorConfig,
  mergePredictiveMaintenancePollEmitContext,
  PROFILE_METRICS,
  DEFAULT_SPARKPLUG_EDGE,
  ADAPTER_KEY,
};
