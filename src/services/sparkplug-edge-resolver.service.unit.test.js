'use strict';

const assert = require('assert');
const {
  parseSparkplugEdgesFromParkProfile,
  zonesMatchNormalized,
  resolveSparkplugEdgeFromParkProfile,
  resolveFallbackChain,
  buildSparkplugDdataPreview,
} = require('./sparkplug-edge-resolver.service');

function sampleProfile() {
  return {
    sparkplug: {
      defaultEdgeNodeId: 'park_default_edge',
      edges: [
        { zoneKey: 'iceland', edgeNodeId: 'iceland_edge', label: 'EP Iceland' },
        { zoneKey: 'germany', edgeNodeId: 'germany_edge' },
      ],
    },
  };
}

(function testParseAndZoneMatch() {
  const { defaultEdgeNodeId, edges } = parseSparkplugEdgesFromParkProfile(sampleProfile());
  assert.equal(defaultEdgeNodeId, 'park_default_edge');
  assert.equal(edges.length, 2);
  assert.ok(zonesMatchNormalized('iceland', ' Iceland '));
})();

(function testZoneMatchUsesEdge() {
  const r = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: sampleProfile(),
    zoneSlug: 'iceland',
  });
  assert.equal(r.edgeNodeId, 'iceland_edge');
  assert.equal(r.source, 'ZONE_MATCH');
  assert.equal(r.fallbackUsed, false);
})();

(function testZoneWithoutEdgeRowFallsBackDefault() {
  const r = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: sampleProfile(),
    zoneSlug: 'unknown_zone',
  });
  assert.equal(r.edgeNodeId, 'park_default_edge');
  assert.equal(r.source, 'ZONE_MISSING_EDGE_FALLBACK');
  assert.equal(r.fallbackUsed, true);
})();

(function testNoZoneUsesDefault() {
  const r = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: sampleProfile(),
    zoneSlug: null,
  });
  assert.equal(r.edgeNodeId, 'park_default_edge');
  assert.equal(r.source, 'PARK_DEFAULT');
})();

(function testExplicitOverridesInSyncHints() {
  const rInner = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: sampleProfile(),
    zoneSlug: 'iceland',
    sparkplugEdgesHint: [{ zoneKey: 'iceland', edgeNodeId: 'override_edge' }],
  });
  assert.equal(rInner.edgeNodeId, 'override_edge');
})();

(function testTopicPreview() {
  const topicPreview = buildSparkplugDdataPreview({
    parkSlugForGroup: 'europa_park',
    assetSlug: 'blue_fire',
    edgeResolution: { edgeNodeId: 'iceland_edge' },
  });
  assert.ok(topicPreview.startsWith('spBv1.0/'));
  assert.ok(topicPreview.includes('/DDATA/iceland_edge/blue_fire'));
})();

(function testRestaurantTopicPreviewUsesResolvedZoneEdge() {
  const r = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: {
      sparkplug: {
        defaultEdgeNodeId: 'park_default_edge',
        edges: [{ zoneKey: 'italy', edgeNodeId: 'italy_edge' }],
      },
    },
    zoneSlug: 'italy',
  });
  const topicPreview = buildSparkplugDdataPreview({
    parkSlugForGroup: 'europa_park',
    assetSlug: 'pizzeria_venezia',
    edgeResolution: r,
  });
  assert.ok(topicPreview.includes('/DDATA/italy_edge/pizzeria_venezia'));
})();
