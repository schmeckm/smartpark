'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderBrowserService,
  normalizeDestinationAndParkRows,
  listFromProviderPayload,
  isParkEntity,
  isDestinationEntity,
  normalizedEntityType,
  asArray,
} = require('./provider-browser.service');

/**
 * Phase C3.2 unit tests. The service is a pass-through to the provider
 * registry; tests use lightweight fakes so we never reach the DB or
 * network.
 */

function makeMockSettings(initial = {}) {
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
    getProviderInfo: () => ({ provider: 'themeparks_wiki', name: 'ThemeParks.wiki', baseUrl: '', capabilities: {} }),
    fetchDestinations: async () => ({ destinations: [] }),
    fetchParks: async () => ({ parks: [] }),
    fetchEntity: async () => ({ id: 'e', entityType: 'ATTRACTION' }),
    fetchEntities: async () => ({ children: [] }),
    fetchEntityLive: async () => null,
    fetchEntitySchedule: async () => null,
    ...overrides,
  };
}

function makeMockRegistry(overrides = {}) {
  return {
    listProviderInfos: () => [{ provider: 'themeparks_wiki', name: 'TP', baseUrl: '', capabilities: {} }],
    getConfig: async (p) => ({ provider: p, enabled: true }),
    patchConfig: async (p, patch) => ({ provider: p, ...patch }),
    getAdapter: () => makeMockAdapter(),
    ...overrides,
  };
}

/* ----------------------------- pure helpers ----------------------------- */

test('normalizedEntityType: uppercases and trims', () => {
  assert.equal(normalizedEntityType({ entityType: ' Park ' }), 'PARK');
  assert.equal(normalizedEntityType({ type: 'destination' }), 'DESTINATION');
  assert.equal(normalizedEntityType({}), '');
  assert.equal(normalizedEntityType(null), '');
});

test('isParkEntity / isDestinationEntity: classify by entityType', () => {
  assert.equal(isParkEntity({ entityType: 'PARK' }), true);
  assert.equal(isParkEntity({ entityType: 'DESTINATION' }), false);
  assert.equal(isDestinationEntity({ type: 'destination' }), true);
});

test('asArray: drills into common container keys', () => {
  assert.deepEqual(asArray([1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(asArray({ data: ['a'] }), ['a']);
  assert.deepEqual(asArray({ items: ['b'] }), ['b']);
  assert.deepEqual(asArray({ destinations: ['c'] }), ['c']);
  assert.deepEqual(asArray({ children: ['d'] }), ['d']);
  assert.deepEqual(asArray({ parks: ['e'] }), ['e']);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray('string'), []);
});

test('listFromProviderPayload: drills into a list of preferred keys', () => {
  assert.deepEqual(listFromProviderPayload([1, 2]), [1, 2]);
  assert.deepEqual(listFromProviderPayload({ destinations: ['x'] }, ['destinations']), ['x']);
  assert.deepEqual(listFromProviderPayload({ items: ['y'] }, ['data', 'items']), ['y']);
  assert.deepEqual(listFromProviderPayload({}, ['data']), []);
  assert.deepEqual(listFromProviderPayload(null, ['data']), []);
});

test('normalizeDestinationAndParkRows: extracts a flat destination + park map', () => {
  const raw = {
    destinations: [
      {
        id: 'd1',
        name: 'Europa-Park Resort',
        entityType: 'DESTINATION',
        parks: [
          { id: 'p1', name: 'Europa-Park', entityType: 'PARK', timezone: 'Europe/Berlin' },
          { id: 'p2', name: 'Rulantica', entityType: 'PARK' },
        ],
      },
    ],
  };
  const out = normalizeDestinationAndParkRows(raw);
  assert.equal(out.destinations.length, 1);
  assert.equal(out.parks.length, 2);
  assert.equal(out.parks[0].destinationId, 'd1');
  assert.equal(out.parks[0].destinationName, 'Europa-Park Resort');
  // Destinations get back-populated with park id/name pairs.
  assert.equal(out.destinations[0].parks.length, 2);
});

test('normalizeDestinationAndParkRows: tolerates a non-tree payload', () => {
  const out = normalizeDestinationAndParkRows({});
  assert.deepEqual(out, { destinations: [], parks: [] });
});

/* ------------------------------- service -------------------------------- */

test('ProviderBrowserService.listProviders: forwards to registry', () => {
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry(),
    settingRepository: makeMockSettings(),
  });
  const out = svc.listProviders();
  assert.equal(out.length, 1);
  assert.equal(out[0].provider, 'themeparks_wiki');
});

test('ProviderBrowserService.getProviderConfig / patchProviderConfig: pass-through', async () => {
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry(),
    settingRepository: makeMockSettings(),
  });
  const cfg = await svc.getProviderConfig('themeparks_wiki');
  assert.equal(cfg.provider, 'themeparks_wiki');
  const patched = await svc.patchProviderConfig('themeparks_wiki', { enabled: false });
  assert.equal(patched.enabled, false);
});

test('ProviderBrowserService.resolveProvider: uses given provider when present', async () => {
  let askedFor = null;
  const registry = makeMockRegistry({
    getAdapter: (p) => {
      askedFor = p;
      return makeMockAdapter();
    },
  });
  const svc = new ProviderBrowserService({ registryService: registry, settingRepository: makeMockSettings() });
  await svc.resolveProvider('wartezeiten_app');
  assert.equal(askedFor, 'wartezeiten_app');
});

test('ProviderBrowserService.resolveProvider: falls back to selected-provider setting', async () => {
  let askedFor = null;
  const registry = makeMockRegistry({
    getAdapter: (p) => {
      askedFor = p;
      return makeMockAdapter();
    },
  });
  const svc = new ProviderBrowserService({
    registryService: registry,
    settingRepository: makeMockSettings({
      'externalParkData.selectedProvider': { provider: 'wartezeiten_app' },
    }),
  });
  await svc.resolveProvider();
  assert.equal(askedFor, 'wartezeiten_app');
});

test('ProviderBrowserService.resolveProvider: falls back to themeparks_wiki when no setting', async () => {
  let askedFor = null;
  const registry = makeMockRegistry({
    getAdapter: (p) => {
      askedFor = p;
      return makeMockAdapter();
    },
  });
  const svc = new ProviderBrowserService({ registryService: registry, settingRepository: makeMockSettings() });
  await svc.resolveProvider();
  assert.equal(askedFor, 'themeparks_wiki');
});

test('ProviderBrowserService.listAvailableDestinations: returns normalized destinations', async () => {
  const adapter = makeMockAdapter({
    fetchDestinations: async () => ({
      destinations: [
        {
          id: 'd1',
          name: 'EP Resort',
          entityType: 'DESTINATION',
          parks: [{ id: 'p1', name: 'EP', entityType: 'PARK' }],
        },
      ],
    }),
  });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  const out = await svc.listAvailableDestinations('themeparks_wiki');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'd1');
  assert.equal(out[0].name, 'EP Resort');
});

test('ProviderBrowserService.listAvailableParks: filters by destinationId', async () => {
  const adapter = makeMockAdapter({
    fetchDestinations: async () => ({
      destinations: [
        {
          id: 'd1',
          name: 'Resort',
          entityType: 'DESTINATION',
          parks: [
            { id: 'p1', name: 'A', entityType: 'PARK' },
            { id: 'p2', name: 'B', entityType: 'PARK' },
          ],
        },
        {
          id: 'd2',
          name: 'Other Resort',
          entityType: 'DESTINATION',
          parks: [{ id: 'p3', name: 'C', entityType: 'PARK' }],
        },
      ],
    }),
  });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  const out = await svc.listAvailableParks('themeparks_wiki', 'd1');
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((p) => p.id).sort(),
    ['p1', 'p2']
  );
});

test('ProviderBrowserService.getProviderEntity: returns null for non-object payload', async () => {
  const adapter = makeMockAdapter({ fetchEntity: async () => null });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  const out = await svc.getProviderEntity('themeparks_wiki', 'unknown');
  assert.equal(out, null);
});

test('ProviderBrowserService.getProviderEntity: shapes the row consistently', async () => {
  const adapter = makeMockAdapter({
    fetchEntity: async () => ({
      id: 'e1',
      name: 'Wodan',
      type: 'ATTRACTION',
      timezone: 'Europe/Berlin',
    }),
  });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  const out = await svc.getProviderEntity('themeparks_wiki', 'e1');
  assert.equal(out.id, 'e1');
  assert.equal(out.name, 'Wodan');
  assert.equal(out.entityType, 'ATTRACTION');
  assert.equal(out.timezone, 'Europe/Berlin');
});

test('ProviderBrowserService.listProviderEntityChildren: throws 501 when adapter lacks fetchEntities', async () => {
  const adapter = makeMockAdapter({ fetchEntities: undefined });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  await assert.rejects(svc.listProviderEntityChildren('themeparks_wiki', 'x'), (err) => {
    assert.equal(err.statusCode, 501);
    assert.equal(err.code, 'NOT_SUPPORTED');
    return true;
  });
});

test('ProviderBrowserService.listProviderEntityChildren: drills into containers', async () => {
  const adapter = makeMockAdapter({
    fetchEntities: async () => ({ children: ['a', 'b'] }),
  });
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => adapter }),
    settingRepository: makeMockSettings(),
  });
  assert.deepEqual(await svc.listProviderEntityChildren('themeparks_wiki', 'x'), ['a', 'b']);
});

test('ProviderBrowserService.getProviderEntityLive: returns null when adapter returns falsy', async () => {
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({ getAdapter: () => makeMockAdapter({ fetchEntityLive: async () => null }) }),
    settingRepository: makeMockSettings(),
  });
  assert.equal(await svc.getProviderEntityLive('themeparks_wiki', 'e'), null);
});

test('ProviderBrowserService.getProviderEntitySchedule: forwards options', async () => {
  let received;
  const svc = new ProviderBrowserService({
    registryService: makeMockRegistry({
      getAdapter: () =>
        makeMockAdapter({
          fetchEntitySchedule: async (id, opts) => {
            received = { id, opts };
            return { id, ...opts };
          },
        }),
    }),
    settingRepository: makeMockSettings(),
  });
  const out = await svc.getProviderEntitySchedule('themeparks_wiki', 'e', { year: 2026, month: 5 });
  assert.equal(out.year, 2026);
  assert.equal(out.month, 5);
  assert.deepEqual(received.opts, { year: 2026, month: 5 });
});

test('ProviderBrowserService: zero-arg constructor uses real collaborators', () => {
  const svc = new ProviderBrowserService();
  assert.notEqual(svc.registryService, undefined);
  assert.notEqual(svc.settingRepository, undefined);
});
