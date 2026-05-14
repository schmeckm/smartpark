'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assertPlainObject } = require('./ml-park-profile.service');
const { parkListQuery } = require('../../validators/ml-metadata-profile.validators');

test('assertPlainObject accepts empty object and empty input', () => {
  assert.deepEqual(assertPlainObject('x', {}), {});
  assert.deepEqual(assertPlainObject('x', undefined), {});
});

test('assertPlainObject rejects arrays', () => {
  assert.throws(
    () => assertPlainObject('crowd', []),
    (e) => e.code === 'INVALID_JSON_FIELD'
  );
});

test('parkListQuery allows enabled filter string', () => {
  const r = parkListQuery.validate({ enabled: 'true' });
  assert.equal(r.error, undefined);
  assert.strictEqual(r.value.enabled, true);
});

test('ride-prediction service does not load ML metadata profile modules', async () => {
  const src = await fs.promises.readFile(path.join(__dirname, 'ride-prediction.service.js'), 'utf8');
  assert.match(src, /snapshotToFeatureMap/);
  assert.doesNotMatch(src, /ml-park-profile|ml-ride-profile|MlParkProfile|MlRideProfile/);
});
