'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePredictiveMaintenanceSimulatorConfig,
  mergePredictiveMaintenancePollEmitContext,
} = require('./predictive-maintenance-demo-config.service');
const { mergeAdapterInstallConfig } = require('../utils/adapter-install-config-merge');

test('resolvePredictiveMaintenanceSimulatorConfig defaults — noop', () => {
  const r = resolvePredictiveMaintenanceSimulatorConfig({}, {});
  assert.equal(r.demoTelemetryEnabled, false);
  assert.ok(Array.isArray(r.metrics));
});

test('context demoTelemetryEnabled overrides merged install config flag', () => {
  const merged = mergeAdapterInstallConfig({ demoTelemetryEnabled: false }, {});
  const r = resolvePredictiveMaintenanceSimulatorConfig({ demoTelemetryEnabled: true, parkSlug: 'x_park' }, merged);
  assert.equal(r.demoTelemetryEnabled, true);
});

test('mergePredictiveMaintenancePollEmitContext fills predictive_gateway when demo on', () => {
  const ctx = mergePredictiveMaintenancePollEmitContext(
    { parkSlug: 'ab_park' },
    { demoTelemetryEnabled: true, parkSlug: 'ab_park' }
  );
  assert.equal(ctx.sparkplugEdgeNode, 'predictive_gateway');
});

test('mergePredictiveMaintenancePollEmitContext noop leaves sparkplug untouched when demo off', () => {
  const ctx = mergePredictiveMaintenancePollEmitContext({ parkSlug: 'ab_park', sparkplugEdgeNode: 'custom_edge' }, {});
  assert.equal(ctx.sparkplugEdgeNode, 'custom_edge');
});
