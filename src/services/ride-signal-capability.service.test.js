'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const RIDE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RIDE_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PARK = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CAT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const modelsCore = require('../models');

function assetRow(assetId, slug = 'coaster') {
  return {
    assetId: String(assetId),
    parkId: PARK,
    slug,
    park: { id: PARK, slug: 'testpark', name: 'Test' },
    assetType: { code: 'RIDE' },
    get(f) {
      const m = {
        assetId: String(assetId),
        parkId: PARK,
        slug,
      };
      return m[f] ?? null;
    },
  };
}

function svc(modelOverrides) {
  return proxyquire('./ride-signal-capability.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findByPk: async (id) => assetRow(id),
      },
      UnsRegistryEntity: { findOne: async () => null },
      ...modelOverrides,
    },
  });
}

test('prepareUnsTopicsForRide: NOT_AVAILABLE creates no registry topic', async () => {
  let findOrCreateCalls = 0;
  const s = svc({
    RideSignalCapability: {
      findAll: async () => [
        {
          signalCatalogId: CAT,
          get(k) {
            if (k === 'capabilityJson') return { signalSource: 'NOT_AVAILABLE' };
            return CAT;
          },
        },
      ],
    },
    SignalCatalog: {
      findByPk: async () => ({ id: CAT, signalCode: 'queue_time' }),
    },
    UnsRegistryTopic: {
      findOrCreate: async () => {
        findOrCreateCalls += 1;
        return [{}, false];
      },
    },
  });
  await s.prepareUnsTopicsForRide(RIDE_A);
  assert.equal(findOrCreateCalls, 0);
});

test('prepareUnsTopicsForRide: MASTER_DATA creates metadata-only path (no registry topic)', async () => {
  let findOrCreateCalls = 0;
  const s = svc({
    RideSignalCapability: {
      findAll: async () => [
        {
          signalCatalogId: CAT,
          get(k) {
            if (k === 'capabilityJson') return { signalSource: 'MASTER_DATA' };
            return CAT;
          },
        },
      ],
    },
    SignalCatalog: {
      findByPk: async () => ({ id: CAT, signalCode: 'queue_time' }),
    },
    UnsRegistryTopic: {
      findOrCreate: async () => {
        findOrCreateCalls += 1;
        return [{}, false];
      },
    },
  });
  await s.prepareUnsTopicsForRide(RIDE_A);
  assert.equal(findOrCreateCalls, 0);
});

test('prepareUnsTopicsForRide + prepareSparkplugMetricsForRide: MQTT_EDGE prepares UNS topic and Sparkplug metric', async () => {
  const topicWheres = [];
  const sparkWheres = [];
  const s = svc({
    RideSignalCapability: {
      findAll: async () => [
        {
          signalCatalogId: CAT,
          get(k) {
            if (k === 'capabilityJson') return { signalSource: 'MQTT_EDGE', valueType: 'number' };
            return CAT;
          },
        },
      ],
    },
    SignalCatalog: {
      findByPk: async () => ({ id: CAT, signalCode: 'queue_time', description: 'Q' }),
    },
    UnsRegistryTopic: {
      findOrCreate: async (args) => {
        topicWheres.push(args.where);
        return [{ id: 't1', update: async () => {} }, true];
      },
    },
    SparkplugMetricDefinition: {
      findOrCreate: async (args) => {
        sparkWheres.push(args.where);
        return [{ id: 's1', update: async () => {} }, true];
      },
    },
  });
  await s.prepareUnsTopicsForRide(RIDE_A);
  await s.prepareSparkplugMetricsForRide(RIDE_A);
  assert.ok(topicWheres.some((w) => String(w.topicPath || '').includes('tpuns/testpark')));
  assert.ok(sparkWheres.some((w) => w.signalKey === 'queue_time' && String(w.rideAssetId) === RIDE_A));
});

test('prepareUnsTopicsForRide: idempotent (second run updates, not duplicate create)', async () => {
  let n = 0;
  const s = svc({
    RideSignalCapability: {
      findAll: async () => [
        {
          signalCatalogId: CAT,
          get(k) {
            if (k === 'capabilityJson') return { signalSource: 'ADAPTER', valueType: 'number' };
            return CAT;
          },
        },
      ],
    },
    SignalCatalog: {
      findByPk: async () => ({ id: CAT, signalCode: 'throughput_actual', description: 'T' }),
    },
    UnsRegistryTopic: {
      findOrCreate: async () => {
        n += 1;
        const created = n === 1;
        return [
          {
            id: 't1',
            get(k) {
              if (k === 'payloadJson') return {};
              return null;
            },
            update: async () => {},
          },
          created,
        ];
      },
    },
  });
  const a = await s.prepareUnsTopicsForRide(RIDE_A);
  const b = await s.prepareUnsTopicsForRide(RIDE_A);
  assert.equal(a.created, 1);
  assert.equal(b.updated >= 1, true);
});

test('prepareSparkplugMetricsForRide: separate rows per ride for same signal key', async () => {
  const keys = [];
  const mk = (rideId) =>
    svc({
      RideSignalCapability: {
        findAll: async () => [
          {
            signalCatalogId: CAT,
            get(k) {
              if (k === 'capabilityJson') return { signalSource: 'MQTT_EDGE' };
              return CAT;
            },
          },
        ],
      },
      SignalCatalog: {
        findByPk: async () => ({ id: CAT, signalCode: 'throughput', description: 'T' }),
      },
      SparkplugMetricDefinition: {
        findOrCreate: async (args) => {
          keys.push(args.where);
          return [{ id: 's', update: async () => {} }, true];
        },
      },
    });

  const { preparedSparkplugScopeWhere } = require('./ride-signal-capability.service');
  const wA = preparedSparkplugScopeWhere({ parkId: PARK, assetId: RIDE_A }, 'throughput');
  const wB = preparedSparkplugScopeWhere({ parkId: PARK, assetId: RIDE_B }, 'throughput');
  assert.notDeepEqual(wA, wB);

  await mk(RIDE_A).prepareSparkplugMetricsForRide(RIDE_A);
  await mk(RIDE_B).prepareSparkplugMetricsForRide(RIDE_B);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0].rideAssetId, keys[1].rideAssetId);
});
