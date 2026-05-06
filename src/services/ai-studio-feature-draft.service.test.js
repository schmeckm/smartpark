'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../utils/app-error');
const {
  assertMlEligibleSelections,
  normalizeBundle,
  compositeKey,
} = require('./ai-studio-feature-draft.service');

test('compositeKey is stable', () => {
  assert.equal(compositeKey('ride', 'a-uuid', 'single_asset'), 'ride:a-uuid:single_asset');
});

test('normalizeBundle tolerates junk', () => {
  assert.deepEqual(normalizeBundle(null), { v: 1, parks: {} });
  assert.deepEqual(normalizeBundle({}), { v: 1, parks: {} });
  const b = normalizeBundle({ v: 1, parks: { p1: { 'ride:x:single_asset': { foo: 1 } } } });
  assert.equal(b.parks.p1['ride:x:single_asset'].foo, 1);
});

test('assertMlEligibleSelections accepts enabled+mlEligible keys', async () => {
  const row = {
    extensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: {
        'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: false },
        'green.power_kw': { enabled: true, mlEligible: true, boardEligible: true },
      },
      capabilities: {},
    },
  };
  await assert.doesNotReject(() => assertMlEligibleSelections(row, ['queue.wait_time_min', 'green.power_kw']));
});

test('assertMlEligibleSelections rejects unknown key', async () => {
  const row = {
    extensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: { 'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: false } },
      capabilities: {},
    },
  };
  await assert.rejects(
    () => assertMlEligibleSelections(row, ['queue.unknown']),
    (e) => e instanceof AppError && e.statusCode === 400 && e.code === 'INVALID_ML_FEATURE_DRAFT'
  );
});

test('assertMlEligibleSelections rejects not mlEligible', async () => {
  const row = {
    extensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: {
        'queue.wait_time_min': { enabled: true, mlEligible: false, boardEligible: true },
      },
      capabilities: {},
    },
  };
  await assert.rejects(
    () => assertMlEligibleSelections(row, ['queue.wait_time_min']),
    (e) => e instanceof AppError && e.code === 'INVALID_ML_FEATURE_DRAFT'
  );
});

test('assertMlEligibleSelections rejects disabled', async () => {
  const row = {
    extensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: {
        'queue.wait_time_min': { enabled: false, mlEligible: true, boardEligible: false },
      },
      capabilities: {},
    },
  };
  await assert.rejects(
    () => assertMlEligibleSelections(row, ['queue.wait_time_min']),
    (e) => e instanceof AppError && e.code === 'INVALID_ML_FEATURE_DRAFT'
  );
});

test('assertMlEligibleSelections allows empty selection', async () => {
  const row = {
    extensions: {
      schemaVersion: 1,
      domains: [],
      signals: {},
      capabilities: {},
    },
  };
  await assert.doesNotReject(() => assertMlEligibleSelections(row, []));
});
