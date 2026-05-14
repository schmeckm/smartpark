'use strict';

const assert = require('assert');
const {
  resolveShowZone,
  qualityFromResolution,
  isValidZoneSlug,
  ZONE_QUALITY,
} = require('./show-zone-normalizer.service');
const { buildSparkplugDdataPreview, resolveSparkplugEdgeFromParkProfile } = require('./sparkplug-edge-resolver.service');

(async function testExactShowMatch() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Carnival in Venice',
    assetSlug: 'carnival_in_venice',
  });
  assert.equal(out.zoneSlug, 'italy');
  assert.equal(out.matchType, 'EXACT_NAME');
})();

(async function testVenueBasedMatchHasPriority() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Random Seasonal Title',
    assetSlug: 'random_seasonal_title',
    venueName: 'Globe Theatre',
  });
  assert.equal(out.zoneSlug, 'england');
  assert.equal(out.matchType, 'VENUE_HINT');
})();

(async function testSlugHintMatch() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Some Different Name',
    assetSlug: 'hellfire_fountains',
  });
  assert.equal(out.zoneSlug, 'austria');
  assert.equal(out.matchType, 'SLUG_HINT');
})();

(async function testKeywordHeuristicMatch() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Shakespeare Night at Globe',
    assetSlug: 'shakespeare_night',
  });
  assert.equal(out.zoneSlug, 'england');
  assert.equal(out.matchType, 'HEURISTIC_KEYWORD');
})();

(async function testLowConfidenceParadeMapping() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Summer Parade',
    assetSlug: 'summer_parade',
  });
  assert.equal(out.zoneSlug, 'germany');
  assert.equal(out.confidence, 'LOW');
  assert.equal(qualityFromResolution(out), ZONE_QUALITY.LOW_CONFIDENCE);
})();

(async function testNoMatchRemainsMissing() {
  const out = await resolveShowZone({
    parkId: 'europa-park',
    assetName: 'Unknown Show XYZ',
    assetSlug: 'unknown_show_xyz',
  });
  assert.equal(out.zoneSlug, null);
  assert.equal(qualityFromResolution(out), ZONE_QUALITY.MISSING);
})();

(function testGeneralZoneIsInvalid() {
  assert.equal(isValidZoneSlug('general'), false);
  assert.equal(isValidZoneSlug('europa_park-default'), false);
})();

(function testShowTopicPreviewUsesResolvedZoneEdge() {
  const edge = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: {
      sparkplug: {
        defaultEdgeNodeId: 'park_gateway',
        edges: [{ zoneKey: 'italy', edgeNodeId: 'italy_edge' }],
      },
    },
    zoneSlug: 'italy',
  });
  const topic = buildSparkplugDdataPreview({
    parkSlugForGroup: 'europa_park',
    edgeResolution: edge,
    assetSlug: 'carnival_in_venice',
  });
  assert.equal(topic, 'spBv1.0/europa_park/DDATA/italy_edge/carnival_in_venice');
})();
