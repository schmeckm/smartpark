'use strict';

/**
 * UNS Spy persistence + HTTP inbox (no MQTT connector required).
 * Uses real Postgres when UNS_INTEGRATION_TESTS=1.
 *
 * For broker-level exercises, use `src/test-utils/mqtt-test-publisher.js` against a running API
 * with MQTT_ENABLED=true and UNS_SPY_ENABLED=true (see docs/testing/uns-testing.md).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  sequelize,
  MqttInboundMessage,
  UnsDiscoveryEvent,
  UnsTopicProposal,
  ParkAsset,
  Park,
  AssetType,
  SignalCatalog,
  UnsRegistryTopic,
  RideSignalCapability,
  UnsLatestState,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = require('../../models');
const { buildCanonicalUnsTopic } = require('../../modules/uns/uns-topic-generator.service');
const { buildPayloadPreview, processInboundMqttRow, SPY_CLASSIFICATION } = require('../../services/uns-spy.service');
const { loginAccessToken, app, request } = require('../../test-utils/integration-http');

const ENABLED = process.env.UNS_INTEGRATION_TESTS === '1' || process.env.UNS_INTEGRATION_TESTS === 'true';

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

test('unknown tpuns topic: spy persists discovery + appears on GET /uns-spy/events', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }

  const topic = `tpuns/europapark/v1/ride/spy_it_${Date.now()}/queue_time`;
  const payloadBuf = Buffer.from(JSON.stringify({ value: 1, ts: new Date().toISOString() }), 'utf8');
  const preview = buildPayloadPreview(payloadBuf);

  const mqttRow = await MqttInboundMessage.create({
    topic,
    payloadPreview: preview.preview,
    payloadLength: preview.length,
    qos: 0,
    spyClassification: null,
    spyDetails: null,
  });

  await processInboundMqttRow(mqttRow, preview);
  await mqttRow.reload();

  assert.equal(mqttRow.spyClassification, SPY_CLASSIFICATION.UNKNOWN_TOPIC);

  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app).get('/api/v1/uns-spy/events?limit=80').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const items = res.body?.data?.items || [];
  assert.ok(items.some((row) => String(row.topicPath || '') === topic));

  const proposals = await UnsTopicProposal.findAll({ where: { proposedTopic: topic }, limit: 5 });
  for (const p of proposals) await p.destroy();
  const evts = await UnsDiscoveryEvent.findAll({ where: { mqttInboundMessageId: mqttRow.id } });
  for (const e of evts) await e.destroy();
  await mqttRow.destroy();
});

test('T.1 processInboundMqttRow does not write uns_latest_states', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const topic = `tpuns/europapark/v1/ride/spy_ls_${Date.now()}/queue_time`;
  const payloadBuf = Buffer.from(JSON.stringify({ value: 2, ts: new Date().toISOString() }), 'utf8');
  const preview = buildPayloadPreview(payloadBuf);
  const before = await UnsLatestState.count();
  const mqttRow = await MqttInboundMessage.create({
    topic,
    payloadPreview: preview.preview,
    payloadLength: preview.length,
    qos: 0,
    spyClassification: null,
    spyDetails: null,
  });
  await processInboundMqttRow(mqttRow, preview);
  const after = await UnsLatestState.count();
  assert.equal(after, before);
  const proposals = await UnsTopicProposal.findAll({ where: { proposedTopic: topic }, limit: 5 });
  for (const p of proposals) await p.destroy();
  const evts = await UnsDiscoveryEvent.findAll({ where: { mqttInboundMessageId: mqttRow.id } });
  for (const e of evts) await e.destroy();
  await mqttRow.destroy();
});

test('T.1 POST approve MQTT proposal creates active prepared registry topic', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const rideType = await AssetType.findOne({ where: { code: 'ride' } });
  if (!rideType) {
    t.skip();
    return;
  }
  const pa = await ParkAsset.findOne({
    where: { assetTypeId: rideType.id },
    include: [{ model: Park, as: 'park', attributes: ['id', 'slug', 'name'] }],
  });
  if (!pa || !pa.park) {
    t.skip();
    return;
  }
  const cat = await SignalCatalog.findOne({ order: [['signalCode', 'ASC']] });
  if (!cat) {
    t.skip();
    return;
  }
  const signalCode = String(cat.get('signalCode') || '').trim();
  if (!signalCode) {
    t.skip();
    return;
  }
  const canonical = buildCanonicalUnsTopic({
    parkSlug: pa.park.slug || pa.park.name || String(pa.park.id),
    entityType: 'ride',
    entitySlug: pa.slug,
    metric: signalCode,
  });
  const payloadBuf = Buffer.from(JSON.stringify({ value: 3, ts: new Date().toISOString() }), 'utf8');
  const preview = buildPayloadPreview(payloadBuf);
  const mqttRow = await MqttInboundMessage.create({
    topic: canonical,
    payloadPreview: preview.preview,
    payloadLength: preview.length,
    qos: 0,
    spyClassification: null,
    spyDetails: null,
  });
  await processInboundMqttRow(mqttRow, preview);
  const evt = await UnsDiscoveryEvent.findOne({
    where: { mqttInboundMessageId: mqttRow.id },
    order: [['createdAt', 'DESC']],
  });
  if (!evt || !['UNKNOWN_TOPIC', 'UNKNOWN_SIGNAL'].includes(String(evt.classification))) {
    await mqttRow.destroy();
    t.skip();
    return;
  }
  const proposal = await UnsTopicProposal.findOne({
    where: { proposedTopic: canonical },
    order: [['createdAt', 'DESC']],
  });
  if (!proposal) {
    await evt.destroy();
    await mqttRow.destroy();
    t.skip();
    return;
  }

  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app)
    .post(`/api/v1/uns-spy/proposals/${proposal.id}/approve`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      rideAssetId: String(pa.assetId),
      signalCatalogId: String(cat.id),
      signalSource: 'MANUAL',
      activatePrepared: true,
    });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body?.success, true);

  const topicRow = await UnsRegistryTopic.findOne({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, topicPath: canonical },
  });
  assert.ok(topicRow, 'expected PREPARED_OPERATOR registry topic');
  assert.equal(Boolean(topicRow.get('isActive')), true);

  if (String(process.env.MQTT_CAPABILITY_GUARD_MODE || '').toLowerCase() === 'enforce') {
    const { evaluateInboundMqttCapability } = require('../../services/mqtt-capability-guard.service');
    const guard = await evaluateInboundMqttCapability({
      topic: canonical,
      payloadJson: { value: 1, ts: new Date().toISOString() },
    });
    assert.equal(guard.decision, 'ALLOW', `guard decision was ${guard.decision} reason=${guard.reason}`);
  }

  await RideSignalCapability.destroy({
    where: {
      parkId: pa.parkId,
      assetId: pa.assetId,
      signalCatalogId: cat.id,
      registrySource: 'OPERATOR_CONFIGURED',
    },
  });
  await UnsRegistryTopic.destroy({
    where: { registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR, topicPath: canonical },
  });
  await proposal.destroy();
  await evt.destroy();
  await mqttRow.destroy();
});

test('T.1 POST reject MQTT proposal leaves registry topic absent', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const topic = `tpuns/europapark/v1/ride/spy_rej_${Date.now()}/queue_time`;
  const payloadBuf = Buffer.from(JSON.stringify({ value: 0, ts: new Date().toISOString() }), 'utf8');
  const preview = buildPayloadPreview(payloadBuf);
  const mqttRow = await MqttInboundMessage.create({
    topic,
    payloadPreview: preview.preview,
    payloadLength: preview.length,
    qos: 0,
    spyClassification: null,
    spyDetails: null,
  });
  await processInboundMqttRow(mqttRow, preview);
  const evt = await UnsDiscoveryEvent.findOne({
    where: { mqttInboundMessageId: mqttRow.id },
    order: [['createdAt', 'DESC']],
  });
  if (!evt || !['UNKNOWN_TOPIC', 'UNKNOWN_SIGNAL'].includes(String(evt.classification))) {
    await mqttRow.destroy();
    t.skip();
    return;
  }
  const proposal = await UnsTopicProposal.findOne({ where: { proposedTopic: topic }, order: [['createdAt', 'DESC']] });
  if (!proposal) {
    await evt.destroy();
    await mqttRow.destroy();
    t.skip();
    return;
  }
  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');
  const res = await request(app)
    .post(`/api/v1/uns-spy/proposals/${proposal.id}/reject`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'integration test' });
  assert.equal(res.status, 200, res.text);
  await proposal.reload();
  assert.equal(String(proposal.get('status')).toLowerCase(), 'rejected');
  const orphan = await UnsRegistryTopic.findOne({
    where: { topicPath: topic, registrySource: REGISTRY_SOURCE_PREPARED_OPERATOR },
  });
  assert.equal(orphan, null);
  await proposal.destroy();
  await evt.destroy();
  await mqttRow.destroy();
});
