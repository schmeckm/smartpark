'use strict';

const assert = require('assert');
const {
  resolveRestaurantZone,
  qualityFromResolution,
  isValidZoneSlug,
  ZONE_QUALITY,
} = require('./restaurant-zone-normalizer.service');

(async function testExactRestaurantMatch() {
  const out = await resolveRestaurantZone({
    parkId: 'europa-park',
    assetName: 'Pizzeria Venezia',
    assetSlug: 'pizzeria_venezia',
  });
  assert.equal(out.zoneSlug, 'italy');
  assert.equal(out.matchType, 'EXACT_NAME');
  assert.equal(out.confidence, 'HIGH');
})();

(async function testSlugHintMatch() {
  const out = await resolveRestaurantZone({
    parkId: 'europa-park',
    assetName: 'Some Name',
    assetSlug: 'the_omackays_cafe_and_pub',
  });
  assert.equal(out.zoneSlug, 'ireland');
  assert.equal(out.matchType, 'SLUG_HINT');
})();

(async function testKeywordHeuristicMatch() {
  const out = await resolveRestaurantZone({
    parkId: 'europa-park',
    assetName: 'Nordic Fjord Kitchen',
    assetSlug: 'nordic_fjord_kitchen',
  });
  assert.equal(out.zoneSlug, 'scandinavia');
  assert.equal(out.matchType, 'HEURISTIC');
})();

(async function testNoMatchRemainsMissing() {
  const out = await resolveRestaurantZone({
    parkId: 'europa-park',
    assetName: 'Unknown Eatery XYZ',
    assetSlug: 'unknown_eatery_xyz',
  });
  assert.equal(out.zoneSlug, null);
  assert.equal(qualityFromResolution(out), ZONE_QUALITY.MISSING);
})();

(function testGeneralZoneIsInvalid() {
  assert.equal(isValidZoneSlug('general'), false);
  assert.equal(isValidZoneSlug('europa_park-default'), false);
})();
