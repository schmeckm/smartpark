'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const baseEnv = require('../config/env');
const modelsCore = require('../models');

const RIDE = '550e8400-e29b-41d4-a716-446655440000';

test('parseAllowedRideIds keeps valid UUIDs only', () => {
  const { parseAllowedRideIds } = require('./registry-publisher.service');
  const a = '550e8400-e29b-41d4-a716-446655440000';
  const b = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert.deepEqual(parseAllowedRideIds(` ${a}, bogus ,${b} `), [a, b]);
});

test('buildTpunsPayload matches registry publisher envelope', () => {
  const { buildTpunsPayload } = require('./registry-publisher.service');
  const p = buildTpunsPayload({
    value: 42,
    ts: new Date('2026-01-01T00:00:00.000Z'),
    domain: 'ride',
    assetSlug: 'blue_fire',
    metric: 'queue_time',
    unit: 'min',
    quality: 'GOOD',
    sourceType: 'MQTT_EDGE',
    registryTopicId: '11111111-1111-1111-1111-111111111111',
    rideAssetId: '22222222-2222-2222-2222-222222222222',
  });
  assert.equal(p.v, 42);
  assert.equal(p.domain, 'ride');
  assert.equal(p.metric, 'queue_time');
  assert.equal(p.source, 'REGISTRY_PUBLISHER');
  assert.equal(p.sourceType, 'MQTT_EDGE');
});

test('publishOnceRegistryPublishForRide blocked when REGISTRY_PUBLISH_ENABLED=false', async () => {
  const svc = proxyquire('./registry-publisher.service', {
    '../config/env': { ...baseEnv, registryPublishEnabled: false, registryPublishAllowedRideIds: RIDE },
  });
  await assert.rejects(
    () => svc.publishOnceRegistryPublishForRide(RIDE),
    (e) => e.code === 'REGISTRY_PUBLISH_DISABLED' || String(e.message).includes('REGISTRY_PUBLISH')
  );
});

test('publishOnceRegistryPublishForRide blocked for non-allowed ride', async () => {
  const svc = proxyquire('./registry-publisher.service', {
    '../config/env': { ...baseEnv, registryPublishEnabled: true, registryPublishAllowedRideIds: '' },
  });
  await assert.rejects(
    () => svc.publishOnceRegistryPublishForRide(RIDE),
    (e) => e.code === 'REGISTRY_PUBLISH_RIDE_NOT_ALLOWED'
  );
});

test('dry-run records DRY_RUN audit for UNS topic and does not call publishMqtt', async () => {
  const audits = [];
  let publishCalls = 0;
  const topicPath = 'tpuns/testpark/v1/ride/coaster/queue_time';

  const fakeTopic = {
    id: 'rt1',
    get(k) {
      if (k === 'topicPath') return topicPath;
      if (k === 'payloadJson') return { signalCatalogId: 'sig1', rideAssetId: RIDE };
      if (k === 'isActive') return true;
      if (k === 'registrySource') return modelsCore.REGISTRY_SOURCE_PREPARED_OPERATOR;
      return null;
    },
  };

  const svc = proxyquire('./registry-publisher.service', {
    '../config/env': {
      ...baseEnv,
      registryPublishEnabled: false,
      registryPublishMode: 'dry_run',
      registrySparkplugFormat: 'json',
      registryPublishAllowedRideIds: RIDE,
    },
    '../models': {
      ...modelsCore,
      UnsRegistryTopic: {
        findAll: async () => [fakeTopic],
      },
      SparkplugMetricDefinition: {
        findAll: async () => [],
      },
      SignalCatalog: {
        findByPk: async () => ({ id: 'sig1', signalCode: 'queue_time', unit: 'min' }),
      },
      UnsLatestState: {
        findOne: async () => ({
          get(k) {
            if (k === 'payloadJson') return { value: 9 };
            if (k === 'quality') return 'GOOD';
            return null;
          },
        }),
      },
      AssetObservation: { findOne: async () => null },
      CanonicalInboundMessage: { findOne: async () => null },
      RegistryPublishEvent: {
        create: async (row) => {
          audits.push(row);
          return row;
        },
      },
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: RIDE,
        parkId: 'park-1',
        parkSlug: 'testpark',
        assetSlug: 'coaster',
        asset: {},
        park: {},
      }),
      preparedUnsTopicsForRide: (_ctx, topics) => topics.filter((t) => t.get('isActive')),
      loadMergedCapabilityMap: async () =>
        new Map([
          [
            'sig1',
            {
              get(k) {
                if (k === 'capabilityJson') return { signalSource: 'MANUAL', valueType: 'number' };
                return 'sig1';
              },
            },
          ],
        ]),
      capabilitySignalSource: (cap) => (cap ? 'MANUAL' : 'NOT_AVAILABLE'),
      isActivationEligibleUns: () => true,
      isActivationEligibleSparkplug: () => false,
      deactivatePreparedUnsTopicsForRide: async () => ({}),
      deactivatePreparedSparkplugMetricsForRide: async () => ({}),
    },
    './mqtt-connector.service': {
      publishMqtt: async () => {
        publishCalls += 1;
        return { published: true };
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
    './ml/ride-prediction.service': {
      predictRideWaitTimes: async () => [],
    },
  });

  await svc.dryRunRegistryPublishForRide(RIDE);
  assert.ok(audits.some((a) => a.status === 'DRY_RUN'));
  assert.equal(publishCalls, 0);
});

test('parallel publish touches only active PREPARED_OPERATOR UNS topics (mocked)', async () => {
  const audits = [];
  let publishCalls = 0;
  const topicPath = 'tpuns/testpark/v1/ride/coaster/queue_time';
  const fakeTopic = {
    id: 'rt1',
    get(k) {
      if (k === 'topicPath') return topicPath;
      if (k === 'payloadJson') return { signalCatalogId: 'sig1', rideAssetId: RIDE };
      if (k === 'isActive') return true;
      if (k === 'registrySource') return modelsCore.REGISTRY_SOURCE_PREPARED_OPERATOR;
      return null;
    },
  };

  const svc = proxyquire('./registry-publisher.service', {
    '../config/env': {
      ...baseEnv,
      registryPublishEnabled: true,
      registryPublishMode: 'parallel',
      registrySparkplugFormat: 'json',
      registryPublishAllowedRideIds: RIDE,
    },
    '../models': {
      ...modelsCore,
      UnsRegistryTopic: { findAll: async () => [fakeTopic] },
      SparkplugMetricDefinition: { findAll: async () => [] },
      SignalCatalog: {
        findByPk: async () => ({ id: 'sig1', signalCode: 'queue_time', unit: 'min' }),
      },
      UnsLatestState: {
        findOne: async () => ({
          get(k) {
            if (k === 'payloadJson') return { value: 3 };
            if (k === 'quality') return 'GOOD';
            return null;
          },
        }),
      },
      AssetObservation: { findOne: async () => null },
      CanonicalInboundMessage: { findOne: async () => null },
      RegistryPublishEvent: {
        create: async (row) => {
          audits.push(row);
          return row;
        },
      },
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: RIDE,
        parkId: 'park-1',
        parkSlug: 'testpark',
        assetSlug: 'coaster',
        asset: {},
        park: {},
      }),
      preparedUnsTopicsForRide: (_ctx, topics) => topics.filter((t) => t.get('isActive')),
      loadMergedCapabilityMap: async () =>
        new Map([
          [
            'sig1',
            {
              get(k) {
                if (k === 'capabilityJson') return { signalSource: 'MANUAL' };
                return 'sig1';
              },
            },
          ],
        ]),
      capabilitySignalSource: () => 'MANUAL',
      isActivationEligibleUns: () => true,
      isActivationEligibleSparkplug: () => true,
      deactivatePreparedUnsTopicsForRide: async () => ({}),
      deactivatePreparedSparkplugMetricsForRide: async () => ({}),
    },
    './mqtt-connector.service': {
      publishMqtt: async () => {
        publishCalls += 1;
        return { published: true };
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
    './ml/ride-prediction.service': {
      predictRideWaitTimes: async () => [],
    },
  });

  await svc.publishOnceRegistryPublishForRide(RIDE);
  assert.equal(publishCalls, 1);
  assert.ok(audits.some((a) => a.status === 'PUBLISHED'));
});

test('protobuf_ready Sparkplug branch SKIPPED without wire publish', async () => {
  const audits = [];
  let publishCalls = 0;

  const fakeSpark = {
    id: 'sp1',
    get(k) {
      if (k === 'payloadJson') return { signalCatalogId: 'sig1', rideAssetId: RIDE };
      if (k === 'isActive') return true;
      if (k === 'registrySource') return modelsCore.REGISTRY_SOURCE_PREPARED_OPERATOR;
      if (k === 'edgeNodeId') return 'park_gateway';
      if (k === 'deviceId') return RIDE;
      if (k === 'signalKey') return 'queue_time';
      if (k === 'metricName') return 'queue_time';
      if (k === 'dataType') return 'number';
      return null;
    },
  };

  const svc = proxyquire('./registry-publisher.service', {
    '../config/env': {
      ...baseEnv,
      registryPublishEnabled: true,
      registryPublishMode: 'parallel',
      registrySparkplugFormat: 'protobuf_ready',
      registryPublishAllowedRideIds: RIDE,
    },
    '../models': {
      ...modelsCore,
      UnsRegistryTopic: { findAll: async () => [] },
      SparkplugMetricDefinition: { findAll: async () => [fakeSpark] },
      SignalCatalog: {
        findByPk: async () => ({ id: 'sig1', signalCode: 'queue_time', unit: 'min' }),
      },
      UnsLatestState: { findOne: async () => null },
      AssetObservation: { findOne: async () => null },
      CanonicalInboundMessage: { findOne: async () => null },
      RegistryPublishEvent: {
        create: async (row) => {
          audits.push(row);
          return row;
        },
      },
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: RIDE,
        parkId: 'park-1',
        parkSlug: 'testpark',
        assetSlug: 'coaster',
        asset: {},
        park: {},
      }),
      preparedUnsTopicsForRide: () => [],
      loadMergedCapabilityMap: async () =>
        new Map([
          [
            'sig1',
            {
              get(k) {
                if (k === 'capabilityJson') return { signalSource: 'MQTT_EDGE', valueType: 'number' };
                return 'sig1';
              },
            },
          ],
        ]),
      capabilitySignalSource: () => 'MQTT_EDGE',
      isActivationEligibleUns: () => false,
      isActivationEligibleSparkplug: () => true,
      deactivatePreparedUnsTopicsForRide: async () => ({}),
      deactivatePreparedSparkplugMetricsForRide: async () => ({}),
    },
    './mqtt-connector.service': {
      publishMqtt: async () => {
        publishCalls += 1;
        return { published: true };
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => ({ value: 12, quality: 'GOOD' }),
      probeSparkplugLiveMetricForRide: async () => ({
        row: { value: 12, quality: 'GOOD' },
        edgeNodeId: 'park_gateway',
        deviceId: RIDE,
        groupId: 'testpark',
      }),
    },
    './ml/ride-prediction.service': {
      predictRideWaitTimes: async () => [],
    },
  });

  await svc.publishOnceRegistryPublishForRide(RIDE);
  assert.ok(audits.some((a) => a.status === 'SKIPPED' && a.reason === 'protobuf_ready_no_wire_encode'));
  assert.equal(publishCalls, 0);
});
