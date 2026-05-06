'use strict';

/**
 * Manual DB validation (after `npm run db:migrate`):
 * 1. Pick two RIDE park_assets A and B in the same park; set MQTT_EDGE on the same signal_catalog row for both via PUT.
 * 2. POST prepare-sparkplug-metrics for A, then for B.
 * 3. `SELECT id, ride_asset_id, signal_key, metric_name FROM sparkplug_metric_definitions
 *     WHERE registry_source = 'PREPARED_OPERATOR' AND signal_key = '<code>'`
 *    → two rows (distinct ride_asset_id).
 * 4. POST prepare-sparkplug-metrics for A again → updates only A’s row (same id, updated_at moves); B unchanged.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparedSparkplugScopeWhere, REGISTRY_SOURCE_OPERATOR } = require('./ride-signal-capability.service');

test('preparedSparkplugScopeWhere is unique per park + ride asset + signal (not metric_name alone)', () => {
  const parkId = '11111111-1111-1111-1111-111111111111';
  const rideA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const rideB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const wA = preparedSparkplugScopeWhere({ parkId, assetId: rideA }, 'throughput');
  const wB = preparedSparkplugScopeWhere({ parkId, assetId: rideB }, 'throughput');
  assert.notDeepEqual(wA, wB);
  assert.equal(wA.signalKey, 'throughput');
  assert.equal(wB.signalKey, 'throughput');
  assert.equal(wA.rideAssetId, rideA);
  assert.equal(wB.rideAssetId, rideB);
  assert.equal(wA.registrySource, 'PREPARED_OPERATOR');
});

test('REGISTRY_SOURCE_OPERATOR constant unchanged for capability writes', () => {
  assert.equal(REGISTRY_SOURCE_OPERATOR, 'OPERATOR_CONFIGURED');
});
