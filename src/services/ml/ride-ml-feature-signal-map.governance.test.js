'use strict';

/**
 * Governance tests for `SIGNAL_CODE_TO_ML_FEATURE` ↔ `TRAINING_FEATURE_NAMES`.
 * Run via `npm test` or `npm run governance:ride-ml-signal-map`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIGNAL_CODE_TO_ML_FEATURE,
  validateSignalCodeToMlFeatureGovernance,
} = require('./ride-ml-feature-mask.service');
const { TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');

test('governance: validateSignalCodeToMlFeatureGovernance() passes (map ↔ training vector contract)', () => {
  const r = validateSignalCodeToMlFeatureGovernance();
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.errors.length, 0);
});

test('governance: each TRAINING_FEATURE_NAME is reachable from at least one signal code', () => {
  const covered = new Set(Object.values(SIGNAL_CODE_TO_ML_FEATURE));
  for (const name of TRAINING_FEATURE_NAMES) {
    assert.ok(covered.has(name), `missing alias for ${name}`);
  }
});

test('governance: no empty or whitespace-only signal code keys', () => {
  for (const code of Object.keys(SIGNAL_CODE_TO_ML_FEATURE)) {
    assert.ok(code.length > 0, 'empty key');
    assert.equal(code, code.trim(), `whitespace in key: ${JSON.stringify(code)}`);
  }
});
