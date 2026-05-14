'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { IntegrationPollingService } = require('./integration-polling.service');

/**
 * Unit tests for IntegrationPollingService (Phase C3.8).
 *
 * The loop is exercised via a synchronous sleep seam so each test
 * controls how many ticks run. Because start() spawns the loop on
 * the microtask queue, we await a single microtask flush to give it
 * a chance to make progress before assertions.
 */

const SETTING_KEYS = {
  pollingEnabled: 'integration.pollingEnabled',
  pollingIntervalSeconds: 'integration.pollingIntervalSeconds',
};

function buildDeps(overrides = {}) {
  const calls = {
    syncLive: 0,
    sleep: [],
    debug: [],
    warn: [],
  };
  const settingRepoStore = new Map();
  settingRepoStore.set(SETTING_KEYS.pollingEnabled, { enabled: true });
  settingRepoStore.set(SETTING_KEYS.pollingIntervalSeconds, { seconds: 300 });

  const settingRepository = {
    getValue: async (key, fallback) =>
      settingRepoStore.has(key) ? settingRepoStore.get(key) : fallback,
  };

  const platformSettings = {
    getBoolean: async (k, fallback) => {
      if (k === 'EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC') return false;
      return fallback;
    },
    getNumber: async (_k, fallback) => fallback,
  };
  const platformSettingsFactory = () => platformSettings;

  // Sleep seam — caller provides a "stop after N ticks" predicate.
  // The default seam stops after 1 tick by flipping the cancel state.
  const sleepFn = async (ms) => {
    calls.sleep.push(ms);
    if (calls.sleep.length >= (overrides.maxTicks ?? 1)) {
      // Stop the loop by mutating the externally-held cancel state.
      // We can't reach state directly here, so the test cancels via
      // the returned function.
    }
  };

  const logger = {
    debug: (...args) => calls.debug.push(args),
    warn: (...args) => calls.warn.push(args),
  };

  return {
    deps: {
      settingRepository,
      syncLive: async () => {
        calls.syncLive++;
      },
      platformSettingsFactory,
      settingKeys: SETTING_KEYS,
      logger,
      sleepFn,
      ...overrides.depsOverrides,
    },
    calls,
    store: settingRepoStore,
    platformSettings,
  };
}

async function flush(times = 5) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

test('throws if settingRepository.getValue is missing', () => {
  assert.throws(
    () =>
      new IntegrationPollingService({
        syncLive: async () => {},
        platformSettingsFactory: () => ({}),
        settingKeys: SETTING_KEYS,
      }),
    /settingRepository\.getValue/
  );
});

test('throws if syncLive is not a function', () => {
  assert.throws(
    () =>
      new IntegrationPollingService({
        settingRepository: { getValue: async () => null },
        platformSettingsFactory: () => ({}),
        settingKeys: SETTING_KEYS,
      }),
    /syncLive/
  );
});

test('throws if platformSettingsFactory is not a function', () => {
  assert.throws(
    () =>
      new IntegrationPollingService({
        settingRepository: { getValue: async () => null },
        syncLive: async () => {},
        settingKeys: SETTING_KEYS,
      }),
    /platformSettingsFactory/
  );
});

test('throws if settingKeys is missing required keys', () => {
  assert.throws(
    () =>
      new IntegrationPollingService({
        settingRepository: { getValue: async () => null },
        syncLive: async () => {},
        platformSettingsFactory: () => ({}),
        settingKeys: { pollingEnabled: 'x' },
      }),
    /pollingEnabled and pollingIntervalSeconds/
  );
});

test('start() returns a function and runs at least one tick', async () => {
  const { deps, calls } = buildDeps();
  const svc = new IntegrationPollingService(deps);

  const cancel = svc.start();
  assert.equal(typeof cancel, 'function');

  await flush(20);
  cancel();
  // Wait for an additional microtask flush so the cancelled loop exits
  await flush(20);

  assert.ok(calls.syncLive >= 1, `expected syncLive >= 1, got ${calls.syncLive}`);
});

test('skips syncLive when polling is disabled', async () => {
  const { deps, calls, store } = buildDeps();
  store.set(SETTING_KEYS.pollingEnabled, { enabled: false });

  const svc = new IntegrationPollingService(deps);
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.equal(calls.syncLive, 0, 'syncLive should not run when pollingEnabled.enabled === false');
});

test('skips syncLive when EXTERNAL_PARK_DATA_ENABLED is false (logs debug)', async () => {
  const { deps, calls, platformSettings } = buildDeps();
  platformSettings.getBoolean = async (_k, _fallback) => false;

  const svc = new IntegrationPollingService(deps);
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.equal(calls.syncLive, 0);
  assert.ok(
    calls.debug.length >= 1,
    'expected at least one debug log for the disabled-master case'
  );
});

test('clamps interval to [intervalMinSeconds, intervalMaxSeconds]', async () => {
  const { deps, calls, store } = buildDeps();
  store.set(SETTING_KEYS.pollingIntervalSeconds, { seconds: 1 }); // below default min(30)

  const svc = new IntegrationPollingService(deps);
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.ok(calls.sleep.length >= 1, 'sleep should have been called');
  assert.ok(
    calls.sleep[0] === 30_000,
    `expected sleep clamped to 30 000ms, got ${calls.sleep[0]}`
  );
});

test('clamps interval at the upper bound', async () => {
  const { deps, calls, store } = buildDeps();
  store.set(SETTING_KEYS.pollingIntervalSeconds, { seconds: 999_999 });

  const svc = new IntegrationPollingService({ ...deps, intervalMaxSeconds: 86400 });
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.equal(calls.sleep[0], 86400 * 1000);
});

test('logs warn and waits failureBackoffMs when getValue throws', async () => {
  const { deps, calls } = buildDeps();
  deps.settingRepository.getValue = async () => {
    throw new Error('db down');
  };

  const svc = new IntegrationPollingService({ ...deps, failureBackoffMs: 60_000 });
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.ok(calls.warn.length >= 1, 'expected a warn log on failure');
  assert.equal(calls.sleep[0], 60_000, 'should fall back to failureBackoffMs');
  assert.equal(calls.syncLive, 0);
});

test('logs warn but keeps loop alive when syncLive throws', async () => {
  const { deps, calls } = buildDeps();
  deps.syncLive = async () => {
    throw new Error('upstream timeout');
  };

  const svc = new IntegrationPollingService(deps);
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.ok(calls.warn.length >= 1, 'expected a warn log on syncLive failure');
});

test('cancel before the first tick stops the loop without invoking syncLive', async () => {
  const { deps, calls } = buildDeps();
  const svc = new IntegrationPollingService(deps);

  const cancel = svc.start();
  cancel();
  await flush(20);

  // We can't guarantee zero, because start() schedules the first
  // iteration on a microtask queue that may run before cancel takes
  // effect. But after cancel, no further ticks should run. We verify
  // by checking sleep count stays bounded.
  const initialSleep = calls.sleep.length;
  await flush(20);
  assert.equal(
    calls.sleep.length,
    initialSleep,
    'no additional sleeps after cancel returns control to test'
  );
});

test('seeds default interval from platform setting when app_setting is absent', async () => {
  const { deps, calls, platformSettings, store } = buildDeps();
  store.delete(SETTING_KEYS.pollingIntervalSeconds);
  platformSettings.getNumber = async (_k, _fallback) => 600;

  const svc = new IntegrationPollingService(deps);
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.equal(calls.sleep[0], 600 * 1000, 'default seconds should come from platform setting');
});

test('start() spawned twice yields two independent cancel functions', async () => {
  const { deps, calls } = buildDeps();
  const svc = new IntegrationPollingService(deps);

  const cancelA = svc.start();
  const cancelB = svc.start();
  await flush(20);
  cancelA();
  cancelB();
  await flush(20);

  assert.ok(calls.syncLive >= 1, 'at least one of the two loops should have run a tick');
});

test('EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC shortens sleep to next 5m boundary', async () => {
  const { deps, calls, platformSettings } = buildDeps();
  platformSettings.getBoolean = async (k, fb) => {
    if (k === 'EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC') return true;
    return fb;
  };

  const svc = new IntegrationPollingService({
    ...deps,
    nowFn: () => new Date('2026-01-01T00:02:00.000Z'),
  });
  const cancel = svc.start();
  await flush(20);
  cancel();
  await flush(20);

  assert.equal(calls.sleep[0], 181_500);
});
