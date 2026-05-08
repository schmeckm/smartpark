'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CanonicalIngestionPipelineService,
} = require('./canonical-ingestion-pipeline.service');
const {
  CanonicalIngestionHookRegistry,
} = require('./canonical-ingestion-hooks');

/**
 * Phase C3.7 unit tests for the canonical ingestion pipeline.
 *
 * Tests use injected fakes for all collaborators so they never reach
 * the DB / network. The most important test pins the post-ingest hook
 * dispatch — that's the change that removed the two hard-coded
 * `provider === 'themeparks_wiki'` branches from the orchestrator.
 */

function makeMockRepo(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async getValue(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
  };
}

function makeMockAdapter(overrides = {}) {
  return {
    getProviderInfo: () => ({ provider: 'themeparks_wiki', name: 'TP', baseUrl: '', capabilities: {} }),
    fetchDestinations: async () => ({ destinations: [{ id: 'd1', name: 'Resort' }] }),
    fetchParks: async () => ({ parks: [{ id: 'p1', name: 'Park' }] }),
    fetchEntities: async () => ({ children: [] }),
    fetchLiveData: async () => ({ liveData: [] }),
    fetchCalendar: async () => ({ data: [] }),
    normalizeToCanonicalMessages: ({ type, items }) => {
      if (type === 'destinations') {
        return [
          {
            messageType: 'DESTINATION_SYNCED',
            payload: { externalDestinationId: 'd1', name: 'Resort' },
          },
        ];
      }
      if (type === 'parks') {
        return [{ messageType: 'PARK_SYNCED', payload: { externalParkId: 'p1', name: 'Park' } }];
      }
      if (type === 'entities') {
        return [{ messageType: 'ENTITY_SYNCED', payload: {} }];
      }
      if (type === 'live') {
        return [{ messageType: 'WAIT_TIME_UPDATED', payload: {} }];
      }
      if (type === 'calendar') {
        return [{ messageType: 'CALENDAR_SYNCED', payload: {} }];
      }
      return [];
    },
    ...overrides,
  };
}

function makePipeline(overrides = {}) {
  const repo = overrides.settingRepository || makeMockRepo();
  const adapter = overrides.adapter || makeMockAdapter();
  const ingested = [];
  const canonicalService = overrides.canonicalService || {
    list: async () => [],
    ingest: async (msgs) => {
      ingested.push(msgs);
      return msgs;
    },
  };
  const providerBrowser = overrides.providerBrowser || {
    resolveProvider: async () => adapter,
    getProviderEntity: async () => ({ name: 'Park', destinationId: 'd1' }),
    listAvailableParks: async () => [{ id: 'p1', name: 'Park' }],
  };
  const sparkplugCalls = [];
  const sparkplugPublisherFactory =
    overrides.sparkplugPublisherFactory ||
    (() => ({
      publishFromEntitySyncMessages: async (args) => sparkplugCalls.push({ kind: 'entities', ...args }),
      publishFromLiveCanonicalMessages: async (args) => sparkplugCalls.push({ kind: 'live', ...args }),
    }));
  const hookRegistry = overrides.hookRegistry || new CanonicalIngestionHookRegistry();
  const socketEvents = {
    emitExternalParkDataUpdated: overrides.emit || (() => {}),
  };
  const pipeline = new CanonicalIngestionPipelineService({
    settingRepository: repo,
    canonicalService,
    providerBrowser,
    socketEvents,
    onAfterEntitiesSynced: overrides.onAfterEntitiesSynced || (() => {}),
    hookRegistry,
    sparkplugPublisherFactory,
  });
  return { pipeline, repo, adapter, canonicalService, providerBrowser, ingested, sparkplugCalls, hookRegistry };
}

/* ----------------------- selectedParkOrThrow ----------------------- */

test('selectedParkOrThrow: throws 422 when no selected park is set', async () => {
  const { pipeline } = makePipeline();
  await assert.rejects(pipeline.selectedParkOrThrow(), (err) => {
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'VALIDATION_ERROR');
    return true;
  });
});

test('selectedParkOrThrow: returns the saved park', async () => {
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
  });
  const park = await pipeline.selectedParkOrThrow();
  assert.equal(park.externalParkId, 'p1');
});

/* --------------------------- syncDestinations ------------------------ */

test('syncDestinations: ingests messages and reports count', async () => {
  const { pipeline, ingested } = makePipeline();
  const out = await pipeline.syncDestinations('themeparks_wiki');
  assert.equal(out.count, 1);
  assert.equal(out.provider, 'themeparks_wiki');
  assert.equal(ingested.length, 1);
});

/* ----------------------------- syncParks ----------------------------- */

test('syncParks: throws 422 when no destinationId given and no setting saved', async () => {
  const { pipeline } = makePipeline();
  await assert.rejects(pipeline.syncParks('themeparks_wiki'), (err) => {
    assert.equal(err.statusCode, 422);
    assert.equal(err.code, 'VALIDATION_ERROR');
    return true;
  });
});

test('syncParks: uses saved destination when none is passed', async () => {
  const { pipeline, ingested } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedDestination': {
        provider: 'themeparks_wiki',
        externalDestinationId: 'd1',
      },
    }),
  });
  const out = await pipeline.syncParks('themeparks_wiki');
  assert.equal(out.count, 1);
  assert.equal(ingested.length, 1);
});

/* --------------------------- syncEntities --------------------------- */

test('syncEntities: dispatches to the registered after-entities hook for the provider', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  const seen = [];
  hookRegistry.registerAfterEntities('themeparks_wiki', async (ctx) => {
    seen.push(ctx);
    return { masterDataDone: true };
  });
  const { pipeline, sparkplugCalls } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
  });
  const out = await pipeline.syncEntities('themeparks_wiki', 'p1');
  assert.deepEqual(out.platformMasterData, { masterDataDone: true });
  assert.equal(seen.length, 1, 'hook must be invoked exactly once');
  assert.equal(seen[0].externalParkId, 'p1');
  assert.equal(sparkplugCalls.length, 1, 'entity sync must publish to Sparkplug');
});

test('syncEntities: no hook registered for the provider → platformMasterData is null', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'wartezeiten_app', externalParkId: 'p1' },
    }),
    hookRegistry,
  });
  const out = await pipeline.syncEntities('wartezeiten_app', 'p1');
  assert.equal(out.platformMasterData, null);
});

test('syncEntities: hook failure surfaces as { error } and does NOT block the response', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  hookRegistry.registerAfterEntities('themeparks_wiki', async () => {
    throw new Error('db down');
  });
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
  });
  const out = await pipeline.syncEntities('themeparks_wiki', 'p1');
  assert.equal(out.count, 1, 'integration ingestion must succeed even if the hook fails');
  assert.deepEqual(out.platformMasterData, { error: 'db down' });
});

test('syncEntities: invokes onAfterEntitiesSynced when the synced park is the selected park', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  let materialized = false;
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
    onAfterEntitiesSynced: () => {
      materialized = true;
    },
  });
  await pipeline.syncEntities('themeparks_wiki', 'p1');
  assert.equal(materialized, true);
});

test('syncEntities: skips onAfterEntitiesSynced when synced park ≠ selected park', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  let materialized = false;
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'OTHER' },
    }),
    hookRegistry,
    onAfterEntitiesSynced: () => {
      materialized = true;
    },
  });
  await pipeline.syncEntities('themeparks_wiki', 'p1');
  assert.equal(materialized, false);
});

/* ----------------------------- syncLive ----------------------------- */

test('syncLive: dispatches to the registered after-live hook', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  let called = false;
  hookRegistry.registerAfterLive('themeparks_wiki', async () => {
    called = true;
    return { liveSyncDone: true };
  });
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
  });
  const out = await pipeline.syncLive('themeparks_wiki', 'p1');
  assert.equal(called, true);
  assert.deepEqual(out.platformLive, { liveSyncDone: true });
});

test('syncLive: no hook registered → platformLive is null', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'wartezeiten_app', externalParkId: 'p1' },
    }),
    hookRegistry,
  });
  const out = await pipeline.syncLive('wartezeiten_app', 'p1');
  assert.equal(out.platformLive, null);
});

test('syncLive: emits external park data updated event', async () => {
  const events = [];
  const hookRegistry = new CanonicalIngestionHookRegistry();
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
    emit: (e) => events.push(e),
  });
  await pipeline.syncLive('themeparks_wiki', 'p1');
  assert.equal(events.length, 1);
  assert.equal(events[0].provider, 'themeparks_wiki');
  assert.equal(events[0].park, 'p1');
});

/* --------------------------- syncCalendar --------------------------- */

test('syncCalendar: ingests calendar messages and crowd messages when adapter supports it', async () => {
  let calendarCalls = 0;
  let crowdCalls = 0;
  const adapter = makeMockAdapter({
    fetchCrowdLevel: async () => ({ items: [{}] }),
    normalizeToCanonicalMessages: ({ type }) => {
      if (type === 'calendar') return [{ messageType: 'CALENDAR_SYNCED', payload: {} }];
      if (type === 'crowd') return [{ messageType: 'CROWD_LEVEL_OBSERVED', payload: {} }];
      return [];
    },
  });
  const canonicalService = {
    list: async () => [],
    ingest: async (msgs) => {
      const t = msgs[0]?.messageType;
      if (t === 'CALENDAR_SYNCED') calendarCalls += 1;
      if (t === 'CROWD_LEVEL_OBSERVED') crowdCalls += 1;
      return msgs;
    },
  };
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    adapter,
    canonicalService,
    providerBrowser: {
      resolveProvider: async () => adapter,
      getProviderEntity: async () => ({ name: 'P', destinationId: 'd1' }),
      listAvailableParks: async () => [],
    },
  });
  const out = await pipeline.syncCalendar('themeparks_wiki', 'p1');
  assert.equal(out.count, 1);
  assert.equal(calendarCalls, 1);
  assert.equal(crowdCalls, 1);
});

test('syncCalendar: tolerates fetchCrowdLevel failure', async () => {
  const adapter = makeMockAdapter({
    fetchCrowdLevel: async () => {
      throw new Error('upstream 500');
    },
  });
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    adapter,
    providerBrowser: {
      resolveProvider: async () => adapter,
      getProviderEntity: async () => ({ name: 'P' }),
      listAvailableParks: async () => [],
    },
  });
  const out = await pipeline.syncCalendar('themeparks_wiki', 'p1');
  assert.equal(out.count, 1, 'calendar messages must still be ingested if crowd fails');
});

/* ------------------- syncAllParksInDestination ------------------- */

test('syncAllParksInDestination: throws 422 when no parks found', async () => {
  const { pipeline } = makePipeline({
    providerBrowser: {
      resolveProvider: async () => makeMockAdapter(),
      getProviderEntity: async () => ({}),
      listAvailableParks: async () => [],
    },
  });
  await assert.rejects(pipeline.syncAllParksInDestination('themeparks_wiki', 'd1'), (err) => {
    assert.equal(err.statusCode, 422);
    return true;
  });
});

test('syncAllParksInDestination: aggregates per-park sync results', async () => {
  const hookRegistry = new CanonicalIngestionHookRegistry();
  const { pipeline } = makePipeline({
    settingRepository: makeMockRepo({
      'externalParkData.selectedPark': { provider: 'themeparks_wiki', externalParkId: 'p1' },
    }),
    hookRegistry,
    providerBrowser: {
      resolveProvider: async () => makeMockAdapter(),
      getProviderEntity: async () => ({ name: 'Park', destinationId: 'd1' }),
      listAvailableParks: async () => [
        { id: 'p1', name: 'Park 1' },
        { id: 'p2', name: 'Park 2' },
      ],
    },
  });
  const summary = await pipeline.syncAllParksInDestination('themeparks_wiki', 'd1');
  assert.equal(summary.parksTotal, 2);
  assert.equal(summary.parksProcessed, 2);
  assert.ok(summary.entitiesMessages > 0);
});
