'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const modelsCore = require('../models');
const RIDE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test('serializeDeprecationRow returns defaults when row absent', () => {
  const { serializeDeprecationRow } = require('./registry-signal-deprecation.service');
  const d = serializeDeprecationRow(null);
  assert.equal(d.id, null);
  assert.equal(d.registryAuthoritative, false);
  assert.equal(d.legacyFallbackDisabled, false);
});

test('reactivateRegistrySignal clears governance flags but keeps row', async () => {
  let patch = null;
  const row = {
    id: 'dep-1',
    get(k) {
      const m = {
        registryAuthoritative: true,
        legacyFallbackDisabled: true,
        legacyPublishDisabled: true,
        signalKey: 'queue_time',
        signalCatalogId: 'cat1',
      };
      return m[k];
    },
    update: async (p) => {
      patch = p;
    },
    reload: async function () {
      return this;
    },
  };

  const svc = proxyquire('./registry-signal-deprecation.service', {
    '../config/env': require('../config/env'),
    '../models': {
      ...modelsCore,
      SignalCatalog: {
        findOne: async () => ({
          id: 'cat1',
          get(k) {
            if (k === 'signalCode') return 'queue_time';
            return null;
          },
        }),
      },
      RegistrySignalDeprecation: {
        findOne: async () => row,
      },
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({ assetId: RIDE, parkId: 'p1', parkSlug: 'psp', assetSlug: 'x', asset: {}, park: {} }),
      loadMergedCapabilityMap: async () => new Map(),
      capabilitySignalSource: () => 'NOT_AVAILABLE',
      preparedUnsTopicsForRide: () => [],
    },
    './operations-facts.service': {
      evaluateRegistryPathUsable: async () => ({ usable: false, detail: 'mock' }),
    },
    '../modules/uns/uns-topic-generator.service': {
      buildCanonicalUnsTopic: () => 'tpuns/psp/v1/ride/x/queue_time',
    },
  });

  const out = await svc.reactivateRegistrySignal(RIDE, { signalKey: 'queue_time' }, 'user-1');
  assert.equal(out.touched, true);
  assert.equal(patch.registryAuthoritative, false);
  assert.equal(patch.legacyFallbackDisabled, false);
  assert.equal(patch.legacyPublishDisabled, false);
});

test('deprecateRegistrySignal rejects disableLegacyFallback when health fails', async () => {
  const depRow = {
    id: 'dep-2',
    get(k) {
      const m = {
        legacyFallbackDisabled: false,
        registryAuthoritative: true,
        authoritativeMarkedAt: new Date(),
        stabilityWindowStartedAt: new Date(),
        legacyFallbackDisabledAt: null,
        legacyPublishDisabled: false,
        legacyPublishDisabledAt: null,
        validationStartedAt: new Date(),
        signalCatalogId: 'cat1',
      };
      return m[k];
    },
    update: async () => {},
    reload: async function () {
      return this;
    },
  };

  const svc = proxyquire('./registry-signal-deprecation.service', {
    '../config/env': { ...require('../config/env'), registrySignalStabilityDays: 0 },
    '../models': {
      ...modelsCore,
      SignalCatalog: {
        findOne: async () => ({
          id: 'cat1',
          get(k) {
            if (k === 'signalCode') return 'queue_time';
            return null;
          },
        }),
        findAll: async () => [
          {
            id: 'cat1',
            get(k) {
              if (k === 'signalCode') return 'queue_time';
              return null;
            },
          },
        ],
      },
      RegistrySignalDeprecation: {
        findOrCreate: async () => [depRow, false],
      },
      RegistryPublishEvent: { findOne: async () => null },
      SparkplugMetricDefinition: { findAll: async () => [] },
      UnsRegistryTopic: { findAll: async () => [] },
    },
    './operations-facts.service': {
      evaluateRegistryPathUsable: async () => ({ usable: false, detail: 'no registry value', resolution: null }),
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: RIDE,
        parkId: 'p1',
        parkSlug: 'psp',
        assetSlug: 'coaster',
        asset: {},
        park: {},
      }),
      loadMergedCapabilityMap: async () =>
        new Map([
          [
            'cat1',
            {
              get(k) {
                if (k === 'capabilityJson') return { signalSource: 'ADAPTER' };
                return 'cat1';
              },
            },
          ],
        ]),
      capabilitySignalSource: () => 'ADAPTER',
      preparedUnsTopicsForRide: () => [],
    },
    '../modules/uns/uns-topic-generator.service': {
      buildCanonicalUnsTopic: () => 'tpuns/psp/v1/ride/coaster/queue_time',
    },
  });

  await assert.rejects(
    () =>
      svc.deprecateRegistrySignal(
        RIDE,
        {
          signalKey: 'queue_time',
          registryAuthoritative: true,
          disableLegacyFallback: true,
        },
        'u1'
      ),
    (e) => e.code === 'DEPRECATION_HEALTH_FAILED'
  );
});
