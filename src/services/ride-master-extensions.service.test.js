'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeExtensions,
  getExtensions,
  getSupportedDomains,
  getSignals,
  isSignalEnabled,
  isSignalMlEligible,
  isSignalBoardEligible,
  withUnsExtensionsOnMasterProfile,
  toReadApiPayload,
  UNS_ASSET_EXTENSIONS_KEY,
} = require('./ride-master-extensions.service');

test('getExtensions returns safe defaults when record is missing or empty', () => {
  const a = getExtensions(null);
  assert.equal(a.schemaVersion, 1);
  assert.deepEqual(a.domains, []);
  assert.deepEqual(a.signals, {});
  assert.equal(a.capabilities.hasQueueSignal, false);
  const b = getExtensions({});
  assert.deepEqual(b.domains, []);
  const c = getExtensions({ masterProfile: {} });
  assert.deepEqual(c.signals, {});
});

test('getExtensions reads ParkAsset-style master_profile.unsAssetExtensions', () => {
  const row = {
    masterProfile: {
      dispatch_interval_sec: 120,
      [UNS_ASSET_EXTENSIONS_KEY]: {
        schemaVersion: 1,
        domains: ['queue', 'operations', 'unknown_domain'],
        signals: {
          'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: true },
        },
        capabilities: { hasQueueSignal: true },
      },
    },
  };
  const ext = getExtensions(row);
  assert.deepEqual(ext.domains, ['queue', 'operations']);
  assert.equal(isSignalEnabled(row, 'queue.wait_time_min'), true);
  assert.equal(isSignalMlEligible(row, 'queue.wait_time_min'), true);
  assert.equal(isSignalBoardEligible(row, 'queue.wait_time_min'), true);
  assert.equal(ext.capabilities.hasQueueSignal, true);
});

test('getExtensions reads MDM-style top-level extensions column', () => {
  const row = {
    extensions: {
      domains: ['green'],
      signals: { 'green.power_kw': { enabled: false, mlEligible: false, boardEligible: false } },
    },
  };
  assert.deepEqual(getSupportedDomains(row), ['green']);
  assert.equal(isSignalEnabled(row, 'green.power_kw'), false);
});

test('mergeExtensions deep-merges per-signal flags and replaces domains when provided', () => {
  const base = {
    masterProfile: {
      [UNS_ASSET_EXTENSIONS_KEY]: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: false },
          'operations.cycle_time_s': { enabled: true, mlEligible: false, boardEligible: true },
        },
        capabilities: { hasQueueSignal: true, hasCycleSignal: false },
      },
    },
  };
  const next = mergeExtensions(base, {
    domains: ['queue', 'operations', 'green'],
    signals: {
      'queue.wait_time_min': { boardEligible: true },
      'green.power_kw': { enabled: false, mlEligible: false, boardEligible: false },
    },
    capabilities: { hasCycleSignal: true },
  });
  assert.deepEqual(next.domains, ['queue', 'operations', 'green']);
  assert.equal(next.signals['queue.wait_time_min'].enabled, true);
  assert.equal(next.signals['queue.wait_time_min'].mlEligible, true);
  assert.equal(next.signals['queue.wait_time_min'].boardEligible, true);
  assert.equal(next.signals['operations.cycle_time_s'].boardEligible, true);
  assert.equal(next.signals['green.power_kw'].enabled, false);
  assert.equal(next.capabilities.hasQueueSignal, true);
  assert.equal(next.capabilities.hasCycleSignal, true);
});

test('mergeExtensions preserves signals when patch omits signals', () => {
  const base = {
    extensions: {
      signals: { 'queue.wait_time_min': { enabled: true, mlEligible: false, boardEligible: false } },
    },
  };
  const next = mergeExtensions(base, { capabilities: { hasQueueSignal: true } });
  assert.equal(next.signals['queue.wait_time_min'].enabled, true);
});

test('invalid nested extension data does not throw', () => {
  const row = {
    masterProfile: {
      [UNS_ASSET_EXTENSIONS_KEY]: {
        domains: 'not-an-array',
        signals: [{ bad: true }],
        capabilities: null,
      },
    },
  };
  assert.doesNotThrow(() => getExtensions(row));
  const ext = getExtensions(row);
  assert.deepEqual(ext.domains, []);
  assert.deepEqual(ext.signals, {});
});

test('isSignal* is false for unknown keys', () => {
  const row = { extensions: { signals: {} } };
  assert.equal(isSignalEnabled(row, 'queue.wait_time_min'), false);
  assert.equal(isSignalMlEligible(row, 'queue.wait_time_min'), false);
  assert.equal(isSignalBoardEligible(row, 'queue.wait_time_min'), false);
});

test('withUnsExtensionsOnMasterProfile nests merged doc without dropping other keys', () => {
  const mp = { foo: 1, bar: { x: 2 } };
  const ext = mergeExtensions({ masterProfile: { [UNS_ASSET_EXTENSIONS_KEY]: { domains: ['queue'] } } }, {
    signals: { 'queue.a': { enabled: true, mlEligible: false, boardEligible: false } },
  });
  const next = withUnsExtensionsOnMasterProfile(mp, ext);
  assert.equal(next.foo, 1);
  assert.deepEqual(next.bar, { x: 2 });
  assert.ok(next[UNS_ASSET_EXTENSIONS_KEY]);
  assert.equal(next[UNS_ASSET_EXTENSIONS_KEY].domains.length, 1);
});

test('getSignals returns a shallow copy', () => {
  const row = { extensions: { signals: { 'a.b': { enabled: true, mlEligible: false, boardEligible: false } } } };
  const s = getSignals(row);
  s['a.b'].enabled = false;
  assert.equal(isSignalEnabled(row, 'a.b'), true);
});

test('toReadApiPayload matches read-only API contract', () => {
  const row = {
    assetId: '11111111-1111-4111-8111-111111111111',
    masterProfile: {
      [UNS_ASSET_EXTENSIONS_KEY]: {
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: true },
        },
        capabilities: { hasQueueSignal: true, hasCycleSignal: false },
      },
    },
  };
  const dto = toReadApiPayload('park_asset', row.assetId, row);
  assert.equal(dto.entityType, 'park_asset');
  assert.equal(dto.entityId, row.assetId);
  assert.deepEqual(dto.domains, ['queue']);
  assert.equal(dto.signals['queue.wait_time_min'].enabled, true);
  assert.equal(dto.capabilities.hasQueueSignal, true);
});

test('toReadApiPayload for MDM ride uses extensions column', () => {
  const ride = {
    id: '22222222-2222-4222-8222-222222222222',
    extensions: {
      domains: ['operations'],
      signals: { 'operations.cycle_time_s': { enabled: true, mlEligible: false, boardEligible: true } },
    },
  };
  const dto = toReadApiPayload('ride', ride.id, ride);
  assert.equal(dto.entityType, 'ride');
  assert.equal(dto.signals['operations.cycle_time_s'].boardEligible, true);
});

test('mergeExtensions with replaceSignals replaces entire signals map', () => {
  const row = {
    extensions: {
      domains: ['queue'],
      signals: {
        'queue.old': { enabled: true, mlEligible: false, boardEligible: false },
      },
    },
  };
  const next = mergeExtensions(row, {
    replaceSignals: true,
    signals: { 'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: false } },
  });
  assert.equal(next.signals['queue.wait_time_min'].enabled, true);
  assert.equal(next.signals['queue.old'], undefined);
});

test('mergeExtensions deep merge removes signal when value is null', () => {
  const row = {
    extensions: {
      signals: {
        'queue.a': { enabled: true, mlEligible: false, boardEligible: false },
        'queue.b': { enabled: false, mlEligible: false, boardEligible: false },
      },
    },
  };
  const next = mergeExtensions(row, { signals: { 'queue.a': null } });
  assert.equal(next.signals['queue.a'], undefined);
  assert.equal(next.signals['queue.b'].enabled, false);
});
