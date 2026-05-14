'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeatureFlagReport, maskSecret } = require('./feature-flags.report');

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
    mqttEnforceCapabilities: false,
    mqttSparkplugLiveSubscribeAdvanced: false,
    mqttCapabilityGuardAllowedRideIds: '',
    sparkplugGroupId: '',
    sparkplugEdgeNode: 'park_gateway',
    unsSpyEnabled: false,
    adapterDiscoverySpyEnabled: false,
    aiSamplingEnabled: true,
    aiSamplingIntervalSeconds: 300,
    weatherOpenMeteoEnabled: false,
    weatherOpenMeteoIntervalSeconds: 300,
    weatherOpenMeteoFetchRetries: 3,
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
    simOeePublishMs: 3000,
    simOeeAttractions: 'blue_fire,silver_star',
    simOeeScenario: 'NORMAL_OPERATION',
    registryPublishEnabled: false,
    registryPublishMode: 'dry_run',
    registrySparkplugFormat: 'json',
    registryPublishAllowedRideIds: '',
    registrySignalPublishMaxAgeMs: 86400000,
    registrySignalStabilityDays: 0,
    ingestionMaxAgeMs: 1200000,
    mlTraceEnabled: false,
    mlProfileEnabled: false,
    mlFeatureWeightsEnabled: false,
  };
  return { ...base, ...overrides };
}

test('maskSecret: returns "unset" for null/undefined/empty', () => {
  assert.equal(maskSecret(null), 'unset');
  assert.equal(maskSecret(undefined), 'unset');
  assert.equal(maskSecret(''), 'unset');
});

test('maskSecret: never returns the original value, includes length', () => {
  const out = maskSecret('hunter2');
  assert.match(out, /^\*\*\* \(set, length=7\)$/);
  assert.equal(out.includes('hunter2'), false);
});

test('buildFeatureFlagReport: masks every secret-class field', () => {
  const r = buildFeatureFlagReport(fakeEnv({
    jwtSecret: 'jwt-secret',
    mqttPassword: 'mqtt-pw',
    db: { host: 'h', port: 5432, name: 'n', user: 'u', password: 'db-pw' },
  }));
  assert.equal(r.auth.jwtSecret.startsWith('*** (set'), true);
  assert.equal(r.auth.jwtSecret.includes('jwt-secret'), false);
  assert.equal(r.mqtt.password.startsWith('*** (set'), true);
  assert.equal(r.mqtt.password.includes('mqtt-pw'), false);
  assert.equal(r.db.password.startsWith('*** (set'), true);
  assert.equal(r.db.password.includes('db-pw'), false);
});

test('buildFeatureFlagReport: secrets show as "unset" when blank', () => {
  const r = buildFeatureFlagReport(fakeEnv({ mqttPassword: '' }));
  assert.equal(r.mqtt.password, 'unset');
});

test('buildFeatureFlagReport: parses CSV outputProfiles + sim attractions into arrays', () => {
  const r = buildFeatureFlagReport(fakeEnv({
    outputProfiles: 'sparkplug_json, canonical_historian',
    simOeeAttractions: 'blue_fire, silver_star, voltron',
  }));
  assert.deepEqual(r.integrations.outputProfiles, ['sparkplug_json', 'canonical_historian']);
  assert.deepEqual(r.sim.oeeAttractions, ['blue_fire', 'silver_star', 'voltron']);
});

test('buildFeatureFlagReport: counts CSV-encoded ride id allow-lists without leaking ids', () => {
  const r = buildFeatureFlagReport(fakeEnv({
    mqttCapabilityGuardAllowedRideIds: 'a,b,c',
    registryPublishAllowedRideIds: 'x,y',
  }));
  assert.equal(r.mqtt.capabilityGuardAllowedRideIdsCount, 3);
  assert.equal(r.registry.allowedRideIdsCount, 2);
  assert.equal(JSON.stringify(r).includes('a,b,c'), false);
  assert.equal(JSON.stringify(r).includes('x,y'), false);
});

test('buildFeatureFlagReport: contains all high-signal flag groups including mlForecast', () => {
  const r = buildFeatureFlagReport(fakeEnv());
  for (const k of [
    'runtime', 'auth', 'db', 'cors',
    'mqtt', 'sparkplug', 'uns', 'ai',
    'mlForecast',
    'weather', 'integrations', 'sim', 'registry', 'ingestion',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, k), `missing key: ${k}`);
  }
});

test('buildFeatureFlagReport: coerces optional booleans defensively', () => {
  const r = buildFeatureFlagReport(fakeEnv({
    mqttEnabled: undefined,
    unsSpyEnabled: 1,
    registryPublishEnabled: 'yes',
  }));
  assert.equal(r.mqtt.enabled, false);
  assert.equal(r.uns.spyEnabled, true);
  assert.equal(r.registry.publishEnabled, true);
});

test('buildFeatureFlagReport: mlForecast booleans surface for boot log', () => {
  const r = buildFeatureFlagReport(
    fakeEnv({ mlTraceEnabled: true, mlProfileEnabled: false, mlFeatureWeightsEnabled: true })
  );
  assert.equal(r.mlForecast.traceEnabled, true);
  assert.equal(r.mlForecast.profileEnabled, false);
  assert.equal(r.mlForecast.featureWeightsEnabled, true);
});

test('buildFeatureFlagReport: empty outputProfiles becomes empty array, not falsy', () => {
  const r = buildFeatureFlagReport(fakeEnv());
  assert.deepEqual(r.integrations.outputProfiles, []);
});
