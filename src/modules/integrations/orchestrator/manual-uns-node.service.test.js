'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ManualUnsNodeService,
  MANUAL_UNS_NODES_SETTING_KEY,
} = require('./manual-uns-node.service');

/**
 * Phase C3.1 unit tests. The service is stateless wrt selected park —
 * tests construct it with an in-memory `AppSettingRepository` mock that
 * mirrors the real repository's two methods (`getValue` / `upsertValue`).
 */

function makeMockRepo(initial = null) {
  const store = new Map();
  if (initial != null) store.set(MANUAL_UNS_NODES_SETTING_KEY, initial);
  return {
    store,
    async getValue(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async upsertValue(key, value) {
      store.set(key, value);
    },
  };
}

const PARK_A = { provider: 'themeparks_wiki', externalParkId: 'park-a' };
const PARK_B = { provider: 'themeparks_wiki', externalParkId: 'park-b' };

test('ManualUnsNodeService: SETTING_KEY is the legacy "uns.manualNodes" key', () => {
  assert.equal(
    MANUAL_UNS_NODES_SETTING_KEY,
    'uns.manualNodes',
    'app_settings persistence key MUST NOT change without a data migration'
  );
});

test('ManualUnsNodeService.list: empty store returns empty array', async () => {
  const repo = makeMockRepo();
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const out = await svc.list(PARK_A);
  assert.deepEqual(out, []);
});

test('ManualUnsNodeService.list: filters by provider + externalParkId', async () => {
  const repo = makeMockRepo([
    { id: '1', provider: PARK_A.provider, externalParkId: PARK_A.externalParkId, domain: 'rides', assetSlug: 'a', metric: 'queue_time' },
    { id: '2', provider: PARK_A.provider, externalParkId: PARK_B.externalParkId, domain: 'rides', assetSlug: 'b', metric: 'queue_time' },
    { id: '3', provider: 'wartezeiten_app', externalParkId: PARK_A.externalParkId, domain: 'rides', assetSlug: 'c', metric: 'queue_time' },
  ]);
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const out = await svc.list(PARK_A);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
});

test('ManualUnsNodeService.list: tolerates non-array stored value', async () => {
  const repo = makeMockRepo({ not: 'an array' });
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const out = await svc.list(PARK_A);
  assert.deepEqual(out, []);
});

test('ManualUnsNodeService.add: appends a row and persists with normalized fields', async () => {
  const repo = makeMockRepo();
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const row = await svc.add({
    ...PARK_A,
    input: {
      domain: 'Operations Domain',
      assetSlug: 'Big Ride',
      metric: 'Queue Time',
      assetName: 'Big Ride Display',
      entityType: 'attraction',
    },
  });
  assert.equal(row.provider, PARK_A.provider);
  assert.equal(row.externalParkId, PARK_A.externalParkId);
  assert.equal(row.domain, 'operations_domain');
  assert.equal(row.assetSlug, 'big_ride');
  assert.equal(row.metric, 'queue_time');
  assert.equal(row.assetName, 'Big Ride Display');
  assert.equal(row.entityType, 'ATTRACTION');
  assert.equal(row.source, 'MANUAL');
  assert.match(row.id, /^[0-9a-f-]{36}$/i);
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const stored = repo.store.get(MANUAL_UNS_NODES_SETTING_KEY);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, row.id);
});

test('ManualUnsNodeService.add: falls back to entityType-based domain when domain missing', async () => {
  const repo = makeMockRepo();
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const row = await svc.add({
    ...PARK_A,
    input: { assetSlug: 'x', metric: 'queue_time', entityType: 'attraction' },
  });
  // resolveThemeParksPublicationDomain normalizes ATTRACTION → 'attraction'.
  assert.equal(typeof row.domain, 'string');
  assert.notEqual(row.domain, '', 'fallback domain must not be empty');
});

test('ManualUnsNodeService.add: assetName falls back to assetSlug', async () => {
  const repo = makeMockRepo();
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const row = await svc.add({
    ...PARK_A,
    input: { assetSlug: 'wodan', metric: 'queue_time' },
  });
  assert.equal(row.assetName, 'wodan');
});

test('ManualUnsNodeService.add: entityType empty/whitespace becomes null', async () => {
  const repo = makeMockRepo();
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const row = await svc.add({
    ...PARK_A,
    input: { assetSlug: 'x', metric: 'queue_time', entityType: '   ' },
  });
  assert.equal(row.entityType, null);
});

test('ManualUnsNodeService.remove: removes a matching row and returns true', async () => {
  const repo = makeMockRepo([
    { id: '1', provider: PARK_A.provider, externalParkId: PARK_A.externalParkId },
    { id: '2', provider: PARK_A.provider, externalParkId: PARK_A.externalParkId },
  ]);
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const removed = await svc.remove({ ...PARK_A, id: '1' });
  assert.equal(removed, true);
  const stored = repo.store.get(MANUAL_UNS_NODES_SETTING_KEY);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, '2');
});

test('ManualUnsNodeService.remove: returns false when no row matches', async () => {
  const repo = makeMockRepo([
    { id: '1', provider: PARK_A.provider, externalParkId: PARK_A.externalParkId },
  ]);
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const removed = await svc.remove({ ...PARK_A, id: 'unknown' });
  assert.equal(removed, false);
  const stored = repo.store.get(MANUAL_UNS_NODES_SETTING_KEY);
  assert.equal(stored.length, 1);
});

test('ManualUnsNodeService.remove: scoped — does not delete a row from a different park', async () => {
  const repo = makeMockRepo([
    { id: '1', provider: PARK_A.provider, externalParkId: PARK_A.externalParkId },
    { id: '1', provider: PARK_A.provider, externalParkId: PARK_B.externalParkId },
  ]);
  const svc = new ManualUnsNodeService({ settingRepository: repo });
  const removed = await svc.remove({ ...PARK_A, id: '1' });
  assert.equal(removed, true);
  const stored = repo.store.get(MANUAL_UNS_NODES_SETTING_KEY);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].externalParkId, PARK_B.externalParkId);
});

test('ManualUnsNodeService: zero-arg constructor uses real AppSettingRepository', () => {
  const svc = new ManualUnsNodeService();
  assert.notEqual(svc.settingRepository, undefined);
  assert.equal(typeof svc.settingRepository.getValue, 'function');
  assert.equal(typeof svc.settingRepository.upsertValue, 'function');
});
