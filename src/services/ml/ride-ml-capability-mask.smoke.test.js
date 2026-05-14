/**
 * Smoke policy checks for ride ridge ML capability masking.
 * Run: npm run smoke:ride-ml-mask
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const {
  snapshotToFeatureMap,
  applyMlFeatureMask,
  featureVectorFromMap,
  TRAINING_FEATURE_NAMES,
} = require('./ride-feature-vector.util');

const sampleSnap = {
  currentWaitTimeMin: 15,
  waitTime: 15,
  rollingAvgWait15m: 14,
  rollingAvgWait60m: 16,
  waitTimeDelta5m: 0,
  status: 'OPEN',
  isOpen: true,
  parkCrowdIndex: 55,
  xFeaturesExtras: {},
  snapshotAt: new Date('2026-05-11T12:00:00.000Z'),
  precipitationMm: 4,
  temperatureC: 20,
  isSchoolHoliday: false,
};

test('Smoke: explicit useForMl=false → mapped ridge input is zero in feature vector', () => {
  const raw = snapshotToFeatureMap(sampleSnap);
  assert.ok(raw.rain_mm > 0, 'fixture should have rain');
  const masked = applyMlFeatureMask(raw, new Set(['rain_mm']));
  assert.equal(masked.rain_mm, 0);
  const idx = TRAINING_FEATURE_NAMES.indexOf('rain_mm');
  assert.ok(idx >= 0);
  const vec = featureVectorFromMap(masked);
  assert.equal(vec[idx], 0);
});

test('Smoke: useForMl omitted (no explicit boolean) → no masking from capability loader', async () => {
  const { loadExplicitlyDisabledMlFeatureKeys } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [
          {
            get(k) {
              if (k === 'parkId') return 'p1';
              if (k === 'assetId') return 'r1';
              if (k === 'capabilityJson') return {};
              return null;
            },
            signal: { get: () => ({ signalCode: 'queue_time' }) },
          },
        ],
      },
      SignalCatalog: {},
    },
  });
  const s = await loadExplicitlyDisabledMlFeatureKeys('p1', 'r1');
  assert.equal(s.size, 0);
});

test('Smoke: conflicting explicit useForMl true/false on same ML key → true wins (no mask)', async () => {
  const { loadExplicitlyDisabledMlFeatureKeys } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [
          {
            get(k) {
              if (k === 'parkId') return 'p1';
              if (k === 'assetId') return 'r1';
              if (k === 'capabilityJson') return { useForMl: false };
              return null;
            },
            signal: { get: () => ({ signalCode: 'rain_mm' }) },
          },
          {
            get(k) {
              if (k === 'parkId') return 'p1';
              if (k === 'assetId') return 'r1';
              if (k === 'capabilityJson') return { useForMl: true };
              return null;
            },
            signal: { get: () => ({ signalCode: 'rain' }) },
          },
        ],
      },
      SignalCatalog: {},
    },
  });
  const s = await loadExplicitlyDisabledMlFeatureKeys('p1', 'r1');
  assert.equal(s.has('rain_mm'), false);
});
