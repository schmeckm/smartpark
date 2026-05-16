'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePdHealthScore, resetParkDefaultScoringProfileCacheForTests } = require('./pdm-health-score.service');

test.after(() => {
  resetParkDefaultScoringProfileCacheForTests();
});

test('computePdHealthScore penalizes critical and rewards stable OK telemetry', () => {
  const profile = { weights: {}, healthStateBands: {} };
  const signals = [
    {
      metricName: 'motor_rpm',
      status: 'OK',
      telemetrySource: 'live',
      liveReceivedAt: new Date().toISOString(),
    },
  ];
  const trends = [{ metricName: 'motor_rpm', trend: 'STABLE' }];
  const out = computePdHealthScore(profile, {}, signals, trends);
  assert.ok(out.healthScore >= 85);
  assert.equal(out.healthState, 'OK');
});

test('computePdHealthScore: critical threshold drives low score', () => {
  const profile = {
    weights: { criticalViolation: 40 },
    healthStateBands: { criticalMax: 50, warningMax: 70, watchMax: 85 },
  };
  const signals = [
    { metricName: 'x', status: 'CRITICAL', telemetrySource: 'live', liveReceivedAt: new Date().toISOString() },
  ];
  const out = computePdHealthScore(profile, {}, signals, []);
  assert.ok(out.healthScore < 70);
});
