'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function capRow(parkId, assetId, signalCode, capabilityJson) {
  return {
    get(k) {
      if (k === 'parkId') return parkId;
      if (k === 'assetId') return assetId;
      if (k === 'capabilityJson') return capabilityJson;
      return null;
    },
    signal: {
      get() {
        return { signalCode };
      },
    },
  };
}

test('explicit useForMl false on mapped signal disables ML feature key', async () => {
  const { loadExplicitlyDisabledMlFeatureKeys } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [capRow('park-1', 'ride-1', 'queue_time', { useForMl: false })],
      },
      SignalCatalog: {},
    },
  });
  const s = await loadExplicitlyDisabledMlFeatureKeys('park-1', 'ride-1');
  assert.ok(s.has('current_wait_time'));
});

test('explicit useForMl true wins over another row false for same ML key', async () => {
  const { loadExplicitlyDisabledMlFeatureKeys } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [
          capRow('park-1', 'ride-1', 'queue_time', { useForMl: false }),
          capRow('park-1', 'ride-1', 'wait_time', { useForMl: true }),
        ],
      },
      SignalCatalog: {},
    },
  });
  const s = await loadExplicitlyDisabledMlFeatureKeys('park-1', 'ride-1');
  assert.equal(s.has('current_wait_time'), false);
});

test('non-boolean useForMl does not disable', async () => {
  const { loadExplicitlyDisabledMlFeatureKeys } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [capRow('park-1', 'ride-1', 'queue_time', {})],
      },
      SignalCatalog: {},
    },
  });
  const s = await loadExplicitlyDisabledMlFeatureKeys('park-1', 'ride-1');
  assert.equal(s.size, 0);
});

test('loadExplicitlyDisabledMlFeatureKeysBatch groups by ride', async () => {
  const { loadExplicitlyDisabledMlFeatureKeysBatch } = proxyquire('./ride-ml-feature-mask.service', {
    '../../models': {
      RideSignalCapability: {
        findAll: async () => [
          capRow('p1', 'r1', 'rain_mm', { useForMl: false }),
          capRow('p1', 'r2', 'temperature', { useForMl: false }),
        ],
      },
      SignalCatalog: {},
    },
  });
  const m = await loadExplicitlyDisabledMlFeatureKeysBatch([
    { parkId: 'p1', rideId: 'r1' },
    { parkId: 'p1', rideId: 'r2' },
  ]);
  assert.ok(m.get('p1|r1')?.has('rain_mm'));
  assert.ok(m.get('p1|r2')?.has('temperature_c'));
});
