'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPdMDemoObservations,
  runPdMDemoTelemetryPoll,
} = require('./predictive-maintenance-demo-poll.service');

test('buildPdMDemoObservations is deterministic', () => {
  const resolved = {
    demoTelemetryEnabled: true,
    demoMetricProfile: 'standard_pdm',
    metrics: ['motor_rpm', 'pump_rpm'],
    maxAssets: 2,
    scanEntityTypes: ['RIDE'],
    sparkplugGroupId: 'gp',
    sparkplugEdgeNode: 'predictive_gateway',
    adapterKey: 'predictive_maintenance',
    defaultSparkplugEdge: 'predictive_gateway',
    parkSlug: 'demo',
  };
  const assets = [
    { assetId: 'a1111111-1111-1111-1111-111111111111', slug: 'ride_one' },
    { assetId: 'b2222222-2222-2222-2222-222222222222', slug: 'ride_two' },
  ];
  const t = 1_720_000_000_000;
  const o1 = buildPdMDemoObservations(assets, resolved, t);
  const o2 = buildPdMDemoObservations(assets, resolved, t);
  assert.deepEqual(o1, o2);
  assert.equal(o1.length, 4);
  assert.ok(o1.every((x) => x.metadata && x.metadata.simulated === true));
  assert.ok(o1.every((x) => x.source === 'pdm_demo_simulator'));
});

test('runPdMDemoTelemetryPoll respects maxAssets via stub scan', async () => {
  const mergedConfig = { demoTelemetryEnabled: true, parkSlug: 'demo_park', maxAssets: 2 };
  const stubAssets = Array.from({ length: 5 }).map((_, i) => ({
    assetId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    slug: `ride_${i}`,
  }));
  const res = await runPdMDemoTelemetryPoll(mergedConfig, {}, {
    scanFn: async () => stubAssets.slice(0, 2),
    nowMs: 1_720_000_000_000,
  });
  assert.ok(res);
  assert.equal(res.debug.assetCount, 2);
  assert.equal(res.observations.length, 8);
});

test('runPdMDemoTelemetryPoll returns null when demo disabled', async () => {
  const res = await runPdMDemoTelemetryPoll({}, {}, { scanFn: async () => [{ assetId: 'x', slug: 'y' }] });
  assert.equal(res, null);
});
