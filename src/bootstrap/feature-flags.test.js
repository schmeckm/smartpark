'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Flags,
  getFlags,
  clearFlagsCache,
  _internal: { buildStructured, validateStructured },
} = require('./feature-flags');

function fakeEnv(overrides = {}) {
  const base = {
    nodeEnv: 'test',
    port: 3000,
    logLevel: 'info',
    jwtSecret: 'super-secret-value',
    jwtAccessExpiresIn: '15m',
    jwtRefreshDays: 7,
    db: { host: '127.0.0.1', port: 5432, name: 'smartpark', user: 'smartpark', password: 'pw' },
    corsOrigin: '*',
    mqttEnabled: false,
    mqttBrokerUrl: 'mqtt://127.0.0.1:1883',
    mqttClientId: 'smart-park-os-api',
    mqttUsername: '',
    mqttPassword: '',
    mqttCapabilityGuardMode: 'off',
    mqttCapabilityGuardAllowedRideIds: '',
    mqttSparkplugLiveSubscribeAdvanced: false,
    mqttEnforceCapabilities: false,
    sparkplugGroupId: '',
    sparkplugEdgeNode: 'park_gateway',
    unsSpyEnabled: false,
    adapterDiscoverySpyEnabled: false,
    aiSamplingEnabled: false,
    aiSamplingIntervalSeconds: 300,
    weatherOpenMeteoEnabled: false,
    weatherOpenMeteoIntervalSeconds: 300,
    weatherOpenMeteoFetchRetries: 3,
    weatherOpenMeteoRetryBaseDelayMs: 500,
    weatherOpenMeteoForecastUrl: 'https://api.open-meteo.com/v1/forecast',
    weatherOpenMeteoRebuildSnapshots: true,
    externalParkDataEnabled: false,
    externalParkDataPollIntervalSeconds: 120,
    externalParkDataDefaultProvider: 'themeparks_wiki',
    adapterSchedulerEnabled: false,
    outputProfiles: '',
    adapterPipelineLogEnabled: true,
    adapterPipelineLogPath: 'data/adapter-pipeline.log',
    simOeeEnabled: false,
    simOeeAutoStart: false,
    simOeeParkSlug: 'europa_park',
    simOeeEdgeNode: '',
    simOeePublishMs: 3000,
    simOeeAttractions: 'blue_fire,silver_star',
    simOeeScenario: 'NORMAL_OPERATION',
    simOeeRandomSeed: 42,
    registryPublishEnabled: false,
    registryPublishMode: 'dry_run',
    registrySparkplugFormat: 'json',
    registryPublishAllowedRideIds: '',
    registrySignalPublishMaxAgeMs: 86_400_000,
    registrySignalStabilityDays: 0,
    ingestionMaxAgeMs: 1_200_000,
    mlTraceEnabled: false,
    mlProfileEnabled: false,
    mlFeatureWeightsEnabled: false,
  };
  return { ...base, ...overrides };
}

test('buildStructured: groups all current env keys into 14 sections', () => {
  const s = buildStructured(fakeEnv());
  for (const k of [
    'runtime',
    'auth',
    'db',
    'cors',
    'mqtt',
    'sparkplug',
    'uns',
    'ai',
    'mlForecast',
    'weather',
    'integrations',
    'sim',
    'registry',
    'ingestion',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(s, k), `missing section: ${k}`);
  }
  assert.equal(s.runtime.port, 3000);
  assert.equal(s.db.host, '127.0.0.1');
  assert.equal(s.mqtt.brokerUrl, 'mqtt://127.0.0.1:1883');
  assert.equal(s.sim.oee.parkSlug, 'europa_park');
  assert.equal(s.mlForecast.traceEnabled, false);
  assert.equal(s.mlForecast.profileEnabled, false);
  assert.equal(s.mlForecast.featureWeightsEnabled, false);
});

test('buildStructured: coerces optional booleans defensively', () => {
  const s = buildStructured(
    fakeEnv({
      mqttEnabled: 1,
      unsSpyEnabled: 'yes',
      registryPublishEnabled: undefined,
      simOeeAutoStart: 0,
    })
  );
  assert.equal(s.mqtt.enabled, true);
  assert.equal(s.uns.spyEnabled, true);
  assert.equal(s.registry.publishEnabled, false);
  assert.equal(s.sim.oee.autoStart, false);
});

test('validateStructured: lenient mode returns warnings, never throws', () => {
  const s = buildStructured(fakeEnv({ port: 'not-a-number' }));
  const { warnings } = validateStructured(s);
  assert.ok(warnings.length > 0, 'expected at least one warning');
  assert.match(warnings.join('\n'), /runtime\.port/);
});

test('validateStructured: strict mode throws on invalid values, naming the path', () => {
  const s = buildStructured(fakeEnv({ port: 'not-a-number', mqttCapabilityGuardMode: 'banana' }));
  assert.throws(() => validateStructured(s, { strict: true }), (err) => {
    assert.equal(err.code, 'FLAGS_VALIDATION_FAILED');
    assert.match(err.message, /runtime\.port/);
    assert.match(err.message, /mqtt\.capabilityGuardMode/);
    return true;
  });
});

test('validateStructured: applies Joi defaults for missing leaves', () => {
  const partial = {
    runtime: { nodeEnv: 'test', port: 3000, logLevel: 'info' },
    auth: { jwtSecret: 'x' },
    db: { host: 'h', name: 'n', user: 'u', password: 'p' },
    cors: {},
    mqtt: {},
    sparkplug: {},
    uns: {},
    ai: {},
    mlForecast: {},
    weather: {},
    integrations: {},
    sim: { oee: {} },
    registry: {},
    ingestion: {},
  };
  const { value, warnings } = validateStructured(partial);
  assert.deepEqual(warnings, []);
  assert.equal(value.cors.origin, '*');
  assert.equal(value.mqtt.brokerUrl, 'mqtt://127.0.0.1:1883');
  assert.equal(value.weather.openMeteoForecastUrl, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(value.sim.oee.publishMs, 3000);
  assert.equal(value.registry.signalPublishMaxAgeMs, 86_400_000);
});

test('Flags: instances are deeply frozen', () => {
  const f = getFlags({ envOverride: fakeEnv() });
  assert.ok(Object.isFrozen(f), 'top-level not frozen');
  assert.ok(Object.isFrozen(f.mqtt), 'mqtt not frozen');
  assert.ok(Object.isFrozen(f.sim.oee), 'sim.oee not frozen');
  assert.throws(() => {
    f.mqtt.enabled = true;
  });
  assert.throws(() => {
    f.sim.oee.publishMs = 1;
  });
});

test('Flags.toLogPayload(): masks secrets and matches the QW2 boot-log shape', () => {
  const f = getFlags({ envOverride: fakeEnv({ jwtSecret: 'jwt-x', mqttPassword: 'mqtt-x' }) });
  const p = f.toLogPayload();
  // Secrets must NEVER appear in the payload.
  const json = JSON.stringify(p);
  assert.equal(json.includes('jwt-x'), false);
  assert.equal(json.includes('mqtt-x'), false);
  // Payload sections come from `feature-flags.report.js` which reads the
  // module-level legacy env, so we just assert the shape contract.
  for (const k of [
    'runtime',
    'auth',
    'db',
    'cors',
    'mqtt',
    'sparkplug',
    'uns',
    'ai',
    'mlForecast',
    'weather',
    'integrations',
    'sim',
    'registry',
    'ingestion',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(p, k), `missing section in log payload: ${k}`);
  }
});

test('Flags.warnings(): exposes lenient validation findings as a frozen array', () => {
  const f = getFlags({ envOverride: fakeEnv({ port: 'banana' }) });
  const w = f.warnings();
  assert.ok(Array.isArray(w));
  assert.ok(w.length >= 1);
  assert.match(w.join('\n'), /runtime\.port/);
  assert.ok(Object.isFrozen(w));
});

test('getFlags: caches across calls when no envOverride is supplied', (t) => {
  t.after(() => clearFlagsCache());
  clearFlagsCache();
  const a = getFlags();
  const b = getFlags();
  assert.strictEqual(a, b, 'expected cached identity');
});

test('getFlags: envOverride bypasses the cache and yields fresh instances', (t) => {
  t.after(() => clearFlagsCache());
  clearFlagsCache();
  const a = getFlags({ envOverride: fakeEnv({ port: 3000 }) });
  const b = getFlags({ envOverride: fakeEnv({ port: 4000 }) });
  assert.notStrictEqual(a, b);
  assert.equal(a.runtime.port, 3000);
  assert.equal(b.runtime.port, 4000);
});

test('clearFlagsCache: forces re-build after env override changes', (t) => {
  t.after(() => clearFlagsCache());
  const a = getFlags();
  clearFlagsCache();
  const b = getFlags();
  assert.notStrictEqual(a, b, 'expected fresh instance after cache clear');
});

test('Flags: mlForecast flags map from env overrides', () => {
  const f = getFlags({
    envOverride: fakeEnv({
      mlTraceEnabled: true,
      mlProfileEnabled: false,
      mlFeatureWeightsEnabled: 1,
    }),
  });
  assert.equal(f.mlForecast.traceEnabled, true);
  assert.equal(f.mlForecast.profileEnabled, false);
  assert.equal(f.mlForecast.featureWeightsEnabled, true);
});

test('Flags: ride-id allow-list CSVs are preserved in the typed shape (parsing happens elsewhere)', () => {
  const f = getFlags({
    envOverride: fakeEnv({
      mqttCapabilityGuardAllowedRideIds: 'a,b,c',
      registryPublishAllowedRideIds: 'x,y',
    }),
  });
  assert.equal(f.mqtt.capabilityGuardAllowedRideIds, 'a,b,c');
  assert.equal(f.registry.allowedRideIds, 'x,y');
});

test('Flags: real-env getFlags() does not throw and returns a fully populated shape', (t) => {
  t.after(() => clearFlagsCache());
  clearFlagsCache();
  // No envOverride: pulls from src/config/env.js (real process env).
  const f = getFlags();
  assert.equal(typeof f.runtime.port, 'number');
  assert.ok(f.auth.jwtSecret.length > 0);
  assert.equal(typeof f.mqtt.enabled, 'boolean');
  assert.equal(typeof f.sim.oee.publishMs, 'number');
});
