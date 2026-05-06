'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { buildPayloadPreview, PREVIEW_MAX, SPY_CLASSIFICATION } = require('./uns-spy.service');

function spyWithModels(modelStub) {
  const models = require('../models');
  return proxyquire('./uns-spy.service', {
    '../models': { ...models, ...modelStub },
  });
}

test('buildPayloadPreview caps UTF-8 length and reports total bytes', () => {
  const buf = Buffer.alloc(PREVIEW_MAX + 100, 'x');
  const r = buildPayloadPreview(buf);
  assert.equal(r.length, PREVIEW_MAX + 100);
  assert.equal(r.preview.length, PREVIEW_MAX);
});

test('buildPayloadPreview parses JSON object when valid', () => {
  const r = buildPayloadPreview(Buffer.from('{"a":1}', 'utf8'));
  assert.deepEqual(r.payloadJson, { a: 1 });
});

test('buildPayloadPreview invalid JSON payload does not throw', () => {
  const r = buildPayloadPreview(Buffer.from('not-json\x00\xff', 'utf8'));
  assert.equal(r.payloadJson, null);
  assert.ok(typeof r.preview === 'string');
});

test('classifyInboundTopic: known tpuns topic mirrored in registry is APPROVED_TOPIC', async () => {
  const topic = 'tpuns/europapark/v1/ride/blue_fire/queue_time';
  const svc = spyWithModels({
    UnsNode: { findAll: async () => [] },
    UnsRegistryTopic: {
      findOne: async () => ({ id: 'reg-1', registryEntityId: 'ent-1' }),
    },
  });
  const r = await svc.classifyInboundTopic(topic);
  assert.equal(r.classification, SPY_CLASSIFICATION.APPROVED_TOPIC);
  assert.equal(r.details.source, 'uns_registry_topics');
});

test('classifyInboundTopic: unknown tpuns topic (no node, no registry) is UNKNOWN_TOPIC', async () => {
  const topic = 'tpuns/europapark/v1/ride/ghost_asset/queue_time';
  const svc = spyWithModels({
    UnsNode: { findAll: async () => [] },
    UnsRegistryTopic: { findOne: async () => null },
  });
  const r = await svc.classifyInboundTopic(topic);
  assert.equal(r.classification, SPY_CLASSIFICATION.UNKNOWN_TOPIC);
});

test('classifyInboundTopic: known ride namespace but metric not in uns_nodes is UNKNOWN_SIGNAL', async () => {
  const topic = 'tpuns/europapark/v1/ride/blue_fire/unknown_metric_xyz';
  const svc = spyWithModels({
    UnsNode: {
      findAll: async (opts) => {
        const topicPath = opts?.where?.topicPath;
        if (topicPath === topic) return [];
        return [{ id: 'n1', topicPath: 'tpuns/europapark/v1/ride/blue_fire/queue_time', metric: 'queue_time' }];
      },
    },
    UnsRegistryTopic: { findOne: async () => null },
  });
  const r = await svc.classifyInboundTopic(topic);
  assert.equal(r.classification, SPY_CLASSIFICATION.UNKNOWN_SIGNAL);
  assert.ok(Array.isArray(r.details.knownMetrics));
});

test('classifyInboundTopic: unrelated topic shape is OBSERVE_SKIPPED', async () => {
  const svc = spyWithModels({});
  const r = await svc.classifyInboundTopic('some/vendor/topic');
  assert.equal(r.classification, SPY_CLASSIFICATION.OBSERVE_SKIPPED);
});

test('classifyInboundTopic: matches uns_nodes exact tpuns path is APPROVED_TOPIC', async () => {
  const topic = 'tpuns/europapark/v1/ride/blue_fire/queue_time';
  const svc = spyWithModels({
    UnsNode: {
      findAll: async () => [{ id: 'u1', topicPath: topic, metric: 'queue_time', slug: 'q' }],
    },
    UnsRegistryTopic: { findOne: async () => null },
  });
  const r = await svc.classifyInboundTopic(topic);
  assert.equal(r.classification, SPY_CLASSIFICATION.APPROVED_TOPIC);
  assert.equal(r.details.source, 'uns_nodes');
});
