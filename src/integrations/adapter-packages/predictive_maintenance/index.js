'use strict';

const {
  resolvePredictiveMaintenanceSimulatorConfig,
  ADAPTER_KEY,
} = require('../../../services/predictive-maintenance-demo-config.service');
const { runPdMDemoTelemetryPoll } = require('../../../services/predictive-maintenance-demo-poll.service');

async function validateConfig(mergedInstall, contextInstall) {
  const resolved = resolvePredictiveMaintenanceSimulatorConfig(contextInstall || {}, mergedInstall || {});
  if (!resolved.demoTelemetryEnabled) return { valid: true, errors: [] };
  if (!String(resolved.parkSlug || '').trim()) {
    return {
      valid: false,
      errors: ['demoTelemetryEnabled requires parkSlug (or sparkplugGroupId) in contextJson or configJson'],
    };
  }
  return { valid: true, errors: [] };
}

async function health(mergedInstall, contextInstall) {
  const resolved = resolvePredictiveMaintenanceSimulatorConfig(contextInstall || {}, mergedInstall || {});
  const mode = resolved.demoTelemetryEnabled ? 'demo_telemetry_configured' : 'noop';
  return {
    ok: true,
    message:
      resolved.demoTelemetryEnabled
        ? `${ADAPTER_KEY}: demo Sparkplug telemetry enabled (${resolved.demoMetricProfile}); omit demoTelemetryEnabled for noop`
        : `${ADAPTER_KEY} stub — PdM UI / APIs + Sparkplug ingestion; poll noop unless demoTelemetryEnabled`,
    mode,
    demoTelemetryEnabled: resolved.demoTelemetryEnabled,
  };
}

async function discover() {
  return [
    {
      id: 'predictive_maintenance_feature',
      name: 'Predictive maintenance rules & evaluations',
      entityType: 'PREDICTIVE_MAINTENANCE',
      domain: 'operations',
      suggestedSlug: 'pdm',
      metrics: [],
    },
  ];
}

/**
 * Default: noop (empty observations). Optional demo telemetry via configJson.demoTelemetryEnabled.
 * MQTT only via core OutputRouterService — never publish directly from this package.
 */
async function poll(config, context) {
  const demo = await runPdMDemoTelemetryPoll(config || {}, context || {});
  if (demo) return demo;

  return {
    observations: [],
    debug: {
      mode: 'noop',
      adapterKey: ADAPTER_KEY,
      demoTelemetryEnabled: false,
      simulated: false,
      presentationHint: 'feature_gate_only',
    },
  };
}

module.exports = { validateConfig, discover, poll, health };
