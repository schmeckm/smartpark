'use strict';

/**
 * Phase 6 pilot activation — eligibility rules (no DB).
 *
 * Manual validation:
 * - Activate ride A UNS / Sparkplug; ride B prepared rows stay inactive (different payload rideAssetId / ride_asset_id).
 * - Activation skips MIRRORED_FROM_LEGACY (queries filter PREPARED_OPERATOR only).
 * - Deactivate sets is_active=false; rows remain; uns_nodes / uns_latest_states unchanged (no code paths touch them).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isActivationEligibleUns, isActivationEligibleSparkplug } = require('./ride-signal-capability.service');

test('UNS activation requires topic-backed capability sources', () => {
  assert.equal(isActivationEligibleUns('MANUAL'), true);
  assert.equal(isActivationEligibleUns('MQTT_EDGE'), true);
  assert.equal(isActivationEligibleUns('NOT_AVAILABLE'), false);
  assert.equal(isActivationEligibleUns('MASTER_DATA'), false);
});

test('Sparkplug activation requires MQTT_EDGE capability', () => {
  assert.equal(isActivationEligibleSparkplug('MQTT_EDGE'), true);
  assert.equal(isActivationEligibleSparkplug('MANUAL'), false);
});
