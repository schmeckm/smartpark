'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEFAULT_BOOT_STEP_ORDER } = require('./load-config');
const { Lifecycle } = require('./lifecycle');

function fakeApp() {
  return { use() {}, listen() {} };
}
function silentLogger() {
  return { info() {}, warn() {}, error() {}, fatal() {} };
}

test('loadConfig: rejects missing app or logger', () => {
  assert.throws(() => loadConfig({}), /app, logger/);
  assert.throws(() => loadConfig({ app: fakeApp() }), /app, logger/);
  assert.throws(() => loadConfig({ logger: silentLogger() }), /app, logger/);
});

test('loadConfig: returns a Lifecycle whose steps match DEFAULT_BOOT_STEP_ORDER exactly', () => {
  const { lifecycle, stepOrder } = loadConfig({ app: fakeApp(), logger: silentLogger() });
  assert.ok(lifecycle instanceof Lifecycle);
  assert.deepEqual(lifecycle.steps(), [...DEFAULT_BOOT_STEP_ORDER]);
  assert.deepEqual([...stepOrder], [...DEFAULT_BOOT_STEP_ORDER]);
});

test('loadConfig: registers expected boot step count', () => {
  const { lifecycle } = loadConfig({ app: fakeApp(), logger: silentLogger() });
  assert.equal(lifecycle.steps().length, 16);
});

test('DEFAULT_BOOT_STEP_ORDER: is frozen so reorderings need an explicit code change', () => {
  assert.ok(Object.isFrozen(DEFAULT_BOOT_STEP_ORDER));
  assert.throws(() => {
    DEFAULT_BOOT_STEP_ORDER.push('rogue:step');
  });
});

test('DEFAULT_BOOT_STEP_ORDER: critical pre/post-listen ordering invariants hold', () => {
  // These invariants encode the architecture: dependencies first, schedulers
  // before listen, listen before MQTT, MQTT before OEE auto-start. A future
  // refactor that breaks any of these MUST update this test deliberately.
  const order = DEFAULT_BOOT_STEP_ORDER;
  const idx = (n) => order.indexOf(n);

  assert.ok(idx('boot:feature-flags') < idx('db:sequelize'));
  assert.ok(idx('db:sequelize') < idx('cache:platform-settings'));
  assert.ok(idx('cache:platform-settings') < idx('cache:influx-streaming-gate'));
  assert.ok(idx('cache:influx-streaming-gate') < idx('http:server-init'));
  assert.ok(idx('http:server-init') < idx('scheduler:ai-orchestrator'));
  // All schedulers must run before listen so socket.io is bound before any
  // scheduler tries to emit to it (defensive; today no scheduler does).
  for (const s of [
    'scheduler:ai-orchestrator',
    'scheduler:integration-orchestrator',
    'scheduler:adapter-installed',
    'scheduler:weather-open-meteo',
    'scheduler:ml-training',
    'scheduler:integration-flow',
    'scheduler:integration-flow-retry',
  ]) {
    assert.ok(idx(s) < idx('http:listen'), `${s} must run before http:listen`);
  }
  assert.ok(idx('http:listen') < idx('influx:ot-metrics-flush'));
  assert.ok(idx('influx:ot-metrics-flush') < idx('mqtt:connector'));
  assert.ok(idx('mqtt:connector') < idx('sim:oee-auto-start'));
});

test('loadConfig: getHttpServer() returns null until http:server-init runs', () => {
  const { getHttpServer } = loadConfig({ app: fakeApp(), logger: silentLogger() });
  // We do not call lifecycle.start() here — http:server-init has not run.
  assert.equal(getHttpServer(), null);
});
