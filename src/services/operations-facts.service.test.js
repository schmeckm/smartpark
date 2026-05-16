'use strict';

/**
 * Phase 9 validation (no DB writes from this module — integration checklist):
 * - Ride with active PREPARED_OPERATOR topic + uns_latest_states row → REGISTRY / HIGH in sourceBreakdown for mapped KPI.
 * - Ride without registry topics → LEGACY_UNS / CANONICAL / OBSERVATION paths only.
 * - Mixed: some signals REGISTRY, others legacy → partial breakdown + fallback warnings.
 * - No data → MISSING + warnings; response still 200.
 * - Confirm operations-facts.service never imports writers for uns_nodes / uns_latest_states / registry mutations.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const modelsCore = require('../models');
const {
  kpiKeyForSignalCode,
  pickBetterResolution,
  KPI_FIELDS,
  shouldBlockLegacyFallback,
  evaluateRegistryPathUsable,
} = require('./operations-facts.service');

test('kpiKeyForSignalCode maps catalog-style codes', () => {
  assert.equal(kpiKeyForSignalCode('queue_time'), 'queueTime');
  assert.equal(kpiKeyForSignalCode('throughput_actual'), 'throughputActual');
  assert.equal(kpiKeyForSignalCode('STATUS'), 'status');
  assert.equal(kpiKeyForSignalCode('unknown_metric_xyz'), null);
});

test('pickBetterResolution prefers REGISTRY over LEGACY_UNS', () => {
  const a = { value: 1, source: 'LEGACY_UNS', confidence: 'HIGH', reason: 'x' };
  const b = { value: 2, source: 'REGISTRY', confidence: 'MEDIUM', reason: 'y' };
  assert.equal(pickBetterResolution(a, b).source, 'REGISTRY');
  assert.equal(pickBetterResolution(b, a).source, 'REGISTRY');
});

test('pickBetterResolution keeps higher value tier when same source rank', () => {
  const a = { value: 1, source: 'CANONICAL', confidence: 'LOW', reason: 'x' };
  const b = { value: 2, source: 'CANONICAL', confidence: 'MEDIUM', reason: 'y' };
  assert.equal(pickBetterResolution(a, b).confidence, 'MEDIUM');
});

test('KPI_FIELDS includes status and queueTime', () => {
  assert.ok(KPI_FIELDS.includes('queueTime'));
  assert.ok(KPI_FIELDS.includes('status'));
});

test('shouldBlockLegacyFallback skips legacy only when policy demands and registry resolution is empty', () => {
  assert.equal(shouldBlockLegacyFallback({ legacyFallbackDisabled: true }, null), true);
  assert.equal(
    shouldBlockLegacyFallback({ legacyFallbackDisabled: true }, { value: 1, source: 'REGISTRY' }),
    false
  );
  assert.equal(shouldBlockLegacyFallback(null, null), false);
});

test('evaluateRegistryPathUsable: registry publish preview used when present', async () => {
  const ofs = proxyquire('./operations-facts.service', {
    '../models': {
      ...modelsCore,
      RegistryPublishEvent: {
        findOne: async () => ({
          get(k) {
            if (k === 'payloadPreview') return JSON.stringify({ value: 77, v: 77 });
            return null;
          },
        }),
      },
      UnsLatestState: { findOne: async () => null },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
  });

  const activeTopic = {
    id: 'topic-a',
    get(k) {
      if (k === 'isActive') return true;
      return null;
    },
  };
  const ctx = { assetId: 'ride-1', parkSlug: 'p' };
  const probe = await ofs.evaluateRegistryPathUsable(activeTopic, 'tpuns/p/v1/ride/x/q', ctx, 'queue_time');
  assert.equal(probe.usable, true);
  assert.equal(probe.resolution.value, 77);
  assert.equal(probe.resolution.source, 'REGISTRY');
});

test('evaluateRegistryPathUsable: uns_latest_states fills gap when publish preview missing', async () => {
  const ofs = proxyquire('./operations-facts.service', {
    '../models': {
      ...modelsCore,
      RegistryPublishEvent: { findOne: async () => null },
      UnsLatestState: {
        findOne: async () => ({
          get(k) {
            if (k === 'payloadJson') return { value: 44 };
            return null;
          },
        }),
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
  });
  const activeTopic = { id: 't2', get: () => true };
  const ctx = { assetId: 'ride-1', parkSlug: 'p' };
  const probe = await ofs.evaluateRegistryPathUsable(activeTopic, 'tpuns/p/v1/ride/x/q', ctx, 'queue_time');
  assert.equal(probe.usable, true);
  assert.equal(probe.resolution.value, 44);
});

test('evaluateRegistryPathUsable: missing active topic yields unusable path', async () => {
  const topic = 'tpuns/p/v1/ride/x/q';
  const probe = await evaluateRegistryPathUsable(undefined, topic, { assetId: 'r', parkSlug: 'p' }, 'queue_time');
  assert.equal(probe.usable, false);
});

test('sourceBreakdown shape: getRideFacts exposes source + confidence on KPI queueTime (mocked ride stack)', async () => {
  const ofs = proxyquire('./operations-facts.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findByPk: async () => ({
          assetId: 'ride-x',
          parkId: 'park-x',
          slug: 'coaster',
          name: 'Coaster',
          status: 'OPEN',
          park: { id: 'park-x', slug: 'psp', externalEntityId: 'ep' },
          assetType: { code: 'RIDE' },
          get(k) {
            const m = { assetId: 'ride-x', parkId: 'park-x', slug: 'coaster', name: 'Coaster', status: 'OPEN' };
            return m[k] ?? null;
          },
        }),
      },
      RegistrySignalDeprecation: { findAll: async () => [] },
      RideSignalCapability: {
        findAll: async () => [
          {
            registrySource: 'OPERATOR_CONFIGURED',
            signal: {
              get(k) {
                if (k === 'signalCode') return 'queue_time';
                return null;
              },
            },
            get(k) {
              if (k === 'signalCatalogId') return 'cat1';
              if (k === 'capabilityJson') return { signalSource: 'ADAPTER' };
              if (k === 'registrySource') return 'OPERATOR_CONFIGURED';
              return null;
            },
          },
        ],
      },
      SignalCatalog: {},
      UnsRegistryTopic: { findAll: async () => [] },
      SparkplugMetricDefinition: { findAll: async () => [] },
      CanonicalInboundMessage: { findOne: async () => null },
      AssetObservation: { findOne: async () => null },
      RideWaitTimeSample: { findOne: async () => null },
      RegistryPublishEvent: { findOne: async () => null },
      UnsLatestState: {
        findOne: async () => ({
          get(k) {
            if (k === 'payloadJson') return { value: 33 };
            return null;
          },
        }),
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: 'ride-x',
        parkId: 'park-x',
        parkSlug: 'psp',
        assetSlug: 'coaster',
        asset: { externalEntityId: 'ea', get: (k) => (k === 'externalEntityId' ? 'ea' : null) },
        park: { externalEntityId: 'ep', get: (k) => (k === 'externalEntityId' ? 'ep' : null) },
      }),
      preparedUnsTopicsForRide: () => [],
      capabilitySignalSource: () => 'ADAPTER',
    },
    './approved-operational-signal.service': {
      evaluateApprovedForOperationsFactsRow: () => ({ approved: true, reason: 'ok' }),
    },
  });

  const doc = await ofs.getRideFacts('ride-x');
  assert.equal(doc.sourceBreakdown.queueTime.source, 'LEGACY_UNS');
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(doc.sourceBreakdown.queueTime.confidence));
  assert.ok(doc.warnings.some((w) => String(w).includes('legacy')));
});

test('getRideFacts: legacy fallback disabled yields MISSING and skips uns_latest_states when no registry topic', async () => {
  const ofs = proxyquire('./operations-facts.service', {
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findByPk: async () => ({
          assetId: 'ride-x',
          parkId: 'park-x',
          slug: 'coaster',
          name: 'Coaster',
          status: 'OPEN',
          park: { id: 'park-x', slug: 'psp', externalEntityId: 'ep' },
          assetType: { code: 'RIDE' },
          get(k) {
            const m = { assetId: 'ride-x', parkId: 'park-x', slug: 'coaster', name: 'Coaster', status: 'OPEN' };
            return m[k] ?? null;
          },
        }),
      },
      RegistrySignalDeprecation: {
        findAll: async () => [
          {
            get(k) {
              if (k === 'signalKey') return 'queue_time';
              if (k === 'legacyFallbackDisabled') return true;
              return null;
            },
          },
        ],
      },
      RideSignalCapability: {
        findAll: async () => [
          {
            registrySource: 'OPERATOR_CONFIGURED',
            signal: {
              get(k) {
                if (k === 'signalCode') return 'queue_time';
                return null;
              },
            },
            get(k) {
              if (k === 'signalCatalogId') return 'cat1';
              if (k === 'capabilityJson') return { signalSource: 'ADAPTER' };
              if (k === 'registrySource') return 'OPERATOR_CONFIGURED';
              return null;
            },
          },
        ],
      },
      SignalCatalog: {},
      UnsRegistryTopic: { findAll: async () => [] },
      SparkplugMetricDefinition: { findAll: async () => [] },
      CanonicalInboundMessage: { findOne: async () => null },
      AssetObservation: { findOne: async () => null },
      RideWaitTimeSample: { findOne: async () => null },
      RegistryPublishEvent: { findOne: async () => null },
      UnsLatestState: {
        findOne: async () => {
          throw new Error('uns_latest_states should not be read when fallback disabled with empty registry');
        },
      },
    },
    './mqtt-sparkplug-live-buffer.service': {
      findLatestTpunsLiveRowForTopic: () => null,
      findLatestSparkplugLiveMetricRow: () => null,
      probeSparkplugLiveMetricForRide: async () => null,
    },
    './ride-signal-capability.service': {
      resolveRideContext: async () => ({
        assetId: 'ride-x',
        parkId: 'park-x',
        parkSlug: 'psp',
        assetSlug: 'coaster',
        asset: { externalEntityId: 'ea', get: (k) => (k === 'externalEntityId' ? 'ea' : null) },
        park: { externalEntityId: 'ep', get: (k) => (k === 'externalEntityId' ? 'ep' : null) },
      }),
      preparedUnsTopicsForRide: () => [],
      capabilitySignalSource: () => 'ADAPTER',
    },
    './approved-operational-signal.service': {
      evaluateApprovedForOperationsFactsRow: () => ({ approved: true, reason: 'ok' }),
    },
  });

  const doc = await ofs.getRideFacts('ride-x');
  assert.equal(doc.queueTime, null);
  assert.equal(doc.sourceBreakdown.queueTime.source, 'MISSING');
});

/**
 * Manual validation checklist — Phase 11 signal deprecation:
 * - Migration applied: registry_signal_deprecations exists with unique (ride_asset_id, signal_key) and CHECK on fallback/authoritative.
 * - GET /api/v1/master-data/rides/:rideUuid/signal-deprecation returns signals with deprecation + health.checks.* shape.
 * - Health red when no PREPARED_OPERATOR active topic for signal; green when topic + recent PUBLISHED|DRY_RUN + no FAILED + registry value + stability (if configured).
 * - POST deprecate with disableLegacyFallback true fails with 422 when health.ok is false.
 * - POST deprecate upserts row; POST reactivate clears selected flags without deleting row.
 * - GET operations facts for ride: legacy_fallback_disabled yields MISSING + warning when registry path empty; unchanged when no row.
 */
