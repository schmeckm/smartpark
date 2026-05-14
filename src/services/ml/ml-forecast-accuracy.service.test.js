'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  calculateAccuracyMetrics,
  STATUS,
  coerceComparableOnly,
  resolveActualWaitFromGovernedSnapshot,
} = require('./ml-forecast-accuracy.service');
const { RideFeatureSnapshot } = require('../../models');

describe('coerceComparableOnly', () => {
  it('is true for boolean true and common string/number representations', () => {
    assert.equal(coerceComparableOnly(true), true);
    assert.equal(coerceComparableOnly('true'), true);
    assert.equal(coerceComparableOnly('1'), true);
    assert.equal(coerceComparableOnly(1), true);
    assert.equal(coerceComparableOnly('YES'), true);
  });

  it('is false otherwise', () => {
    assert.equal(coerceComparableOnly(false), false);
    assert.equal(coerceComparableOnly('false'), false);
    assert.equal(coerceComparableOnly(undefined), false);
    assert.equal(coerceComparableOnly(null), false);
  });
});

describe('ml-forecast-accuracy.service calculateAccuracyMetrics', () => {
  it('returns OK when percentage error <= 10%', () => {
    const m = calculateAccuracyMetrics(9, 10);
    assert.equal(m.accuracyStatus, STATUS.OK);
    assert.equal(m.absoluteError, 1);
    assert.ok(Math.abs(m.percentageError - 0.1) < 1e-9);
    assert.equal(m.bias, -1);
  });

  it('returns WARNING between 10% and 25%', () => {
    const m = calculateAccuracyMetrics(12, 10);
    assert.equal(m.accuracyStatus, STATUS.WARNING);
    assert.ok(Math.abs(m.percentageError - 0.2) < 1e-9);
  });

  it('returns CRITICAL above 25%', () => {
    const m = calculateAccuracyMetrics(20, 10);
    assert.equal(m.accuracyStatus, STATUS.CRITICAL);
    assert.ok(Math.abs(m.percentageError - 1) < 1e-9);
  });

  it('returns UNKNOWN when predicted missing', () => {
    const m = calculateAccuracyMetrics(null, 10);
    assert.equal(m.accuracyStatus, STATUS.UNKNOWN);
    assert.strictEqual(m.absoluteError, null);
  });

  it('returns UNKNOWN when actual missing', () => {
    const m = calculateAccuracyMetrics(5, null);
    assert.equal(m.accuracyStatus, STATUS.UNKNOWN);
  });

  it('returns UNKNOWN when actual is zero (pct undefined)', () => {
    const m = calculateAccuracyMetrics(3, 0);
    assert.equal(m.accuracyStatus, STATUS.UNKNOWN);
    assert.strictEqual(m.percentageError, null);
    assert.equal(m.bias, 3);
  });
});

describe('ml-forecast-accuracy.service evaluateForecastAccuracy isolation', () => {
  it('returns zeros without parkId without throwing', async () => {
    const { evaluateForecastAccuracy } = require('./ml-forecast-accuracy.service');
    const out = await evaluateForecastAccuracy({ parkId: '', limit: 5 });
    assert.deepStrictEqual(out, { processed: 0, written: 0 });
  });
});

describe('resolveActualWaitFromGovernedSnapshot', () => {
  it('returns PARK_CLOSED evaluationReason when only ineligible snapshots carry waits', async () => {
    const orig = RideFeatureSnapshot.findAll;
    RideFeatureSnapshot.findAll = async () => [
      {
        get: () => ({
          snapshotAt: new Date('2026-06-01T12:00:00.000Z'),
          waitTime: 25,
          currentWaitTimeMin: null,
          accuracyEligible: false,
          dataQualityReason: 'PARK_CLOSED',
        }),
      },
    ];
    try {
      const mid = new Date('2026-06-01T12:00:00.000Z');
      const out = await resolveActualWaitFromGovernedSnapshot('p1', 'r1', mid);
      assert.deepStrictEqual(out, { actualValue: null, evaluationReason: 'PARK_CLOSED' });
    } finally {
      RideFeatureSnapshot.findAll = orig;
    }
  });

  it('prefers eligible snapshot actual value when mixed rows exist', async () => {
    const orig = RideFeatureSnapshot.findAll;
    const tEligible = new Date('2026-06-01T12:01:00.000Z');
    RideFeatureSnapshot.findAll = async () => [
      {
        get: () => ({
          snapshotAt: new Date('2026-06-01T12:00:00.000Z'),
          waitTime: 99,
          accuracyEligible: false,
          dataQualityReason: 'PARK_CLOSED',
        }),
      },
      {
        get: () => ({
          snapshotAt: tEligible,
          waitTime: 20,
          accuracyEligible: true,
          dataQualityReason: null,
        }),
      },
    ];
    try {
      const mid = tEligible.getTime();
      const out = await resolveActualWaitFromGovernedSnapshot('p1', 'r1', new Date(mid));
      assert.deepStrictEqual(out, { actualValue: 20, evaluationReason: null });
    } finally {
      RideFeatureSnapshot.findAll = orig;
    }
  });
});
