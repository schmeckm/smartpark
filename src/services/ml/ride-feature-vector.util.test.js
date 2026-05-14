'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotToFeatureMap, applyMlFeatureMask, featureVectorFromMap } = require('./ride-feature-vector.util');

test('applyMlFeatureMask zeros only listed training keys', () => {
  const base = snapshotToFeatureMap({
    currentWaitTimeMin: 12,
    waitTime: 12,
    rollingAvgWait15m: 10,
    rollingAvgWait60m: 11,
    waitTimeDelta5m: 0,
    status: 'OPEN',
    isOpen: true,
    parkCrowdIndex: 40,
    xFeaturesExtras: {},
    snapshotAt: new Date('2026-01-15T14:00:00.000Z'),
    precipitationMm: 2,
    temperatureC: 18,
    isSchoolHoliday: false,
  });
  const masked = applyMlFeatureMask(base, new Set(['current_wait_time', 'rain_mm']));
  assert.equal(masked.current_wait_time, 0);
  assert.equal(masked.rain_mm, 0);
  assert.ok(masked.park_crowd_index > 0);
  const vec = featureVectorFromMap(masked);
  assert.ok(vec.length > 0);
  assert.equal(vec[0], 0);
});
