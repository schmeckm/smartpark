'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const RIDE_ID = '11111111-1111-1111-1111-111111111111';
const PARK_ID = '22222222-2222-2222-2222-222222222222';

function assetWithSignals(signals) {
  return {
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: [],
        signals,
        capabilities: {},
      },
    },
  };
}

function mockParkAsset(signals, enabled = true, board = true, ml = true) {
  return {
    assetId: RIDE_ID,
    parkId: PARK_ID,
    slug: 'coaster',
    externalEntityId: 'ext-1',
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled, boardEligible: board, mlEligible: ml },
        },
        capabilities: {},
      },
    },
    park: { slug: 'europa-park', name: 'Europa Park', id: PARK_ID },
    getDataValue(k) {
      if (k === 'masterProfile') return this.masterProfile;
      return this[k];
    },
  };
}

test('deriveUnifiedStatus precedence: entity_mismatch first', () => {
  const { deriveUnifiedStatus } = require('./signal-preview.service');
  assert.equal(
    deriveUnifiedStatus({
      sourceEntityMismatch: true,
      domainSupported: false,
      hasEntry: false,
      eligibility: { enabled: false, boardEligible: false, mlEligible: false },
      usage: 'board',
      latestValue: { value: 1 },
      skipLatestValue: false,
    }),
    'entity_mismatch'
  );
});

test('deriveUnifiedStatus: missing_signal before disabled', () => {
  const { deriveUnifiedStatus } = require('./signal-preview.service');
  assert.equal(
    deriveUnifiedStatus({
      sourceEntityMismatch: false,
      domainSupported: false,
      hasEntry: false,
      eligibility: { enabled: false, boardEligible: false, mlEligible: false },
      usage: 'board',
      latestValue: null,
      skipLatestValue: false,
    }),
    'missing_signal'
  );
});

test('deriveUnifiedStatus: not_board_eligible', () => {
  const { deriveUnifiedStatus } = require('./signal-preview.service');
  assert.equal(
    deriveUnifiedStatus({
      sourceEntityMismatch: false,
      domainSupported: true,
      hasEntry: true,
      eligibility: { enabled: true, boardEligible: false, mlEligible: true },
      usage: 'board',
      latestValue: null,
      skipLatestValue: false,
    }),
    'not_board_eligible'
  );
});

test('deriveUnifiedStatus: not_ml_eligible', () => {
  const { deriveUnifiedStatus } = require('./signal-preview.service');
  assert.equal(
    deriveUnifiedStatus({
      sourceEntityMismatch: false,
      domainSupported: true,
      hasEntry: true,
      eligibility: { enabled: true, boardEligible: true, mlEligible: false },
      usage: 'ml',
      latestValue: null,
      skipLatestValue: true,
    }),
    'not_ml_eligible'
  );
});

test('serializeSignalPreview strips legacy', () => {
  const { serializeSignalPreview } = require('./signal-preview.service');
  const p = {
    signalKey: 'q.m',
    domain: 'q',
    metric: 'm',
    eligibility: { enabled: true, boardEligible: true, mlEligible: false },
    status: 'valid',
    latestValue: null,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    legacy: { resolved: { valid: true } },
  };
  const s = serializeSignalPreview(p);
  assert.equal('legacy' in s, false);
  assert.equal(s.status, 'valid');
});

test('resolveSignalPreview: valid board signal with live value', async () => {
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => ({
        value: 42,
        unit: 'min',
        ts: new Date('2026-05-06T18:00:00.000Z'),
        quality: 'GOOD',
        source: 'uns_live_state',
      }),
    },
  });
  const asset = mockParkAsset({}, true, true, false);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'board',
    extensionsRecord: asset,
    options: { parkAssetForLatestValue: asset },
  });
  assert.equal(out.status, 'valid');
  assert.equal(out.latestValue?.value, 42);
  assert.equal(out.latestValue?.source, 'uns_live_state');
  assert.equal(out.legacy.resolved.valid, true);
});

test('resolveSignalPreview: no live value', async () => {
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => null,
    },
  });
  const asset = mockParkAsset({}, true, true, false);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'board',
    extensionsRecord: asset,
    options: { parkAssetForLatestValue: asset },
  });
  assert.equal(out.status, 'no_live_value');
  assert.equal(out.latestValue, null);
  assert.equal(out.legacy.resolved.valid, true);
});

test('resolveSignalPreview: disabled signal skips lookup', async () => {
  let calls = 0;
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => {
        calls += 1;
        return { value: 1, unit: null, ts: new Date(), quality: 'GOOD', source: 'uns_live_state' };
      },
    },
  });
  const asset = mockParkAsset({}, false, true, false);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'board',
    extensionsRecord: asset,
    options: { parkAssetForLatestValue: asset },
  });
  assert.equal(calls, 0);
  assert.equal(out.status, 'disabled');
  assert.equal(out.legacy.resolved.valid, false);
});

test('resolveSignalPreview: missing signal', async () => {
  let calls = 0;
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => {
        calls += 1;
        return { value: 1, unit: null, ts: new Date(), quality: 'GOOD', source: 'x' };
      },
    },
  });
  const extensionsOnly = assetWithSignals({});
  const parkAsset = mockParkAsset(
    { 'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false } },
    true,
    true,
    false
  );
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.missing',
    usage: 'board',
    extensionsRecord: extensionsOnly,
    options: { parkAssetForLatestValue: parkAsset },
  });
  assert.equal(calls, 0);
  assert.equal(out.status, 'missing_signal');
});

test('resolveSignalPreview: entity mismatch', async () => {
  let calls = 0;
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => {
        calls += 1;
        return { value: 1, unit: null, ts: new Date(), quality: 'GOOD', source: 'x' };
      },
    },
  });
  const asset = mockParkAsset({}, true, true, false);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'board',
    extensionsRecord: asset,
    options: { sourceEntityMismatch: true, skipLatestValue: true },
  });
  assert.equal(calls, 0);
  assert.equal(out.status, 'entity_mismatch');
  assert.equal(out.legacy.resolved.valid, false);
});

test('resolveSignalPreview: lookup failure yields null latestValue', async () => {
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => {
        throw new Error('db down');
      },
    },
  });
  const asset = mockParkAsset({}, true, true, false);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'board',
    extensionsRecord: asset,
    options: { parkAssetForLatestValue: asset },
  });
  assert.equal(out.latestValue, null);
  assert.equal(out.status, 'no_live_value');
  assert.equal(out.legacy.resolved.valid, true);
});

test('resolveSignalPreview: ml usage with skipLatestValue is valid without live read', async () => {
  const sp = proxyquire('./signal-preview.service', {
    './registry-preview.service': {
      readAddonBoardWidgetLatestValue: async () => {
        throw new Error('should not run');
      },
    },
  });
  const asset = mockParkAsset({}, true, false, true);
  const out = await sp.resolveSignalPreview({
    parkId: PARK_ID,
    entityType: 'park_asset',
    entityId: RIDE_ID,
    signalKey: 'queue.wait_time_min',
    usage: 'ml',
    extensionsRecord: asset,
    options: { skipLatestValue: true, parkAssetForLatestValue: asset },
  });
  assert.equal(out.status, 'valid');
  assert.equal(out.latestValue, null);
});
