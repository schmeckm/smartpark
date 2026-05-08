'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SparkplugTopicSchemaService,
  unsSchemaMatchesPark,
  applyUploadedUnsSchemaEntries,
  UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY,
} = require('./sparkplug-topic-schema.service');

function makeMockRepo(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getValue(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async upsertValue(key, value) {
      store.set(key, value);
    },
    async deleteByKey(key) {
      const had = store.has(key);
      store.delete(key);
      return had;
    },
  };
}

const SELECTED = { provider: 'themeparks_wiki', externalParkId: 'p1', parkName: 'EP' };

function defaultDeps(overrides = {}) {
  return {
    settingRepository: makeMockRepo(),
    selectedParkResolver: async () => SELECTED,
    parkSlugResolver: async () => 'europa_park',
    dynamicTopicRowsResolver: async () => [],
    // simple stub that just adds a sparkplug.* field so we can verify it ran
    enrichRowsWithSparkplug: (rows, ctx) =>
      rows.map((r) => ({ ...r, sparkplug: { groupId: ctx.groupId, edgeNodeId: ctx.edgeNodeId } })),
    ...overrides,
  };
}

/* ------------------------- pure helpers ------------------------- */

test('unsSchemaMatchesPark: true when provider+externalParkId match', () => {
  const doc = { provider: 'themeparks_wiki', externalParkId: 'p1' };
  assert.equal(unsSchemaMatchesPark(doc, SELECTED), true);
});

test('unsSchemaMatchesPark: false when provider differs', () => {
  const doc = { provider: 'wartezeiten_app', externalParkId: 'p1' };
  assert.equal(unsSchemaMatchesPark(doc, SELECTED), false);
});

test('unsSchemaMatchesPark: false when externalParkId differs', () => {
  const doc = { provider: 'themeparks_wiki', externalParkId: 'pX' };
  assert.equal(unsSchemaMatchesPark(doc, SELECTED), false);
});

test('unsSchemaMatchesPark: false for null/undefined doc', () => {
  assert.equal(unsSchemaMatchesPark(null, SELECTED), false);
  assert.equal(unsSchemaMatchesPark(undefined, SELECTED), false);
});

test('applyUploadedUnsSchemaEntries: slugifies asset/metric and provides domain fallback', () => {
  const out = applyUploadedUnsSchemaEntries(
    [
      { assetSlug: 'Big Thunder', metric: 'Queue Time', entityType: 'attraction' },
      { assetSlug: 'Pirates', metric: 'Status', domain: 'Operations Domain' },
    ],
    SELECTED,
    'europa_park'
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].assetSlug, 'big_thunder');
  assert.equal(out[0].metric, 'queue_time');
  assert.equal(out[0].entityType, 'ATTRACTION');
  assert.equal(out[0].source, 'SCHEMA_UPLOAD');
  assert.equal(typeof out[0].topicPath, 'string');
  assert.notEqual(out[0].topicPath, '');
  assert.equal(out[1].domain, 'operations_domain');
});

test('applyUploadedUnsSchemaEntries: preserves explicit topicPath when given', () => {
  const out = applyUploadedUnsSchemaEntries(
    [{ assetSlug: 'a', metric: 'm', topicPath: 'tpuns/v1/ep/foo/bar' }],
    SELECTED,
    'ep'
  );
  assert.equal(out[0].topicPath, 'tpuns/v1/ep/foo/bar');
});

/* --------------------------- service.get() --------------------------- */

test('get: source=active returns the override when it matches selected park', async () => {
  const repo = makeMockRepo({
    [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
      provider: SELECTED.provider,
      externalParkId: SELECTED.externalParkId,
      parkSlug: 'europa_park',
      updatedAt: '2026-05-08T00:00:00Z',
      entries: [{ assetSlug: 'a', metric: 'm' }],
    },
  });
  const svc = new SparkplugTopicSchemaService(defaultDeps({ settingRepository: repo }));
  const out = await svc.get({ source: 'active' });
  assert.equal(out.kind, 'smartpark.uns.sparkplug_topics');
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.provider, SELECTED.provider);
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].sparkplug.edgeNodeId, 'park_gateway');
});

test('get: source=active falls back to dynamic when override is for a different park', async () => {
  const repo = makeMockRepo({
    [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
      provider: SELECTED.provider,
      externalParkId: 'OTHER_PARK',
      entries: [{ assetSlug: 'a', metric: 'm' }],
    },
  });
  let dynamicCalled = false;
  const svc = new SparkplugTopicSchemaService(
    defaultDeps({
      settingRepository: repo,
      dynamicTopicRowsResolver: async () => {
        dynamicCalled = true;
        return [{ assetSlug: 'd', metric: 'qt' }];
      },
    })
  );
  const out = await svc.get({ source: 'active' });
  assert.equal(dynamicCalled, true);
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].assetSlug, 'd');
  assert.equal(out.updatedAt, null);
});

test('get: source=baseline (default) always uses dynamic builder', async () => {
  const repo = makeMockRepo({
    [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
      provider: SELECTED.provider,
      externalParkId: SELECTED.externalParkId,
      entries: [{ assetSlug: 'a', metric: 'm' }],
    },
  });
  let dynamicCalled = false;
  const svc = new SparkplugTopicSchemaService(
    defaultDeps({
      settingRepository: repo,
      dynamicTopicRowsResolver: async () => {
        dynamicCalled = true;
        return [{ assetSlug: 'd', metric: 'qt' }];
      },
    })
  );
  const out = await svc.get({ source: 'baseline' });
  assert.equal(dynamicCalled, true);
  assert.equal(out.entries[0].assetSlug, 'd');
});

/* --------------------------- service.put() --------------------------- */

test('put: persists a normalized document and returns the count', async () => {
  const repo = makeMockRepo();
  const svc = new SparkplugTopicSchemaService(defaultDeps({ settingRepository: repo }));
  const out = await svc.put({
    entries: [
      { assetSlug: 'a', metric: 'queue_time', entityType: 'attraction' },
      { assetSlug: 'b', metric: 'status' },
    ],
  });
  assert.equal(out.entryCount, 2);
  const stored = repo.store.get(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY);
  assert.equal(stored.kind, 'smartpark.uns.sparkplug_topics');
  assert.equal(stored.provider, SELECTED.provider);
  assert.equal(stored.externalParkId, SELECTED.externalParkId);
  assert.equal(stored.entries.length, 2);
  assert.match(stored.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('put: rejects mismatched externalParkId with 422', async () => {
  const svc = new SparkplugTopicSchemaService(defaultDeps());
  await assert.rejects(
    svc.put({ externalParkId: 'OTHER', entries: [{ assetSlug: 'a', metric: 'm' }] }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('put: rejects mismatched provider with 422', async () => {
  const svc = new SparkplugTopicSchemaService(defaultDeps());
  await assert.rejects(
    svc.put({ provider: 'wartezeiten_app', entries: [{ assetSlug: 'a', metric: 'm' }] }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

/* -------------------------- service.delete() -------------------------- */

test('delete: removes the override row from the setting store', async () => {
  const repo = makeMockRepo({
    [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: { provider: 'p', externalParkId: 'x', entries: [] },
  });
  const svc = new SparkplugTopicSchemaService(defaultDeps({ settingRepository: repo }));
  await svc.delete();
  assert.equal(repo.store.has(UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY), false);
});

test('SparkplugTopicSchemaService: zero-arg constructor uses real defaults', () => {
  const svc = new SparkplugTopicSchemaService();
  assert.notEqual(svc.settingRepository, undefined);
  assert.equal(typeof svc.enrichRowsWithSparkplug, 'function');
});
