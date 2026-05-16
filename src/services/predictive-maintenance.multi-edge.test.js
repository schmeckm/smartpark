'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const realPdmEdgeResolve = require('./pdm-sparkplug-edge-resolve.service');

const mockAsset = {
  get(opts) {
    if (opts && opts.plain) {
      return {
        assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        parkId: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
        name: 'Ride X',
        slug: 'ride-x',
      };
    }
    return null;
  },
};

const mockPark = {
  id: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
  slug: 'psp',
  name: 'Park',
  get(k) {
    if (k === 'masterProfile') return {};
    return this[k];
  },
};

function baseMocks(listImpl) {
  return {
    './pdm-sparkplug-edge-resolve.service': {
      ...realPdmEdgeResolve,
      resolvePdmSparkplugEdgeCandidatesForAsset: async () => ({
        resolvedEdgeNodeId: 'zone_edge',
        edgeResolutionSource: 'ZONE_MATCH',
        attemptedEdgeNodeIds: ['zone_edge', 'park_gateway'],
        edgeCandidates: [
          { edgeNodeId: 'zone_edge', edgeResolutionSource: 'ZONE_MATCH' },
          { edgeNodeId: 'park_gateway', edgeResolutionSource: 'HARDCODED' },
        ],
        resolverReason: 'test',
        zoneSlug: 'z1',
      }),
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestSparkplugLiveMetricRow: () => null,
      listRecentSparkplugNumericSamples: () => [],
      listSparkplugMetricsForDevices:
        listImpl ||
        ((p) => {
          if (p.edgeNodeId === 'zone_edge') return [];
          if (p.edgeNodeId === 'park_gateway') {
            return [
              {
                metricName: 'live_metric',
                sparkplugDeviceId: 'ride-x',
                lastReceivedAt: '2026-01-01T00:00:00.000Z',
                lastValue: 42,
              },
            ];
          }
          return [];
        }),
    },
    './pdm-sparkplug-simulator.service': {
      pdmSimNumericAt: () => 1,
      isPdSimMetricName: () => false,
      buildSimulatedSparkplugMetricRows: () => [{ metricName: 'sim', sparkplugDeviceId: 'x', lastReceivedAt: '', lastValue: 0 }],
      buildSimulatedSparkplugSeries: () => [],
    },
    '../models': {
      ParkAsset: { findOne: async () => mockAsset },
      Park: { findByPk: async () => mockPark },
      ParkAssetPdmRule: {},
      ParkAssetPdmEvaluationLog: {},
    },
  };
}

test('listKnownLiveSparkplugMetricsForAsset: live on secondary edge wins — no simulatedFallback', async () => {
  const { listKnownLiveSparkplugMetricsForAsset } = proxyquire('./pdm-sparkplug-asset-live.service', baseMocks());
  const out = await listKnownLiveSparkplugMetricsForAsset(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'pppppppp-pppp-pppp-pppp-pppppppppppp'
  );
  assert.equal(out.simulatedFallback, false);
  assert.equal(out.metrics.length, 1);
  assert.equal(out.metrics[0].metricName, 'live_metric');
  assert.equal(out.resolvedEdgeNodeId, 'zone_edge');
  assert.equal(out.edgeResolutionSource, 'ZONE_MATCH');
  assert.ok(Array.isArray(out.attemptedEdgeNodeIds));
});

test('listKnownLiveSparkplugMetricsForAsset: simulated only when all edges empty', async () => {
  const { listKnownLiveSparkplugMetricsForAsset } = proxyquire(
    './predictive-maintenance.service',
    baseMocks(() => [])
  );
  const withSim = proxyquire('./pdm-sparkplug-asset-live.service', {
    ...baseMocks(() => []),
    './pdm-sparkplug-simulator.service': {
      pdmSimNumericAt: () => 1,
      isPdSimMetricName: () => true,
      buildSimulatedSparkplugMetricRows: (aid, dev) => [
        { metricName: 'motor_rpm', sparkplugDeviceId: dev, lastReceivedAt: '2026-01-01T00:00:00.000Z', lastValue: 100 },
      ],
      buildSimulatedSparkplugSeries: () => [],
    },
  });
  const out = await withSim.listKnownLiveSparkplugMetricsForAsset(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'pppppppp-pppp-pppp-pppp-pppppppppppp'
  );
  assert.equal(out.simulatedFallback, true);
  assert.ok(out.metrics.some((m) => m.metricName === 'motor_rpm'));
});

test('resolveSparkplugMetricForAsset: probes edges in order until live hit', async () => {
  let seen = [];
  const { resolveSparkplugMetricForAsset } = proxyquire('./predictive-maintenance.service', {
    './pdm-sparkplug-edge-resolve.service': {
      ...realPdmEdgeResolve,
      resolvePdmSparkplugEdgeCandidatesForAsset: async () => ({
        resolvedEdgeNodeId: 'zone_edge',
        edgeResolutionSource: 'ZONE_MATCH',
        attemptedEdgeNodeIds: ['bad_edge', 'good_edge'],
        edgeCandidates: [],
        resolverReason: '',
        zoneSlug: null,
      }),
    },
    './mqtt-sparkplug-live-buffer.service': {
      listSparkplugMetricsForDevices: () => [],
      listRecentSparkplugNumericSamples: () => [],
      findLatestSparkplugLiveMetricRow: (p) => {
        seen.push(p.edgeNodeId);
        if (p.edgeNodeId === 'good_edge') return { value: 7, receivedAt: '2026-01-02T00:00:00.000Z' };
        return null;
      },
    },
    './pdm-sparkplug-simulator.service': {
      pdmSimNumericAt: () => null,
      isPdSimMetricName: () => false,
      buildSimulatedSparkplugMetricRows: () => [],
      buildSimulatedSparkplugSeries: () => [],
    },
    '../models': {
      ParkAsset: {},
      ParkAssetPdmRule: {},
      Park: {},
      ParkAssetPdmEvaluationLog: {},
    },
  });

  const plain = {
    assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    parkId: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    slug: 'ride-x',
    name: 'Ride X',
  };
  const out = await resolveSparkplugMetricForAsset(plain, 'psp', 'm1');
  assert.equal(out.value, 7);
  assert.equal(out.resolvedEdgeNodeId, 'good_edge');
  assert.equal(out.telemetrySource, 'live');
  assert.ok(seen.includes('bad_edge'));
  assert.ok(seen.includes('good_edge'));
  assert.ok(seen.indexOf('good_edge') > seen.indexOf('bad_edge'));
});
