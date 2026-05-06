'use strict';

/**
 * Phase 12 — UNS Spy adapter discovery approval flow (HTTP integration).
 *
 * Opt-in: UNS_INTEGRATION_TESTS=1 with reachable Postgres + seeded admin (see uns-api.integration.test.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { sequelize, UnsDiscoveryEvent, User, UserRole, ParkAsset, AssetType, AuditLog, ExternalEntityMapping } = require('../../models');
const { app, loginAccessToken } = require('../../test-utils/integration-http');
const AUDIT = require('../../constants/audit-actions');

const ENABLED = process.env.UNS_INTEGRATION_TESTS === '1' || process.env.UNS_INTEGRATION_TESTS === 'true';
const ADMIN_EMAIL = 'admin@smartpark.com';
const ADMIN_PASSWORD = 'Smartpark123!';
const DENY_EMAIL = `phase12-uns-deny-${randomUUID()}@smartpark.test`;
const ROLE_CODE_NO_PERMS = 'INTEGRATION_TEST_NO_RBAC_MATCH';

let dbOk = false;

/** @returns {Promise<number>} */
async function countTable(tableName) {
  const rows = await sequelize.query(`SELECT COUNT(*)::int AS cnt FROM ${tableName}`, {
    type: sequelize.QueryTypes.SELECT,
  });
  return Number(rows[0]?.cnt ?? 0);
}

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
  const u = await User.unscoped().findOne({ where: { email: DENY_EMAIL } });
  if (!u) return;
  await UserRole.destroy({ where: { userId: u.id } });
  await User.unscoped().destroy({ where: { id: u.id } });
});

async function ensureNoPermUser() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const [u] = await User.unscoped().findOrCreate({
    where: { email: DENY_EMAIL },
    defaults: {
      firstName: 'Phase',
      lastName: 'Deny',
      email: DENY_EMAIL,
      passwordHash: hash,
      role: 'OPERATOR',
      active: true,
    },
  });
  await UserRole.destroy({ where: { userId: u.id } });
  await UserRole.create({ userId: u.id, roleCode: ROLE_CODE_NO_PERMS });
}

async function findRideAssetForTest() {
  const rideType = await AssetType.findOne({ where: { code: 'ride' }, attributes: ['id'] });
  if (!rideType) return null;
  return ParkAsset.findOne({
    where: { assetTypeId: rideType.id, activeFlag: true },
    attributes: ['assetId', 'parkId'],
    raw: true,
  });
}

test('A) GET /uns-spy/events?eventSource=adapter — 200; only adapter-sourced rows', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const base = {
    source: 'adapter',
    reviewStatus: 'PENDING',
    externalEntityId: `ext-a-${randomUUID()}`,
    externalSystem: 'themeparks',
    entityType: 'ride',
    suggestedName: 'IT Adapter A',
    parkId: ride.parkId,
  };
  const adapterEv = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${base.externalEntityId}/state`,
    details: { ...base },
  });
  const mqttEv = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/mqtt-only/state`,
    details: { reviewStatus: 'PENDING', source: 'mqtt' },
  });
  try {
    const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .get('/api/v1/uns-spy/events')
      .query({ eventSource: 'adapter', limit: 200 })
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const items = res.body.data.items || [];
    assert.equal(items.some((r) => r.id === mqttEv.id), false);
    const hit = items.find((r) => r.id === adapterEv.id);
    assert.ok(hit);
    assert.equal(hit?.details?.source, 'adapter');
  } finally {
    await UnsDiscoveryEvent.destroy({ where: { id: [adapterEv.id, mqttEv.id] } });
  }
});

test('B) POST reject — 200, REJECTED, audit row', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const ext = `ext-b-${randomUUID()}`;
  const ev = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${ext}/state`,
    details: {
      source: 'adapter',
      reviewStatus: 'PENDING',
      externalEntityId: ext,
      parkId: ride.parkId,
    },
  });
  try {
    const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/uns-spy/events/${ev.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const row = await UnsDiscoveryEvent.findByPk(ev.id);
    assert.equal(row.details.reviewStatus, 'REJECTED');
    const audit = await AuditLog.findOne({
      where: { action: AUDIT.UNS_SPY_DISCOVERY_REJECT, entityId: ev.id },
      order: [['createdAt', 'DESC']],
    });
    assert.ok(audit);
  } finally {
    await UnsDiscoveryEvent.destroy({ where: { id: ev.id } });
  }
});

test('C) POST ignore — 200, IGNORED', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const ext = `ext-c-${randomUUID()}`;
  const ev = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${ext}/state`,
    details: {
      source: 'adapter',
      reviewStatus: 'PENDING',
      externalEntityId: ext,
      parkId: ride.parkId,
    },
  });
  try {
    const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/uns-spy/events/${ev.id}/ignore`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 200);
    const row = await UnsDiscoveryEvent.findByPk(ev.id);
    assert.equal(row.details.reviewStatus, 'IGNORED');
  } finally {
    await UnsDiscoveryEvent.destroy({ where: { id: ev.id } });
  }
});

test('D) POST approve — mapping + APPROVED; uns_nodes / uns_latest_states unchanged', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const ext = `ext-d-${randomUUID()}`;
  const ev = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${ext}/state`,
    details: {
      source: 'adapter',
      reviewStatus: 'PENDING',
      externalEntityId: ext,
      externalParkId: null,
      parkId: ride.parkId,
    },
  });
  const beforeNodes = await countTable('uns_nodes');
  const beforeLatest = await countTable('uns_latest_states');
  try {
    const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request(app)
      .post(`/api/v1/uns-spy/events/${ev.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mapToExistingEntityId: ride.assetId,
        createEntity: false,
        createMapping: true,
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.mappedEntityId, ride.assetId);
    const row = await UnsDiscoveryEvent.findByPk(ev.id);
    assert.equal(row.details.reviewStatus, 'APPROVED');
    assert.equal(row.details.source, 'adapter');
    const mapping = await ExternalEntityMapping.findOne({
      where: { provider: 'THEMEPARKS_WIKI', externalEntityId: ext, internalEntityId: ride.assetId },
    });
    assert.ok(mapping);
    assert.equal(await countTable('uns_nodes'), beforeNodes);
    assert.equal(await countTable('uns_latest_states'), beforeLatest);
  } finally {
    await ExternalEntityMapping.destroy({ where: { provider: 'THEMEPARKS_WIKI', externalEntityId: ext } }).catch(() => {});
    await UnsDiscoveryEvent.destroy({ where: { id: ev.id } });
  }
});

test('E) VIEWER: GET allowed; POST reject forbidden', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const ext = `ext-e-${randomUUID()}`;
  const ev = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${ext}/state`,
    details: {
      source: 'adapter',
      reviewStatus: 'PENDING',
      externalEntityId: ext,
      parkId: ride.parkId,
    },
  });
  try {
    const viewerEmail = `phase12-viewer-${randomUUID()}@smartpark.test`;
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const viewer = await User.create({
      firstName: 'V',
      lastName: 'Viewer',
      email: viewerEmail,
      passwordHash: hash,
      role: 'VIEWER',
      active: true,
    });
    try {
      const vTok = await loginAccessToken(viewerEmail, ADMIN_PASSWORD);
      const list = await request(app)
        .get('/api/v1/uns-spy/events')
        .query({ eventSource: 'adapter', limit: 5 })
        .set('Authorization', `Bearer ${vTok}`);
      assert.equal(list.status, 200);
      const rej = await request(app)
        .post(`/api/v1/uns-spy/events/${ev.id}/reject`)
        .set('Authorization', `Bearer ${vTok}`)
        .send({});
      assert.equal(rej.status, 403);
    } finally {
      await User.destroy({ where: { id: viewer.id } });
    }
  } finally {
    await UnsDiscoveryEvent.destroy({ where: { id: ev.id } });
  }
});

test('E2) user without integrations.read and rides.read gets 403 on GET', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  await ensureNoPermUser();
  const token = await loginAccessToken(DENY_EMAIL, ADMIN_PASSWORD);
  const res = await request(app)
    .get('/api/v1/uns-spy/events')
    .query({ eventSource: 'adapter' })
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('F) POST /sync/themeparks/discovery/from-settings when flag false returns 403', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await request(app)
    .post('/api/v1/sync/themeparks/discovery/from-settings')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  const flagOn = String(process.env.ADAPTER_DISCOVERY_SPY_ENABLED || '').toLowerCase() === 'true';
  if (flagOn) {
    assert.ok([200, 404, 422].includes(res.status), `unexpected status ${res.status}`);
  } else {
    assert.equal(res.status, 403);
    assert.equal(res.body?.code || res.body?.error?.code, 'FEATURE_DISABLED');
  }
});

test('invalid approve payload returns 422', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await request(app)
    .post(`/api/v1/uns-spy/events/${randomUUID()}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.ok([400, 422].includes(res.status));
});

test('404 reject unknown id', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await request(app)
    .post(`/api/v1/uns-spy/events/${randomUUID()}/reject`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(res.status, 404);
});

test('409 approve when already APPROVED', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const ride = await findRideAssetForTest();
  if (!ride) {
    t.skip();
    return;
  }
  const ext = `ext-409-${randomUUID()}`;
  const ev = await UnsDiscoveryEvent.create({
    classification: 'NEW',
    topicPath: `smartpark/${ride.parkId}/rides/${ext}/state`,
    details: {
      source: 'adapter',
      reviewStatus: 'PENDING',
      externalEntityId: ext,
      parkId: ride.parkId,
    },
  });
  const token = await loginAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD);
  try {
    const first = await request(app)
      .post(`/api/v1/uns-spy/events/${ev.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mapToExistingEntityId: ride.assetId, createEntity: false });
    assert.equal(first.status, 200);
    const second = await request(app)
      .post(`/api/v1/uns-spy/events/${ev.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mapToExistingEntityId: ride.assetId, createEntity: false });
    assert.equal(second.status, 409);
  } finally {
    await ExternalEntityMapping.destroy({ where: { provider: 'THEMEPARKS_WIKI', externalEntityId: ext } }).catch(() => {});
    await UnsDiscoveryEvent.destroy({ where: { id: ev.id } });
  }
});
