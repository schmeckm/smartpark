'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { clampWindowHours, getMlFeatureStoreSnapshotDebug } = require('./ml-feature-store-snapshot-debug.service');
const { AppError } = require('../../utils/app-error');

describe('clampWindowHours', () => {
  it('defaults invalid to 2 and clamps to 1..72', () => {
    assert.equal(clampWindowHours(NaN), 2);
    assert.equal(clampWindowHours(0), 1);
    assert.equal(clampWindowHours(200), 72);
    assert.equal(clampWindowHours(5), 5);
  });
});

describe('getMlFeatureStoreSnapshotDebug park/ride', () => {
  it('rejects missing rideId', async () => {
    await assert.rejects(
      async () => await getMlFeatureStoreSnapshotDebug({ parkId: 'p1', rideId: '' }),
      (e) => e instanceof AppError
    );
  });
});
