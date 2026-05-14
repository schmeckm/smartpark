'use strict';

/**
 * UNS HTTP integration tests — opt-in: UNS_INTEGRATION_TESTS=1 with reachable Postgres + seeded users.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { sequelize, User, UserRole, Park } = require('../../models');
const { loginAccessToken, app } = require('../../test-utils/integration-http');

const ENABLED = process.env.UNS_INTEGRATION_TESTS === '1' || process.env.UNS_INTEGRATION_TESTS === 'true';
const HR_EMAIL = 'uns-int-hr-only@smartpark.test';

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

test.after(async () => {
  if (!ENABLED || !dbOk) return;
  const u = await User.unscoped().findOne({ where: { email: HR_EMAIL } });
  if (!u) return;
  await UserRole.destroy({ where: { userId: u.id } });
  await User.unscoped().destroy({ where: { id: u.id } });
});

async function ensureHrUserWithoutIntegrationsRead() {
  const hash = await bcrypt.hash('Smartpark123!', 12);
  const [u] = await User.unscoped().findOrCreate({
    where: { email: HR_EMAIL },
    defaults: {
      firstName: 'UNS',
      lastName: 'HRTest',
      email: HR_EMAIL,
      passwordHash: hash,
      role: 'OPERATOR',
      active: true,
    },
  });
  await UserRole.destroy({ where: { userId: u.id } });
  await UserRole.create({ userId: u.id, roleCode: 'HR_MANAGER' });
}

test('UNS registry mirror: integrations user receives 200 summary', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app).get('/api/v1/uns-registry/mirror/summary').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('UNS registry mirror: POST mirror/sync forces full sync', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app).post('/api/v1/uns-registry/mirror/sync').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.syncedAt);
  assert.ok(res.body.data?.counts && typeof res.body.data.counts.sparkplugMetricDefinitions === 'number');
});

test('UNS registry mirror: HR_MANAGER without integrations.read receives 403', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  await ensureHrUserWithoutIntegrationsRead();
  const token = await loginAccessToken(HR_EMAIL, 'Smartpark123!');
  const res = await request(app).get('/api/v1/uns-registry/mirror/summary').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('UNS registry mirror: POST mirror/sync forbidden for HR_MANAGER without integrations.read', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  await ensureHrUserWithoutIntegrationsRead();
  const token = await loginAccessToken(HR_EMAIL, 'Smartpark123!');
  const res = await request(app).post('/api/v1/uns-registry/mirror/sync').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('UNS spy events list returns structured payload for authorized user', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app).get('/api/v1/uns-spy/events?limit=5').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('MQTT inbound unknown list returns structured payload', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app).get('/api/v1/mqtt/inbound/unknown?limit=5').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

/** Asset „Signale“ panel and UNS Live share GET `/uns/parks/:parkId/mqtt-live/events` + client-side match (`uns-mqtt-live-signal-match.mjs`). */
test('UNS mqtt-live events: GET returns events array for integration park id', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const park = await Park.findOne({ attributes: ['id'] });
  if (!park) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app)
    .get(`/api/v1/uns/parks/${park.id}/mqtt-live/events?limit=20`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data?.events));
});

test('UNS GET sparkplug-topic-preview returns spBv1 topic for asset', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const { ParkAsset } = require('../../models');
  const park = await Park.findOne({ attributes: ['id'] });
  if (!park) {
    t.skip();
    return;
  }
  const asset = await ParkAsset.findOne({ where: { parkId: park.id }, attributes: ['assetId'] });
  if (!asset) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app)
    .get(`/api/v1/uns/parks/${park.id}/sparkplug-topic-preview`)
    .query({ assetId: String(asset.assetId) })
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.data.topicPreview, /^spBv1\.0\//);
  assert.ok(res.body.data.edgeNodeId && String(res.body.data.edgeNodeId).length > 0);
  assert.ok(typeof res.body.data.source === 'string');
});

test('operations facts park route: X-Park-Id mismatch returns 403', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const park = await Park.findOne({ attributes: ['id'] });
  if (!park) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const fakePark = '00000000-0000-4000-8000-000000000099';
  const res = await request(app)
    .get(`/api/v1/operations-facts/parks/${fakePark}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Park-Id', String(park.id));
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'PARK_CONTEXT_MISMATCH');
});

test('registry signal deprecate: unknown ride asset returns 404', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const fakeRide = '00000000-0000-4000-8000-000000000088';
  const res = await request(app)
    .post(`/api/v1/master-data/rides/${fakeRide}/registry-signal-deprecations/deprecate`)
    .set('Authorization', `Bearer ${token}`)
    .send({ signalKey: 'queue_time', registryAuthoritative: true });
  assert.ok([404, 422].includes(res.status));
});
