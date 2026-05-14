'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  normalizeFeatureWeights,
  mergeParkAndRideWeights,
  buildWeightedFeatureVector,
  MAX_MANUAL_FEATURE_WEIGHT,
  TRAINING_FEATURE_NAMES,
} = require('./ml-feature-weight.util');

test('default merged weight is 1.0 for all training features', () => {
  const { merged, sources } = mergeParkAndRideWeights({}, {});
  for (const k of TRAINING_FEATURE_NAMES) {
    assert.equal(merged[k], 1);
    assert.equal(sources[k], 'default');
  }
});

test('park weights applied', () => {
  const { merged, sources } = mergeParkAndRideWeights({ park_crowd_index: 0.5 }, {});
  assert.equal(merged.park_crowd_index, 0.5);
  assert.equal(sources.park_crowd_index, 'park_profile');
  assert.equal(merged.rain_mm, 1);
});

test('ride weights override park for same feature', () => {
  const { merged, sources } = mergeParkAndRideWeights(
    { park_crowd_index: 0.5, rain_mm: 0.2 },
    { park_crowd_index: 2 }
  );
  assert.equal(merged.park_crowd_index, 2);
  assert.equal(sources.park_crowd_index, 'ride_profile');
  assert.equal(merged.rain_mm, 0.2);
  assert.equal(sources.rain_mm, 'park_profile');
});

test('unknown feature key rejected', () => {
  assert.throws(
    () => normalizeFeatureWeights({ not_a_feature: 1 }),
    (e) => e.code === 'UNKNOWN_FEATURE_WEIGHT_KEY'
  );
});

test('negative weight rejected', () => {
  assert.throws(
    () => normalizeFeatureWeights({ rain_mm: -0.1 }),
    (e) => e.code === 'INVALID_FEATURE_WEIGHT_VALUE'
  );
});

test('weight above max rejected', () => {
  assert.throws(
    () => normalizeFeatureWeights({ rain_mm: MAX_MANUAL_FEATURE_WEIGHT + 0.01 }),
    (e) => e.code === 'FEATURE_WEIGHT_ABOVE_MAX'
  );
});

test('buildWeightedFeatureVector produces weightedValue = normalized * weight', () => {
  const { merged, sources } = mergeParkAndRideWeights({ current_wait_time: 2 }, {});
  const featureMap = { current_wait_time: 3, rain_mm: 1 };
  const fsj = { current_wait_time: 'ok', rain_mm: 'ok' };
  const out = buildWeightedFeatureVector(featureMap, merged, sources, fsj);
  assert.equal(out.current_wait_time.weight, 2);
  assert.equal(out.current_wait_time.normalizedValue, 3);
  assert.equal(out.current_wait_time.weightedValue, 6);
  assert.equal(out.rain_mm.weight, 1);
});

test('ride-prediction.service does not import Phase 4 weight util', async () => {
  const src = await fs.promises.readFile(path.join(__dirname, 'ride-prediction.service.js'), 'utf8');
  assert.doesNotMatch(src, /ml-feature-weight|ml-feature-weights-resolve/);
});
