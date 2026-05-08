'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { UnsTopicSuggestionService } = require('./uns-topic-suggestion.service');
const {
  UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY,
} = require('./sparkplug-topic-schema.service');

/**
 * Phase C3.6 unit tests. The service is exercised against in-memory
 * fakes for every collaborator so we never touch the DB / network.
 */

function makeRepo(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getValue(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
  };
}

function noopEnrich(rows, ctx) {
  return rows.map((r) => ({ ...r, sparkplug: { groupId: ctx.groupId, edgeNodeId: ctx.edgeNodeId } }));
}

function makeService(overrides = {}) {
  return new UnsTopicSuggestionService({
    selectedParkResolver: async () => ({
      provider: 'themeparks_wiki',
      externalParkId: 'park-1',
      parkName: 'Europa-Park',
    }),
    providerEntityResolver: async () => ({ name: 'Europa-Park' }),
    manualNodeService: { list: async () => [] },
    mappingService: { listMappings: async () => [] },
    canonicalService: { list: async () => [] },
    settingRepository: makeRepo(),
    masterDataRowGenerator: async () => [],
    enrichRowsWithSparkplug: noopEnrich,
    ...overrides,
  });
}

const SELECTED = { provider: 'themeparks_wiki', externalParkId: 'park-1' };

/* ---------- buildDynamicUnsTopicNodesFromIntegrations ---------- */

test('buildDynamicUnsTopicNodesFromIntegrations: creates a row per mapping with status+queue_time fallback', async () => {
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'Big Thunder', externalEntityType: 'attraction' },
      ],
    },
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  assert.equal(out.length, 2, 'mappings without canonical messages get the 2-metric fallback');
  const metrics = new Set(out.map((r) => r.metric));
  assert.ok(metrics.has('status'));
  assert.ok(metrics.has('queue_time'));
});

test('buildDynamicUnsTopicNodesFromIntegrations: canonical messages add metrics for known mappings', async () => {
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'Big Thunder', externalEntityType: 'attraction' },
      ],
    },
    canonicalService: {
      list: async () => [
        { externalEntityId: 'A', messageType: 'WAIT_TIME_UPDATED', payload: {} },
      ],
    },
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  assert.equal(out.length, 1, 'when the canonical metric is known, the fallback list is replaced by the actual metric');
  assert.equal(out[0].metric, 'queue_time');
});

test('buildDynamicUnsTopicNodesFromIntegrations: synthesizes nodes for canonical messages without mappings', async () => {
  const svc = makeService({
    canonicalService: {
      list: async () => [
        {
          externalEntityId: 'B',
          messageType: 'ENTITY_STATUS_UPDATED',
          payload: { externalEntityName: 'Wodan', entityType: 'ATTRACTION' },
        },
      ],
    },
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  assert.equal(out.length, 1);
  assert.equal(out[0].metric, 'status');
  assert.equal(out[0].source, 'CANONICAL');
});

test('buildDynamicUnsTopicNodesFromIntegrations: deduplicates by topicPath; master data wins last write', async () => {
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'X', externalEntityType: 'attraction' },
      ],
    },
    masterDataRowGenerator: async () => [
      // craft a topic that overwrites the integration-side row by sharing its topicPath
      {
        topicPath: 'tpuns/v1/europa_park/attraction/x/queue_time',
        provider: SELECTED.provider,
        externalParkId: SELECTED.externalParkId,
        domain: 'attraction',
        assetSlug: 'x',
        metric: 'queue_time',
        source: 'MASTER_DATA',
      },
    ],
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  const overridden = out.find(
    (r) => r.topicPath === 'tpuns/v1/europa_park/attraction/x/queue_time'
  );
  assert.equal(overridden.source, 'MASTER_DATA', 'master-data row must replace mapping-derived row at the same path');
});

test('buildDynamicUnsTopicNodesFromIntegrations: master-data generator failure is non-fatal', async () => {
  const svc = makeService({
    masterDataRowGenerator: async () => {
      throw new Error('db down');
    },
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'X', externalEntityType: 'attraction' },
      ],
    },
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  assert.equal(out.length, 2, 'integration-side rows survive a master-data failure');
});

test('buildDynamicUnsTopicNodesFromIntegrations: ignores canonical messages of unknown type', async () => {
  const svc = makeService({
    canonicalService: {
      list: async () => [
        { externalEntityId: 'X', messageType: 'SOMETHING_ELSE', payload: {} },
      ],
    },
  });
  const out = await svc.buildDynamicUnsTopicNodesFromIntegrations(SELECTED, 'europa_park');
  assert.deepEqual(out, []);
});

/* ----------------------- getFlatRows ----------------------- */

test('getFlatRows: returns dynamic + manual rows together, with parkSlug', async () => {
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'Big', externalEntityType: 'attraction' },
      ],
    },
    manualNodeService: {
      list: async () => [
        { id: '1', provider: SELECTED.provider, externalParkId: SELECTED.externalParkId,
          assetSlug: 'a', metric: 'queue_time', domain: 'attraction', assetName: 'A' },
      ],
    },
  });
  const out = await svc.getFlatRows();
  assert.equal(out.parkSlug, 'europa_park');
  assert.equal(out.rows.length, 3, '2 fallback metrics for the mapping + 1 manual row');
  const sources = new Set(out.rows.map((r) => r.source));
  assert.ok(sources.has('MAPPING'));
  assert.ok(sources.has('MANUAL'));
});

test('getFlatRows: stored override REPLACES dynamic rows when it matches selected park', async () => {
  const svc = makeService({
    settingRepository: makeRepo({
      [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
        provider: SELECTED.provider,
        externalParkId: SELECTED.externalParkId,
        entries: [
          { assetSlug: 'override_asset', metric: 'qt', entityType: 'attraction' },
        ],
      },
    }),
    mappingService: {
      // Would normally produce a row, but should be overridden
      listMappings: async () => [
        { externalEntityId: 'IGNORE_ME', externalEntityName: 'X', externalEntityType: 'attraction' },
      ],
    },
  });
  const out = await svc.getFlatRows();
  const slugs = out.rows.map((r) => r.assetSlug);
  assert.ok(slugs.includes('override_asset'), 'override entry must be present');
  assert.equal(slugs.includes('x'), false, 'mapping-derived row must be dropped when override is active');
});

test('getFlatRows: stored override is IGNORED when its park does not match', async () => {
  const svc = makeService({
    settingRepository: makeRepo({
      [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
        provider: SELECTED.provider,
        externalParkId: 'OTHER',
        entries: [{ assetSlug: 'override_asset', metric: 'qt' }],
      },
    }),
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'Big', externalEntityType: 'attraction' },
      ],
    },
  });
  const out = await svc.getFlatRows();
  const slugs = out.rows.map((r) => r.assetSlug);
  assert.equal(slugs.includes('override_asset'), false);
  assert.ok(slugs.includes('big'), 'falls back to the dynamic-from-mappings rows');
});

/* ----------------------- materializeFromSuggestions ----------------------- */

test('materializeFromSuggestions: forwards lean rows to UnsService.materializeLeavesFromIntegration', async () => {
  let received;
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'Big', externalEntityType: 'attraction' },
      ],
    },
    unsServiceFactory: () => ({
      materializeLeavesFromIntegration: async (parkSlug, rows) => {
        received = { parkSlug, rows };
        return { count: rows.length };
      },
    }),
  });
  const out = await svc.materializeFromSuggestions();
  assert.equal(received.parkSlug, 'europa_park');
  assert.equal(received.rows.length, 2);
  // lean shape: must NOT carry provider / externalParkId / externalEntityId
  assert.equal(received.rows[0].provider, undefined);
  assert.equal(received.rows[0].externalEntityId, undefined);
  assert.equal(out.count, 2);
});

/* ------------------------- getSuggestions ------------------------- */

test('getSuggestions: groups rows by domain and reports counts', async () => {
  const svc = makeService({
    mappingService: {
      listMappings: async () => [
        { externalEntityId: 'A', externalEntityName: 'X', externalEntityType: 'attraction' },
        { externalEntityId: 'B', externalEntityName: 'Y', externalEntityType: 'show' },
      ],
    },
  });
  const out = await svc.getSuggestions();
  assert.equal(out.provider, SELECTED.provider);
  assert.equal(out.externalParkId, SELECTED.externalParkId);
  assert.equal(out.parkSlug, 'europa_park');
  assert.equal(out.schemaOverrideActive, false);
  assert.ok(Array.isArray(out.tree));
  // 2 mappings × 2 fallback metrics = 4 dynamic rows
  assert.equal(out.totalTopics, 4);
  assert.equal(out.dynamicTopics, 4);
  assert.equal(out.manualTopics, 0);
});

test('getSuggestions: schemaOverrideActive=true when override matches', async () => {
  const svc = makeService({
    settingRepository: makeRepo({
      [UNS_SPARKPLUG_SCHEMA_OVERRIDE_KEY]: {
        provider: SELECTED.provider,
        externalParkId: SELECTED.externalParkId,
        sparkplug: { groupId: 'CUSTOM_GROUP', edgeNodeId: 'CUSTOM_EDGE' },
        entries: [{ assetSlug: 'a', metric: 'qt' }],
      },
    }),
  });
  const out = await svc.getSuggestions();
  assert.equal(out.schemaOverrideActive, true);
  assert.equal(out.sparkplug.groupId, 'CUSTOM_GROUP');
  assert.equal(out.sparkplug.edgeNodeId, 'CUSTOM_EDGE');
});

test('UnsTopicSuggestionService: zero-arg constructor uses real repository default', () => {
  const svc = new UnsTopicSuggestionService();
  assert.notEqual(svc.settingRepository, undefined);
  assert.equal(typeof svc.enrichRowsWithSparkplug, 'function');
});
