'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { clearFlagsCache } = require('../bootstrap/feature-flags');

test.afterEach(() => {
  clearFlagsCache();
});

test.beforeEach(() => {
  // proxyquire stubs apply only on first load; avoid picking up the real module from a prior test.
  const p = require.resolve('./pdm-evaluation-industrial.service');
  delete require.cache[p];
});

test('enrichIndustrialPdmEvaluation returns null when flag off', async () => {
  const { enrichIndustrialPdmEvaluation } = proxyquire('./pdm-evaluation-industrial.service', {});
  const out = await enrichIndustrialPdmEvaluation({
    baseEvaluation: { signals: [{ metricName: 'motor_rpm', status: 'OK' }] },
    assetPlain: { assetId: 'a', parkId: 'p' },
    parkSlug: 'psp',
    parkId: 'p',
  });
  assert.equal(out, null);
});

test('enrichIndustrialPdmEvaluation returns envelope when flag on', async () => {
  const { enrichIndustrialPdmEvaluation } = proxyquire('./pdm-evaluation-industrial.service', {
    '../bootstrap/feature-flags': {
      getFlags: () => ({ pdm: { industrialPlatformEnabled: true } }),
    },
    './mqtt-sparkplug-live-buffer.service': {
      listRecentSparkplugNumericSamples: () => [],
    },
    './pdm-sparkplug-edge-resolve.service': {
      resolvePdmSparkplugEdgeCandidatesForAsset: async () => ({
        resolvedEdgeNodeId: 'e1',
        edgeResolutionSource: 'HARDCODED',
        attemptedEdgeNodeIds: ['e1'],
        edgeCandidates: [],
        resolverReason: '',
        zoneSlug: null,
      }),
    },
    './pdm-sparkplug-visibility.service': {
      buildPdmSparkplugVisibility: async () => ({
        groupId: 'park',
        resolvedEdgeNodeId: 'e1',
        attemptedEdgeNodeIds: ['e1'],
        edgeCandidates: [],
        deviceIds: ['ride-x'],
        metricNames: ['motor_rpm'],
        topicPreview: [{ exampleTopic: 'spBv1.0/park/DDATA/e1/ride-x' }],
      }),
    },
  });

  const out = await enrichIndustrialPdmEvaluation({
    baseEvaluation: {
      riskLevel: 'LOW',
      signals: [
        {
          metricName: 'motor_rpm',
          status: 'OK',
          telemetrySource: 'simulated',
          sparkplugDeviceId: 'ride-x',
        },
      ],
    },
    assetPlain: {
      assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      parkId: '11111111-1111-1111-1111-111111111111',
      slug: 'ride-x',
      name: 'Ride',
    },
    parkSlug: 'psp',
    parkId: '11111111-1111-1111-1111-111111111111',
  });
  assert.ok(out && typeof out === 'object');
  assert.ok(typeof out.health?.healthScore === 'number');
  assert.ok(Array.isArray(out.metricTrends));
  assert.ok(Array.isArray(out.failureModes));
  assert.ok(out.sparkplugContext?.groupId);
});
