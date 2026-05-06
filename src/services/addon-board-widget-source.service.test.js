'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const modelsCore = require('../models');
const {
  readDraftFromMasterProfile,
  assertSignalBoardEligible,
  resolveDraftPreviewForAsset,
} = require('./addon-board-widget-source.service');

const RIDE_ID = '11111111-1111-1111-1111-111111111111';
const PARK_ID = '22222222-2222-2222-2222-222222222222';

/**
 * @param {{ readAddonBoardWidgetLatestValue: (...args: unknown[]) => unknown }} registryStub
 */
function signalPreviewWithRegistryMock(registryStub) {
  return proxyquire('./signal-preview.service', {
    './registry-preview.service': registryStub,
  });
}

function masterProfileValidDraft(enabled = true) {
  return {
    addonBoardWidgetSourceDraft: {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: RIDE_ID,
      signalKey: 'queue.wait_time_min',
    },
    unsAssetExtensions: {
      schemaVersion: 1,
      domains: ['queue'],
      signals: {
        'queue.wait_time_min': { enabled, boardEligible: true, mlEligible: false },
      },
      capabilities: {},
    },
  };
}

function mockAssetRow(mp) {
  return {
    assetId: RIDE_ID,
    parkId: PARK_ID,
    slug: 'big-coaster',
    externalEntityId: 'ext-entity-1',
    masterProfile: mp,
    park: { slug: 'europa-park', name: 'Europa Park', id: PARK_ID },
    getDataValue(k) {
      if (k === 'masterProfile') return this.masterProfile;
      return this[k];
    },
  };
}

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

test('readDraftFromMasterProfile returns null when missing or invalid', () => {
  assert.equal(readDraftFromMasterProfile(null), null);
  assert.equal(readDraftFromMasterProfile({}), null);
  assert.equal(
    readDraftFromMasterProfile({
      addonBoardWidgetSourceDraft: { sourceType: 'OTHER', entityType: 'park_asset', entityId: 'x', signalKey: 'a.b' },
    }),
    null
  );
});

test('readDraftFromMasterProfile returns normalized draft', () => {
  const d = readDraftFromMasterProfile({
    addonBoardWidgetSourceDraft: {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: '11111111-1111-1111-1111-111111111111',
      signalKey: 'queue.wait',
    },
  });
  assert.ok(d);
  assert.equal(d.signalKey, 'queue.wait');
  assert.equal(d.entityType, 'park_asset');
});

test('assertSignalBoardEligible requires enabled and boardEligible', () => {
  const a = assetWithSignals({
    'queue.ok': { enabled: true, boardEligible: true, mlEligible: false },
  });
  assert.equal(assertSignalBoardEligible(a, 'queue.ok').ok, true);
  assert.equal(assertSignalBoardEligible(a, 'queue.bad').ok, false);
  const a2 = assetWithSignals({
    'queue.off': { enabled: false, boardEligible: true, mlEligible: false },
  });
  assert.equal(assertSignalBoardEligible(a2, 'queue.off').ok, false);
});

test('assertSignalBoardEligible rejects unsupported domain prefix', () => {
  const a = assetWithSignals({
    'bogus.metric': { enabled: true, boardEligible: true, mlEligible: false },
  });
  assert.equal(assertSignalBoardEligible(a, 'bogus.metric').ok, false);
});

test('resolveDraftPreviewForAsset is valid when enabled and boardEligible', () => {
  const a = assetWithSignals({
    'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false },
  });
  const r = resolveDraftPreviewForAsset(a, { signalKey: 'queue.wait_time_min' });
  assert.equal(r.valid, true);
  assert.equal(r.domain, 'queue');
  assert.equal(r.metric, 'wait_time_min');
  assert.equal(r.enabled, true);
  assert.equal(r.boardEligible, true);
});

test('resolveDraftPreviewForAsset is invalid when metadata toggled off', () => {
  const a = assetWithSignals({
    'queue.wait_time_min': { enabled: false, boardEligible: true, mlEligible: false },
  });
  const r = resolveDraftPreviewForAsset(a, { signalKey: 'queue.wait_time_min' });
  assert.equal(r.valid, false);
  assert.equal(r.enabled, false);
});

test('resolveDraftPreviewForAsset is invalid when signal removed', () => {
  const a = assetWithSignals({});
  const r = resolveDraftPreviewForAsset(a, { signalKey: 'queue.missing' });
  assert.equal(r.valid, false);
  assert.equal(r.enabled, false);
  assert.equal(r.boardEligible, false);
});

test('getWidgetSourceDraftPreview: valid draft + latestValue from lookup', async () => {
  let lookupCalls = 0;
  const sp = signalPreviewWithRegistryMock({
    readAddonBoardWidgetLatestValue: async () => {
      lookupCalls += 1;
      return {
        value: 42,
        unit: 'min',
        ts: new Date('2026-05-06T17:00:00.000Z'),
        quality: 'GOOD',
        source: 'uns_live_state',
      };
    },
  });
  const { getWidgetSourceDraftPreview } = proxyquire('./addon-board-widget-source.service', {
    './signal-preview.service': sp,
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => mockAssetRow(masterProfileValidDraft(true)),
      },
    },
  });
  const out = await getWidgetSourceDraftPreview(PARK_ID, RIDE_ID);
  assert.ok(out);
  assert.equal(lookupCalls, 1);
  assert.equal(out.latestValue.value, 42);
  assert.equal(out.latestValue.unit, 'min');
  assert.equal(out.latestValue.ts, '2026-05-06T17:00:00.000Z');
  assert.equal(out.latestValue.quality, 'GOOD');
  assert.equal(out.latestValue.source, 'uns_live_state');
  assert.ok(out.signalPreview);
  assert.equal(out.signalPreview.status, 'valid');
});

test('getWidgetSourceDraftPreview: valid draft + no live value', async () => {
  let lookupCalls = 0;
  const sp = signalPreviewWithRegistryMock({
    readAddonBoardWidgetLatestValue: async () => {
      lookupCalls += 1;
      return null;
    },
  });
  const { getWidgetSourceDraftPreview } = proxyquire('./addon-board-widget-source.service', {
    './signal-preview.service': sp,
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => mockAssetRow(masterProfileValidDraft(true)),
      },
    },
  });
  const out = await getWidgetSourceDraftPreview(PARK_ID, RIDE_ID);
  assert.ok(out);
  assert.equal(lookupCalls, 1);
  assert.equal(out.latestValue, null);
  assert.equal(out.signalPreview.status, 'no_live_value');
});

test('getWidgetSourceDraftPreview: invalid draft does not call live lookup', async () => {
  let lookupCalls = 0;
  const sp = signalPreviewWithRegistryMock({
    readAddonBoardWidgetLatestValue: async () => {
      lookupCalls += 1;
      return { value: 1, unit: null, ts: new Date(), quality: 'GOOD', source: 'uns_live_state' };
    },
  });
  const { getWidgetSourceDraftPreview } = proxyquire('./addon-board-widget-source.service', {
    './signal-preview.service': sp,
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => mockAssetRow(masterProfileValidDraft(false)),
      },
    },
  });
  const out = await getWidgetSourceDraftPreview(PARK_ID, RIDE_ID);
  assert.ok(out);
  assert.equal(out.resolved.valid, false);
  assert.equal(lookupCalls, 0);
  assert.equal(out.latestValue, null);
});

test('getWidgetSourceDraftPreview: lookup failure yields latestValue null', async () => {
  const sp = signalPreviewWithRegistryMock({
    readAddonBoardWidgetLatestValue: async () => {
      throw new Error('simulated lookup failure');
    },
  });
  const { getWidgetSourceDraftPreview } = proxyquire('./addon-board-widget-source.service', {
    './signal-preview.service': sp,
    '../models': {
      ...modelsCore,
      ParkAsset: {
        findOne: async () => mockAssetRow(masterProfileValidDraft(true)),
      },
    },
  });
  const out = await getWidgetSourceDraftPreview(PARK_ID, RIDE_ID);
  assert.ok(out);
  assert.equal(out.resolved.valid, true);
  assert.equal(out.latestValue, null);
});

test('resolveSignalMetadataLatestPreview shares Phase I lookup path', async () => {
  const asset = mockAssetRow(masterProfileValidDraft(true));
  let calls = 0;
  const sp = signalPreviewWithRegistryMock({
    readAddonBoardWidgetLatestValue: async () => {
      calls += 1;
      return {
        value: 5,
        unit: 'min',
        ts: new Date('2026-05-06T18:00:00.000Z'),
        quality: 'GOOD',
        source: 'uns_live_state',
      };
    },
  });
  const { resolveSignalMetadataLatestPreview } = proxyquire('./addon-board-widget-source.service', {
    './signal-preview.service': sp,
  });
  const out = await resolveSignalMetadataLatestPreview(asset, PARK_ID, 'queue.wait_time_min');
  assert.equal(calls, 1);
  assert.equal(out.resolved.valid, true);
  assert.equal(out.latestValue?.value, 5);
  assert.equal(out.latestValue?.source, 'uns_live_state');
  assert.equal(out.signalPreview?.status, 'valid');
});
