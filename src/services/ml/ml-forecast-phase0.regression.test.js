'use strict';

/**
 * Phase 0 “freeze”: fixed inputs → fixed outputs for the rule-based ride baseline path.
 * If these assertions fail after a change, the ML/forecast refactor likely altered semantics;
 * update deliberately and document (ADR / changelog).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotToFeatureMap, featureVectorFromMap, TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');
const { baselineForecastFromSnapshot } = require('./ride-baseline-forecast.service');

const REGRESSION_SNAPSHOT = {
  currentWaitTimeMin: 20,
  waitTime: 20,
  rollingAvgWait15m: 18,
  rollingAvgWait60m: 22,
  waitTimeDelta5m: 0,
  status: 'OPEN',
  isOpen: true,
  parkCrowdIndex: 50,
  xFeaturesExtras: { zoneCongestionScore: 30 },
  snapshotAt: new Date('2026-06-01T14:30:00.000Z'),
  precipitationMm: 2,
  temperatureC: 22,
  isSchoolHoliday: false,
};

test('regression (Phase 0): snapshotToFeatureMap golden shape for REGRESSION_SNAPSHOT', () => {
  const m = snapshotToFeatureMap(REGRESSION_SNAPSHOT);
  assert.deepEqual(m, {
    current_wait_time: 20,
    wait_time_trend_30m: 4,
    ride_status_num: 1,
    park_crowd_index: 50,
    zone_congestion_score: 30,
    rain_mm: 2,
    temperature_c: 22,
    school_holiday: 0,
    time_of_day: 14.5,
  });
  assert.deepEqual(Object.keys(m), TRAINING_FEATURE_NAMES);
});

test('regression (Phase 0): feature vector order matches TRAINING_FEATURE_NAMES', () => {
  const m = snapshotToFeatureMap(REGRESSION_SNAPSHOT);
  const vec = featureVectorFromMap(m);
  assert.equal(vec.length, TRAINING_FEATURE_NAMES.length);
  for (let i = 0; i < TRAINING_FEATURE_NAMES.length; i++) {
    assert.equal(vec[i], m[TRAINING_FEATURE_NAMES[i]]);
  }
});

test('regression (Phase 0): baselineForecastFromSnapshot golden horizons', () => {
  const out = baselineForecastFromSnapshot(REGRESSION_SNAPSHOT, { horizons: [15, 30, 60] });
  assert.equal(out.predictionMode, 'BASELINE_ONLY');
  assert.equal(out.modelId, null);
  assert.equal(out.confidence, 0.45);
  assert.deepEqual(
    out.predictions.map((p) => ({ h: p.horizonMinutes, v: p.value, src: p.source })),
    [
      { h: 15, v: 22, src: 'BASELINE' },
      { h: 30, v: 24, src: 'BASELINE' },
      { h: 60, v: 28.8, src: 'BASELINE' },
    ]
  );
  assert.deepEqual(
    out.topFactors.map((t) => t.feature),
    ['zone_congestion_score', 'current_wait_time', 'wait_time_trend_30m', 'rain_mm']
  );
});
