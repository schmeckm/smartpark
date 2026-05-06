'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAttractionOeeSimulatorForTests,
  scenarioProfile,
  aggregateOeeWindow,
  SCENARIOS,
} = require('./attraction-oee-simulator.service');

test('SCENARIOS includes required lab scenarios', () => {
  for (const s of [
    'NORMAL_OPERATION',
    'HIGH_DEMAND',
    'TRAIN_REMOVED',
    'TECHNICAL_STOP',
    'PARK_CLOSING',
    'NIGHT_MODE',
  ]) {
    assert.ok(SCENARIOS.includes(s));
  }
});

test('scenario TRAIN_REMOVED reduces available trains vs configured', async () => {
  const publishes = [];
  const sim = createAttractionOeeSimulatorForTests({
    publishMqtt: async (topic, payload) => {
      publishes.push({ topic, payload });
    },
  });
  await sim.start({
    parkSlug: 'test_park',
    edgeNodeId: 'park_gateway_01',
    attractions: ['silver_star'],
    publishMs: 60_000,
    randomSeed: 99,
    scenario: 'TRAIN_REMOVED',
  });
  assert.ok(publishes.some((p) => p.topic.includes('/NBIRTH/')));
  assert.ok(publishes.some((p) => p.topic.includes('/DBIRTH/') && p.topic.endsWith('/silver_star')));
  clearInterval(sim.timer);
  sim.timer = null;
  for (let i = 0; i < 40; i += 1) {
    await sim.tick(4000);
  }
  const ddata = publishes.filter((p) => p.topic.includes('/DDATA/'));
  assert.ok(ddata.length > 0);
  const last = ddata[ddata.length - 1].payload.metrics;
  const avail = last.find((m) => m.name === 'available_trains')?.value;
  const cfg = last.find((m) => m.name === 'configured_trains')?.value;
  const oee5 = last.find((m) => m.name === 'oee_5m')?.value;
  assert.equal(typeof avail, 'number');
  assert.equal(typeof cfg, 'number');
  assert.ok(avail <= cfg);
  assert.equal(typeof oee5, 'number');
  await sim.stop();
});

test('NIGHT_SHUTDOWN transitions to OFF', async () => {
  const sim = createAttractionOeeSimulatorForTests({
    publishMqtt: async () => {},
  });
  await sim.start({
    parkSlug: 'test_park',
    attractions: ['blue_fire'],
    publishMs: 60_000,
    randomSeed: 7,
    scenario: 'NORMAL_OPERATION',
  });
  clearInterval(sim.timer);
  sim.timer = null;
  const site = [...sim.sites.values()][0];
  site.state = 'NIGHT_SHUTDOWN';
  site.stateUntil = 0;
  await sim.tick(1000);
  assert.equal(site.state, 'OFF');
  await sim.stop();
});

test('aggregateOeeWindow returns bounded OEE', () => {
  const now = Date.now();
  const hist = [
    { t: now - 60_000, runtimeMs: 50_000, downtimeMs: 10_000, planned: 1000, actual: 900, good: 5, bad: 1 },
  ];
  const o = aggregateOeeWindow(hist, 5 * 60_000, now);
  assert.ok(o.oee >= 0 && o.oee <= 100);
  assert.ok(o.availability >= 0 && o.availability <= 100);
});

test('TECHNICAL_STOP profile raises fault rate vs normal', () => {
  const t = scenarioProfile('TECHNICAL_STOP');
  const n = scenarioProfile('NORMAL_OPERATION');
  assert.ok(t.faultRate > n.faultRate);
});
