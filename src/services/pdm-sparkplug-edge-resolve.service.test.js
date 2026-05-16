'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPdmEdgeCandidateOrder } = require('./pdm-sparkplug-edge-resolve.service');

test('buildPdmEdgeCandidateOrder: zone edge first, then default, env, predictive_gateway', () => {
  const order = buildPdmEdgeCandidateOrder({
    zoneSlug: 'frankreich',
    defaultEdgeNodeId: 'park_gateway',
    edges: [
      { zoneKey: 'welt_der_kinder', edgeNodeId: 'wdk_edge' },
      { zoneKey: 'frankreich', edgeNodeId: 'frankreich' },
    ],
    envEdgeNode: 'env_only',
  });
  assert.deepEqual(
    order.map((o) => o.edgeNodeId),
    ['frankreich', 'park_gateway', 'env_only', 'predictive_gateway']
  );
  assert.equal(order[0].edgeResolutionSource, 'ZONE_MATCH');
  assert.equal(order[1].edgeResolutionSource, 'PARK_DEFAULT');
  assert.equal(order[2].edgeResolutionSource, 'ENV_FALLBACK');
});

test('buildPdmEdgeCandidateOrder: park default wins when no zone', () => {
  const order = buildPdmEdgeCandidateOrder({
    zoneSlug: null,
    defaultEdgeNodeId: 'main_gw',
    edges: [{ zoneKey: 'frankreich', edgeNodeId: 'frankreich' }],
    envEdgeNode: 'park_gateway',
  });
  assert.deepEqual(
    order.map((o) => o.edgeNodeId),
    ['main_gw', 'park_gateway', 'predictive_gateway']
  );
  assert.equal(order[0].edgeResolutionSource, 'PARK_DEFAULT');
});

test('buildPdmEdgeCandidateOrder: env used when no park default', () => {
  const order = buildPdmEdgeCandidateOrder({
    zoneSlug: null,
    defaultEdgeNodeId: null,
    edges: [],
    envEdgeNode: 'from_env',
  });
  assert.deepEqual(
    order.map((o) => o.edgeNodeId),
    ['from_env', 'predictive_gateway', 'park_gateway']
  );
  assert.equal(order[0].edgeResolutionSource, 'ENV_FALLBACK');
});

test('buildPdmEdgeCandidateOrder: predictive_gateway before park_gateway fallback', () => {
  const order = buildPdmEdgeCandidateOrder({
    zoneSlug: null,
    defaultEdgeNodeId: null,
    edges: [],
    envEdgeNode: '',
  });
  assert.deepEqual(
    order.map((o) => o.edgeNodeId),
    ['predictive_gateway', 'park_gateway']
  );
  assert.equal(order[1].edgeResolutionSource, 'HARDCODED');
});

test('buildPdmEdgeCandidateOrder: zone slug normalized matches zoneKey', () => {
  const order = buildPdmEdgeCandidateOrder({
    zoneSlug: 'Frankreich',
    defaultEdgeNodeId: 'park_gateway',
    edges: [{ zoneKey: 'frankreich', edgeNodeId: 'fr_edge' }],
    envEdgeNode: '',
  });
  assert.equal(order[0].edgeNodeId, 'fr_edge');
  assert.equal(order[0].edgeResolutionSource, 'ZONE_MATCH');
  assert.ok(order.some((o) => o.edgeNodeId === 'predictive_gateway'));
});
