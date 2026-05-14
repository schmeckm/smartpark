'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOtProfileId } = require('./attraction-oee-simulator-ot-extensions');

test('resolveOtProfileId maps known Europa-Park style slugs', () => {
  assert.equal(resolveOtProfileId('silver_star'), 'silver_star');
  assert.equal(resolveOtProfileId('blue_fire'), 'blue_fire');
  assert.equal(resolveOtProfileId('voltron_nevera_powered_by_rimac'), 'voltron');
  assert.equal(resolveOtProfileId('panorama_train_station_germany'), 'panorama_bahn');
  assert.equal(resolveOtProfileId('piraten_in_batavia'), 'piraten_batavia');
  assert.equal(resolveOtProfileId('euro_mir'), 'euro_mir');
  assert.equal(resolveOtProfileId('unknown_coaster_xyz'), null);
});
