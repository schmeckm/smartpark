'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../../utils/app-error');
const {
  OperationsFactsService,
  operationsFactsService,
  FALLBACK_REASON,
  EXPORTED_SERVICE_METHODS,
} = require('./operations-facts.service');

describe('operations-facts.service stub exports', () => {
  test('EXPORTED_SERVICE_METHODS are all functions on the class prototype / instance', () => {
    const svc = new OperationsFactsService({
      timeseriesService: { async getCurrentRideWaitsForPark() { return []; } },
    });
    for (const name of EXPORTED_SERVICE_METHODS) {
      assert.equal(typeof svc[name], 'function', name);
      assert.equal(typeof operationsFactsService[name], 'function', `singleton.${name}`);
    }
  });

  test('getRideFacts returns null when ids missing (no DB)', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: { async getCurrentRideWaitsForPark() { return []; } },
    });
    assert.equal(await svc.getRideFacts({ parkId: '', rideId: '' }), null);
  });
});

describe('getCurrentRideWaitsForPark delegation', () => {
  test('missing parkId returns fallback without calling upstream', async () => {
    let called = false;
    const svc = new OperationsFactsService({
      timeseriesService: {
        async getCurrentRideWaitsForPark() {
          called = true;
          return [];
        },
      },
    });
    const r = await svc.getCurrentRideWaitsForPark({ parkId: '', hours: 6 });
    assert.equal(called, false);
    assert.equal(r.ok, false);
    assert.deepEqual(r.items, []);
    assert.equal(r.meta.fallbackReason, FALLBACK_REASON.MISSING_PARK_ID);
  });

  test('null parkId', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: { async getCurrentRideWaitsForPark() { throw new Error('should not run'); } },
    });
    const r = await svc.getCurrentRideWaitsForPark({ parkId: null });
    assert.equal(r.ok, false);
    assert.equal(r.meta.fallbackReason, FALLBACK_REASON.MISSING_PARK_ID);
  });

  test('success path forwards timeseries rows', async () => {
    const stub = [{ assetId: 'a1', name: 'X', externalEntityId: null, current: null }];
    const svc = new OperationsFactsService({
      timeseriesService: {
        async getCurrentRideWaitsForPark({ parkId, hours }) {
          assert.equal(parkId, 'park-uuid');
          assert.equal(hours, 12);
          return stub;
        },
      },
    });
    const r = await svc.getCurrentRideWaitsForPark({ parkId: 'park-uuid', hours: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.meta.source, 'timeseries');
    assert.equal(r.meta.fallbackReason, FALLBACK_REASON.NONE);
  });

  test('AppError 404 maps to PARK_NOT_FOUND', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: {
        async getCurrentRideWaitsForPark() {
          throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
        },
      },
    });
    const r = await svc.getCurrentRideWaitsForPark({ parkId: 'missing' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.items, []);
    assert.equal(r.meta.fallbackReason, FALLBACK_REASON.PARK_NOT_FOUND);
    assert.equal(r.meta.code, 'PARK_NOT_FOUND');
  });

  test('generic error maps to UPSTREAM_ERROR', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: {
        async getCurrentRideWaitsForPark() {
          throw new Error('db down');
        },
      },
    });
    const r = await svc.getCurrentRideWaitsForPark({ parkId: 'any' });
    assert.equal(r.ok, false);
    assert.equal(r.meta.fallbackReason, FALLBACK_REASON.UPSTREAM_ERROR);
    assert.match(String(r.meta.message || ''), /db down/);
  });
});

describe('stub operational methods return safe shapes', () => {
  test('getParkOperationalFacts', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: { async getCurrentRideWaitsForPark() { return []; } },
    });
    const r = await svc.getParkOperationalFacts({ parkId: 'p1' });
    assert.equal(r.parkId, 'p1');
    assert.ok(r.meta && r.meta.phase);
    assert.ok(typeof r.facts === 'object');
  });

  test('getLatestWaitTimeFacts forwards wait list meta', async () => {
    const svc = new OperationsFactsService({
      timeseriesService: {
        async getCurrentRideWaitsForPark() {
          return [{ assetId: 'a', current: null }];
        },
      },
    });
    const r = await svc.getLatestWaitTimeFacts({ parkId: 'p1' });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
  });
});
