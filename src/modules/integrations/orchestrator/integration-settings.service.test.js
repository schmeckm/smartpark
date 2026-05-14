'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IntegrationSettingsService,
  INTEGRATION_SETTING_KEYS,
} = require('./integration-settings.service');

/**
 * Phase C3.3 unit tests. The service is exercised against an in-memory
 * `AppSettingRepository` mock plus stub callbacks for the cross-cutting
 * collaborators (`unsParkKeyResolver`, `platformSettingsFactory`,
 * `entityDomainRegistryLoader`, `registryService`).
 */

function makeMockRepo(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async findByKey(key) {
      return store.has(key) ? { key, value: store.get(key) } : null;
    },
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

function makeMockPlatformSettings(values = {}) {
  return {
    async getString(_envKey, fallback) {
      return values.string ?? fallback;
    },
    async getBoolean(_envKey, fallback) {
      return values.boolean ?? fallback;
    },
    async getNumber(_envKey, fallback) {
      return values.number ?? fallback;
    },
  };
}

/* ---------- INTEGRATION_SETTING_KEYS contract (data migration risk) ----------- */

test('INTEGRATION_SETTING_KEYS: pins the 10 known app_settings keys', () => {
  assert.equal(
    INTEGRATION_SETTING_KEYS.selectedProvider,
    'externalParkData.selectedProvider',
    'persistence key drift requires an explicit data migration, not a refactor'
  );
  assert.equal(INTEGRATION_SETTING_KEYS.selectedDestination, 'externalParkData.selectedDestination');
  assert.equal(INTEGRATION_SETTING_KEYS.selectedPark, 'externalParkData.selectedPark');
  assert.equal(INTEGRATION_SETTING_KEYS.dataSourceMode, 'externalParkData.dataSourceMode');
  assert.equal(INTEGRATION_SETTING_KEYS.autoApplyEnabled, 'externalParkData.autoApplyEnabled');
  assert.equal(INTEGRATION_SETTING_KEYS.pollingEnabled, 'externalParkData.pollingEnabled');
  assert.equal(INTEGRATION_SETTING_KEYS.pollingIntervalSeconds, 'externalParkData.pollingIntervalSeconds');
  assert.equal(INTEGRATION_SETTING_KEYS.aiForecastFactors, 'ai.forecast.factorConfigs');
  assert.equal(INTEGRATION_SETTING_KEYS.unsManualNodes, 'uns.manualNodes');
  assert.equal(INTEGRATION_SETTING_KEYS.unsSparkplugSchemaOverride, 'uns.sparkplugTopicSchema');
});

test('INTEGRATION_SETTING_KEYS: frozen', () => {
  assert.throws(() => {
    INTEGRATION_SETTING_KEYS.selectedProvider = 'oops';
  });
});

/* --------------------------- seedDefaults() --------------------------- */

test('seedDefaults: writes default rows when store is empty', async () => {
  const repo = makeMockRepo();
  let domainLoaderCalls = 0;
  let registrySeedCalls = 0;
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    registryService: {
      ensureSeedConfigs: async () => {
        registrySeedCalls += 1;
      },
    },
    platformSettingsFactory: () => makeMockPlatformSettings({ string: 'wartezeiten_app', boolean: false, number: 600 }),
    entityDomainRegistryLoader: async () => {
      domainLoaderCalls += 1;
    },
  });

  await svc.seedDefaults();

  assert.equal(registrySeedCalls, 1, 'must seed registry once');
  assert.equal(domainLoaderCalls, 1, 'must warm entity-domain registry once');

  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.selectedProvider), { provider: 'wartezeiten_app' });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.autoApplyEnabled), { enabled: true });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.pollingEnabled), { enabled: false });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.pollingIntervalSeconds), { seconds: 600 });
  assert.ok(Array.isArray(repo.store.get(INTEGRATION_SETTING_KEYS.aiForecastFactors)));
  assert.ok(repo.store.get(INTEGRATION_SETTING_KEYS.aiForecastFactors).length > 0);
});

test('seedDefaults: does NOT overwrite pre-existing polling flags', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.pollingEnabled]: { enabled: true, customField: 'keep me' },
    [INTEGRATION_SETTING_KEYS.pollingIntervalSeconds]: { seconds: 30 },
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    platformSettingsFactory: () => makeMockPlatformSettings({ boolean: false, number: 9999 }),
    entityDomainRegistryLoader: async () => {},
  });
  await svc.seedDefaults();
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.pollingEnabled), {
    enabled: true,
    customField: 'keep me',
  });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.pollingIntervalSeconds), { seconds: 30 });
});

test('seedDefaults: does NOT overwrite pre-existing aiForecastFactors when non-empty', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.aiForecastFactors]: [{ key: 'custom' }],
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    platformSettingsFactory: () => makeMockPlatformSettings(),
    entityDomainRegistryLoader: async () => {},
  });
  await svc.seedDefaults();
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.aiForecastFactors), [{ key: 'custom' }]);
});

test('seedDefaults: replaces empty aiForecastFactors array with defaults', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.aiForecastFactors]: [],
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    platformSettingsFactory: () => makeMockPlatformSettings(),
    entityDomainRegistryLoader: async () => {},
  });
  await svc.seedDefaults();
  const v = repo.store.get(INTEGRATION_SETTING_KEYS.aiForecastFactors);
  assert.ok(Array.isArray(v));
  assert.ok(v.length > 0, 'defaults must replace an empty list');
});

/* ------------------------------- get() -------------------------------- */

test('get: returns full settings document with sane fallbacks for empty store', async () => {
  const svc = new IntegrationSettingsService({
    settingRepository: makeMockRepo(),
    platformSettingsFactory: () => makeMockPlatformSettings(),
    entityDomainRegistryLoader: async () => {},
    unsParkKeyResolver: async () => 'europa_park',
  });
  const out = await svc.get();
  assert.equal(out.unsParkKey, 'europa_park');
  assert.deepEqual(out.selectedProvider, { provider: 'themeparks_wiki' });
  assert.equal(out.selectedDestination, null);
  assert.equal(out.selectedPark, null);
  assert.deepEqual(out.autoApplyEnabled, { enabled: true });
  assert.deepEqual(out.pollingEnabled, { enabled: false });
  assert.deepEqual(out.pollingIntervalSeconds, { seconds: 120 });
  assert.equal(out.unsTopicSchemaOverrideSummary.active, false);
  assert.equal(out.unsTopicSchemaOverrideSummary.entryCount, 0);
});

test('get: reports schema override active when present + matches selected park', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.selectedPark]: { provider: 'themeparks_wiki', externalParkId: 'p1' },
    [INTEGRATION_SETTING_KEYS.unsSparkplugSchemaOverride]: {
      provider: 'themeparks_wiki',
      externalParkId: 'p1',
      entries: [{ assetSlug: 'a' }, { assetSlug: 'b' }],
      updatedAt: '2026-05-08T00:00:00Z',
    },
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'park-1',
  });
  const out = await svc.get();
  assert.equal(out.unsTopicSchemaOverrideSummary.active, true);
  assert.equal(out.unsTopicSchemaOverrideSummary.entryCount, 2);
  assert.equal(out.unsTopicSchemaOverrideSummary.updatedAt, '2026-05-08T00:00:00Z');
});

test('get: schema override is INACTIVE when its provider/park does not match selected park', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.selectedPark]: { provider: 'themeparks_wiki', externalParkId: 'p1' },
    [INTEGRATION_SETTING_KEYS.unsSparkplugSchemaOverride]: {
      provider: 'wartezeiten_app',
      externalParkId: 'other',
      entries: [{}],
    },
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'whatever',
  });
  const out = await svc.get();
  assert.equal(out.unsTopicSchemaOverrideSummary.active, false);
});

/* ------------------------------- patch() ------------------------------ */

test('patch: writes only the keys present in input', async () => {
  const repo = makeMockRepo();
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'k',
  });
  await svc.patch({ selectedProvider: { provider: 'wartezeiten_app' }, autoApplyEnabled: { enabled: false } });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.selectedProvider), { provider: 'wartezeiten_app' });
  assert.deepEqual(repo.store.get(INTEGRATION_SETTING_KEYS.autoApplyEnabled), { enabled: false });
  assert.equal(repo.store.has(INTEGRATION_SETTING_KEYS.selectedDestination), false);
});

test('patch: null selectedDestination deletes the row instead of writing null', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.selectedDestination]: { provider: 'p', externalDestinationId: 'd' },
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'k',
  });
  await svc.patch({ selectedDestination: null });
  assert.equal(repo.store.has(INTEGRATION_SETTING_KEYS.selectedDestination), false);
});

test('patch: null selectedPark deletes the row instead of writing null', async () => {
  const repo = makeMockRepo({
    [INTEGRATION_SETTING_KEYS.selectedPark]: { provider: 'p', externalParkId: 'pid' },
  });
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'k',
  });
  await svc.patch({ selectedPark: null });
  assert.equal(repo.store.has(INTEGRATION_SETTING_KEYS.selectedPark), false);
});

test('patch: returns the freshly recomputed settings document', async () => {
  const repo = makeMockRepo();
  const svc = new IntegrationSettingsService({
    settingRepository: repo,
    unsParkKeyResolver: async () => 'k',
  });
  const out = await svc.patch({ selectedProvider: { provider: 'wartezeiten_app' } });
  assert.deepEqual(out.selectedProvider, { provider: 'wartezeiten_app' });
  assert.equal(out.unsParkKey, 'k');
});

test('IntegrationSettingsService: zero-arg constructor uses real collaborators', () => {
  const svc = new IntegrationSettingsService();
  assert.notEqual(svc.settingRepository, undefined);
  assert.equal(typeof svc.unsParkKeyResolver, 'function');
  assert.equal(typeof svc.platformSettingsFactory, 'function');
  assert.equal(typeof svc.entityDomainRegistryLoader, 'function');
});
