'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickRegistryModelIdFromTrace,
  buildLearnedCoefficientsView,
} = require('./ml-learned-coefficients-view.util');
const { TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');

test('pickRegistryModelIdFromTrace prefers 60m ML result', () => {
  const trace = { modelVersion: 'trace_fallback_id' };
  const results = [
    { horizonMinutes: 15, modelName: 'm15' },
    { horizonMinutes: 60, modelName: 'm60' },
  ];
  assert.equal(pickRegistryModelIdFromTrace(trace, results), 'm60');
});

test('pickRegistryModelIdFromTrace skips closed_period_forecast', () => {
  const trace = { modelVersion: 'mv1' };
  const results = [{ horizonMinutes: 60, modelName: 'closed_period_forecast' }];
  assert.equal(pickRegistryModelIdFromTrace(trace, results), 'mv1');
});

test('pickRegistryModelIdFromTrace skips baseline_forecast', () => {
  const trace = { modelVersion: 'mv1' };
  const results = [{ horizonMinutes: 60, modelName: 'baseline_forecast' }];
  assert.equal(pickRegistryModelIdFromTrace(trace, results), 'mv1');
});

test('buildLearnedCoefficientsView ranks by absolute coefficient', () => {
  const names = TRAINING_FEATURE_NAMES.slice(0, 3);
  const payload = {
    kind: 'ridge_v1',
    featureNames: names,
    weights: [0.5, -2, 0.1, 1.5],
  };
  const reg = { horizonMinutes: 60, modelType: 'GLOBAL_RIDE_MODEL', scopeType: 'global', scopeId: null };
  const v = buildLearnedCoefficientsView(payload, 'mid-test', reg);
  assert.ok(v);
  assert.equal(v.rows[0].feature, names[0]);
  assert.equal(v.rows[0].absImpactRank, 1);
  assert.equal(v.rows[0].direction, 'negative');
  assert.equal(v.rows[1].feature, names[2]);
  assert.equal(v.rows[1].direction, 'positive');
  assert.equal(v.rows[2].feature, names[1]);
  assert.equal(v.rows[2].direction, 'positive');
  assert.equal(v.intercept, 0.5);
});

test('buildLearnedCoefficientsView returns null for bad payload', () => {
  assert.equal(buildLearnedCoefficientsView({}, 'x', {}), null);
  assert.equal(
    buildLearnedCoefficientsView({ kind: 'ridge_v1', featureNames: ['a'], weights: [1] }, 'x', {}),
    null
  );
});
