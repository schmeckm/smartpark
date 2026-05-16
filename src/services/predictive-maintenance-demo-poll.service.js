'use strict';

const {
  resolvePredictiveMaintenanceSimulatorConfig,
  ADAPTER_KEY,
} = require('./predictive-maintenance-demo-config.service');
const { mergeAdapterInstallConfig } = require('../utils/adapter-install-config-merge');
const { scanRideAssetsForPdMDemo } = require('./predictive-maintenance-demo-scan.service');
const { pdmSimNumericAt } = require('./pdm-sparkplug-simulator.service');

const METRIC_UNITS = Object.freeze({
  motor_rpm: 'rpm',
  pump_rpm: 'rpm',
  motor_power_kw: 'kW',
  bearing_vibration_mm_s: 'mm/s',
  water_flow_l_min: 'l/min',
  hydraulic_pressure_bar: 'bar',
  oil_temperature_c: '°C',
});

/**
 * Pure observation builder for tests / deterministic checks.
 * @param {Array<{ assetId: string; slug: string; name?: string }>} assets
 * @param {ReturnType<typeof resolvePredictiveMaintenanceSimulatorConfig>} resolved
 * @param {number} tMs
 */
function buildPdMDemoObservations(assets, resolved, tMs) {
  const eventTime = new Date(tMs).toISOString();
  /** @type {Array<Record<string, unknown>>} */
  const observations = [];

  for (const asset of assets || []) {
    const assetId = String(asset.assetId || '').trim();
    const assetSlug = String(asset.slug || '').trim() || 'asset';
    if (!assetId) continue;

    for (const metric of resolved.metrics || []) {
      const value = pdmSimNumericAt(assetId, metric, tMs);
      if (value == null || !Number.isFinite(Number(value))) continue;

      observations.push({
        eventType: 'PDM_DEMO_TELEMETRY',
        domain: 'operations',
        assetSlug,
        metric,
        value,
        unit: METRIC_UNITS[metric] ?? null,
        eventTime,
        quality: 'GOOD',
        confidence: null,
        source: 'pdm_demo_simulator',
        provider: 'predictive_maintenance_demo',
        externalEntityId: assetId,
        metadata: {
          simulated: true,
          syntheticDemo: true,
          demoLabel: 'DEMO_SYNTHETIC',
          adapterKey: ADAPTER_KEY,
          assetId,
          metricProfile: resolved.demoMetricProfile,
          presentationHint: 'demo_simulated_not_production',
        },
        rawPayload: {
          demoTelemetry: true,
          simulated: true,
          metricProfile: resolved.demoMetricProfile,
          adapterKey: ADAPTER_KEY,
        },
      });
    }
  }

  return observations;
}

/**
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} context
 * @param {{ nowMs?: number; scanFn?: typeof scanRideAssetsForPdMDemo }} [deps]
 */
async function runPdMDemoTelemetryPoll(config, context, deps = {}) {
  const merged = mergeAdapterInstallConfig(config, context);
  const resolved = resolvePredictiveMaintenanceSimulatorConfig(context || {}, merged);
  if (!resolved.demoTelemetryEnabled) {
    return null;
  }

  const scan = deps.scanFn || scanRideAssetsForPdMDemo;
  const nowMs = Number.isFinite(Number(deps.nowMs)) ? Number(deps.nowMs) : Date.now();

  const assets = await scan(resolved);
  const observations = buildPdMDemoObservations(assets, resolved, nowMs);

  return {
    observations,
    debug: {
      mode: 'demo_telemetry',
      adapterKey: ADAPTER_KEY,
      assetCount: assets.length,
      observationCount: observations.length,
      metricNames: [...resolved.metrics],
      sparkplugGroupId: resolved.sparkplugGroupId || null,
      sparkplugEdgeNode: resolved.sparkplugEdgeNode || null,
      simulated: true,
      demoTelemetryEnabled: true,
      demoMetricProfile: resolved.demoMetricProfile,
      presentationHint: 'demo_simulated_not_production',
    },
  };
}

module.exports = {
  METRIC_UNITS,
  buildPdMDemoObservations,
  runPdMDemoTelemetryPoll,
};
