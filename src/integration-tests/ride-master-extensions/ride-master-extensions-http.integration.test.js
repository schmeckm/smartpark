'use strict';

/**
 * Optional live HTTP checks against a running API + Postgres (seeded admin user).
 * RIDE_EXT_API_TESTS=1
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sequelize } = require('../../models');
const { loginAccessToken, request, app } = require('../../test-utils/integration-http');

const ENABLED = process.env.RIDE_EXT_API_TESTS === '1' || process.env.RIDE_EXT_API_TESTS === 'true';

let dbOk = false;

test.before(async () => {
  if (!ENABLED) return;
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch {
    dbOk = false;
  }
});

test('GET /api/v1/mdm/rides/:id/extensions — 404 for unknown ride', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const id = randomUUID();
  const res = await request(app)
    .get(`/api/v1/mdm/rides/${id}/extensions`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 404);
});

test('GET /api/v1/assets/:assetId/extensions — 404 for unknown asset', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const id = randomUUID();
  const res = await request(app)
    .get(`/api/v1/assets/${id}/extensions`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 404);
});
