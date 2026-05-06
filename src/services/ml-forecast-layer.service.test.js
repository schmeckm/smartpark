'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isRainSensitivityDisabled,
  mlFactorCurrentsForApiResponse,
} = require('./ml-forecast-layer.service');

test('isRainSensitivityDisabled: null rideSnap allows rain bumps path', () => {
  assert.equal(isRainSensitivityDisabled(null), false);
  assert.equal(isRainSensitivityDisabled(undefined), false);
});

test('isRainSensitivityDisabled: camelCase false / 0 disables', () => {
  assert.equal(isRainSensitivityDisabled({ rainSensitive: false }), true);
  assert.equal(isRainSensitivityDisabled({ rainSensitive: 0 }), true);
  assert.equal(isRainSensitivityDisabled({ rainSensitive: true }), false);
});

test('isRainSensitivityDisabled: snake_case false / 0 disables', () => {
  assert.equal(isRainSensitivityDisabled({ rain_sensitive: false }), true);
  assert.equal(isRainSensitivityDisabled({ rain_sensitive: 0 }), true);
  assert.equal(isRainSensitivityDisabled({ rain_sensitive: true }), false);
});

test('mlFactorCurrentsForApiResponse strips meta from each factor row', () => {
  const m = new Map([
    [
      'RAIN_DEMAND_SHIFT',
      {
        current: 0.7,
        currentSource: 'CALCULATED',
        calculatedCurrent: 0.7,
        manualCurrentOverride: null,
        l1ApiCurrent: null,
        meta: { rainMm: 4.2 },
      },
    ],
    [
      'WEEKEND_UPLIFT',
      {
        current: 1,
        currentSource: 'CALCULATED',
        calculatedCurrent: 1,
        manualCurrentOverride: null,
        l1ApiCurrent: null,
      },
    ],
  ]);
  const out = mlFactorCurrentsForApiResponse(m);
  assert.equal(out.RAIN_DEMAND_SHIFT.current, 0.7);
  assert.ok(!('meta' in out.RAIN_DEMAND_SHIFT));
  assert.equal(out.WEEKEND_UPLIFT.current, 1);
});

test('mlFactorCurrentsForApiResponse empty map yields {}', () => {
  assert.deepEqual(mlFactorCurrentsForApiResponse(new Map()), {});
});
