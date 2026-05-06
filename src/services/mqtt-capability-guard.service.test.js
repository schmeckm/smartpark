'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

/** Real helper (capture before proxyquire replaces this module in cache). */
const { shouldQuarantineLiveMqttPersistence } = require('./mqtt-capability-guard.service');

const REGISTRY_SOURCE_PREPARED_OPERATOR = 'PREPARED_OPERATOR';

const mockSequelize = {
  where: (a, b) => ({ a, b }),
  fn: (name, ...rest) => ({ name, rest }),
  col: (c) => c,
};

function loadWithStubs(stubs) {
  return proxyquire('./mqtt-capability-guard.service', {
    '../config/env': stubs.env || {},
    '../db/sequelize': { sequelize: stubs.sequelize || mockSequelize },
    '../models': stubs.models || {},
    '../modules/uns/uns-validator.service': stubs.validator || { parseTopic: () => ({}) },
    '../modules/uns/uns-topic-generator.service': stubs.topicGen || { buildCanonicalUnsTopic: () => '' },
    './ride-signal-capability.service': stubs.capability || { capabilitySignalSource: () => 'NOT_AVAILABLE' },
    './mqtt-sparkplug-live-buffer.service': stubs.sparkplug || {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
}

test('off mode returns SKIP', async () => {
  const svc = loadWithStubs({
    env: { mqttCapabilityGuardMode: 'off', mqttCapabilityGuardAllowedRideIds: '' },
    models: {},
  });
  const r = await svc.evaluateInboundMqttCapability({
    topic: 'tpuns/ep/v1/entities/ride_a/queue_time',
    payloadJson: {},
  });
  assert.equal(r.decision, 'SKIP');
  assert.equal(r.reason, 'guard_off');
});

test('warn_only unknown topic returns WARN', async () => {
  const svc = loadWithStubs({
    env: { mqttCapabilityGuardMode: 'warn_only', mqttCapabilityGuardAllowedRideIds: '' },
    sequelize: mockSequelize,
    models: {
      Park: { findOne: async () => ({ id: 'p1' }) },
      AssetType: { findOne: async () => ({ id: 't1' }) },
      ParkAsset: { findOne: async () => ({ assetId: 'a1', parkId: 'p1' }) },
      SignalCatalog: { findOne: async () => null },
      RideSignalCapability: { findOne: async () => null },
      UnsRegistryTopic: { findOne: async () => null },
      MqttInboundMessage: {},
      UnsDiscoveryEvent: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR,
      SPY_CLASSIFICATION: {},
    },
    validator: {
      parseTopic: () => ({
        parkSlug: 'ep',
        version: 'v1',
        domain: 'entities',
        assetSlug: 'ride_a',
        metric: 'queue_time',
      }),
    },
    capability: { capabilitySignalSource: () => 'NOT_AVAILABLE' },
    sparkplug: {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
  const r = await svc.evaluateInboundMqttCapability({
    topic: 'tpuns/ep/v1/entities/ride_a/queue_time',
    payloadJson: { ts: new Date().toISOString() },
  });
  assert.equal(r.decision, 'WARN');
});

test('enforce unknown topic returns BLOCK', async () => {
  const svc = loadWithStubs({
    env: { mqttCapabilityGuardMode: 'enforce', mqttCapabilityGuardAllowedRideIds: '' },
    sequelize: mockSequelize,
    models: {
      Park: { findOne: async () => ({ id: 'p1' }) },
      AssetType: { findOne: async () => ({ id: 't1' }) },
      ParkAsset: { findOne: async () => ({ assetId: 'a1', parkId: 'p1' }) },
      SignalCatalog: { findOne: async () => ({ id: 'sc1' }) },
      RideSignalCapability: { findOne: async () => ({}) },
      UnsRegistryTopic: { findOne: async () => null },
      MqttInboundMessage: {},
      UnsDiscoveryEvent: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR,
      SPY_CLASSIFICATION: {},
    },
    validator: {
      parseTopic: () => ({
        parkSlug: 'ep',
        version: 'v1',
        domain: 'entities',
        assetSlug: 'ride_a',
        metric: 'queue_time',
      }),
    },
    capability: { capabilitySignalSource: () => 'MQTT_EDGE' },
    sparkplug: {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
  const r = await svc.evaluateInboundMqttCapability({
    topic: 'tpuns/ep/v1/entities/ride_a/queue_time',
    payloadJson: {},
  });
  assert.equal(r.decision, 'BLOCK');
  assert.equal(r.reason, 'no_active_prepared_registry_topic');
});

test('active registry + MQTT_EDGE capability returns ALLOW', async () => {
  const svc = loadWithStubs({
    env: { mqttCapabilityGuardMode: 'enforce', mqttCapabilityGuardAllowedRideIds: '' },
    sequelize: mockSequelize,
    models: {
      Park: { findOne: async () => ({ id: 'p1' }) },
      AssetType: { findOne: async () => ({ id: 't1' }) },
      ParkAsset: { findOne: async () => ({ assetId: 'a1', parkId: 'p1' }) },
      SignalCatalog: { findOne: async () => ({ id: 'sc1' }) },
      RideSignalCapability: { findOne: async () => ({}) },
      UnsRegistryTopic: {
        findOne: async () => ({ id: 'rt1', parkId: 'p1' }),
      },
      MqttInboundMessage: {},
      UnsDiscoveryEvent: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR,
      SPY_CLASSIFICATION: {},
    },
    validator: {
      parseTopic: () => ({
        parkSlug: 'ep',
        version: 'v1',
        domain: 'entities',
        assetSlug: 'ride_a',
        metric: 'queue_time',
      }),
    },
    capability: { capabilitySignalSource: () => 'MQTT_EDGE' },
    sparkplug: {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
  const topic = 'tpuns/ep/v1/entities/ride_a/queue_time';
  const r = await svc.evaluateInboundMqttCapability({ topic, payloadJson: {} });
  assert.equal(r.decision, 'ALLOW');
});

test('active registry but NOT_AVAILABLE returns BLOCK in enforce', async () => {
  const svc = loadWithStubs({
    env: { mqttCapabilityGuardMode: 'enforce', mqttCapabilityGuardAllowedRideIds: '' },
    sequelize: mockSequelize,
    models: {
      Park: { findOne: async () => ({ id: 'p1' }) },
      AssetType: { findOne: async () => ({ id: 't1' }) },
      ParkAsset: { findOne: async () => ({ assetId: 'a1', parkId: 'p1' }) },
      SignalCatalog: { findOne: async () => ({ id: 'sc1' }) },
      RideSignalCapability: { findOne: async () => ({}) },
      UnsRegistryTopic: {
        findOne: async () => ({ id: 'rt1', parkId: 'p1' }),
      },
      MqttInboundMessage: {},
      UnsDiscoveryEvent: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR,
      SPY_CLASSIFICATION: {},
    },
    validator: {
      parseTopic: () => ({
        parkSlug: 'ep',
        version: 'v1',
        domain: 'entities',
        assetSlug: 'ride_a',
        metric: 'queue_time',
      }),
    },
    capability: { capabilitySignalSource: () => 'NOT_AVAILABLE' },
    sparkplug: {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
  const r = await svc.evaluateInboundMqttCapability({
    topic: 'tpuns/ep/v1/entities/ride_a/queue_time',
    payloadJson: {},
  });
  assert.equal(r.decision, 'BLOCK');
});

test('allow-list excludes non-pilot ride from enforcement (ALLOW)', async () => {
  const pilotId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const svc = loadWithStubs({
    env: {
      mqttCapabilityGuardMode: 'enforce',
      mqttCapabilityGuardAllowedRideIds: pilotId,
    },
    sequelize: mockSequelize,
    models: {
      Park: { findOne: async () => ({ id: 'p1' }) },
      AssetType: { findOne: async () => ({ id: 't1' }) },
      ParkAsset: { findOne: async () => ({ assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', parkId: 'p1' }) },
      SignalCatalog: { findOne: async () => null },
      RideSignalCapability: { findOne: async () => null },
      UnsRegistryTopic: { findOne: async () => null },
      MqttInboundMessage: {},
      UnsDiscoveryEvent: {},
      REGISTRY_SOURCE_PREPARED_OPERATOR,
      SPY_CLASSIFICATION: {},
    },
    validator: {
      parseTopic: () => ({
        parkSlug: 'ep',
        version: 'v1',
        domain: 'entities',
        assetSlug: 'other_ride',
        metric: 'queue_time',
      }),
    },
    capability: { capabilitySignalSource: () => 'NOT_AVAILABLE' },
    sparkplug: {
      parseSparkplugTopic: () => null,
      resolveCanonicalDomainForLiveRow: () => 'entities',
    },
  });
  const r = await svc.evaluateInboundMqttCapability({
    topic: 'tpuns/ep/v1/entities/other_ride/queue_time',
    payloadJson: {},
  });
  assert.equal(r.decision, 'ALLOW');
  assert.equal(r.reason, 'pilot_allow_list_excluded');
});

test('shouldQuarantineLiveMqttPersistence: enforce quarantines non-ALLOW (unknown / SKIP / BLOCK)', () => {
  assert.equal(shouldQuarantineLiveMqttPersistence('enforce', 'ALLOW'), false);
  assert.equal(shouldQuarantineLiveMqttPersistence('enforce', 'BLOCK'), true);
  assert.equal(shouldQuarantineLiveMqttPersistence('enforce', 'SKIP'), true);
  assert.equal(shouldQuarantineLiveMqttPersistence('enforce', 'WARN'), true);
});

test('shouldQuarantineLiveMqttPersistence: warn_only and off never quarantine', () => {
  assert.equal(shouldQuarantineLiveMqttPersistence('warn_only', 'BLOCK'), false);
  assert.equal(shouldQuarantineLiveMqttPersistence('warn_only', 'WARN'), false);
  assert.equal(shouldQuarantineLiveMqttPersistence('off', 'BLOCK'), false);
  assert.equal(shouldQuarantineLiveMqttPersistence('off', 'SKIP'), false);
});
