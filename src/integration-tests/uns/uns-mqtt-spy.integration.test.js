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
const { sequelize, MqttInboundMessage, UnsDiscoveryEvent, UnsTopicProposal } = require('../../models');
const { buildPayloadPreview, processInboundMqttRow, SPY_CLASSIFICATION } = require('../../services/uns-spy.service');
const { loginAccessToken, app } = require('../../test-utils/integration-http');

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
