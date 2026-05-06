'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  theoreticalQueuePeople,
  ridePressureScore,
  statusFromScore,
  clamp,
  kernelWeight,
  distanceMeters,
  stressFactor,
  STATUS,
} = require('./geo-pressure-scoring');
const { _testing } = require('./geo-pressure-engine.service');

test('theoreticalQueuePeople: Silver Star style 60 min @ 1750 pph', () => {
  const q = theoreticalQueuePeople(60, 1750);
  assert.equal(q, 1750);
});

test('ridePressureScore clamps 0..100', () => {
  const a = ridePressureScore({
    waitMin: 300,
    capacityPerHour: 2000,
    targetWaitMin: 15,
    downtimeActive: false,
  });
  assert.equal(a, 100);
  const b = ridePressureScore({ waitMin: 0, capacityPerHour: 800, downtimeActive: false });
  assert.ok(b >= 0 && b <= 100);
});

test('downtime increases ride pressure vs same wait without downtime', () => {
  const base = ridePressureScore({ waitMin: 30, capacityPerHour: 1200, downtimeActive: false });
  const down = ridePressureScore({ waitMin: 30, capacityPerHour: 1200, downtimeActive: true });
  assert.ok(down > base);
});

test('overlapping radii: kernelWeight decays with distance', () => {
  const w0 = kernelWeight(0, 100);
  const w50 = kernelWeight(50, 100);
  const w200 = kernelWeight(200, 100);
  assert.ok(w0 > w50);
  assert.ok(w50 > w200);
  assert.equal(w200, 0);
});

test('map cell aggregation sums entity contributions', () => {
  const entities = [
    { lat: 48.27, lng: 7.72, pressureScore: 80, influenceRadiusM: 100, assetId: 'a', slug: 'a', name: 'A' },
    { lat: 48.2701, lng: 7.7201, pressureScore: 40, influenceRadiusM: 100, assetId: 'b', slug: 'b', name: 'B' },
  ];
  const bbox = _testing.buildGridBBox(entities, 0.0004);
  const cells = _testing.generateGridCells(bbox, 0.00025);
  const agg = _testing.aggregateCells(entities, cells);
  assert.ok(agg.length > 0);
  const peak = agg.reduce((m, c) => Math.max(m, c.pressureScore), 0);
  assert.ok(peak > 0);
  const withContributors = agg.filter((c) => c.topContributors?.length);
  assert.ok(withContributors.length > 0);
});

test('hotspot ordering by score', () => {
  const entities = [
    { pressureScore: 10, name: 'low' },
    { pressureScore: 90, name: 'high' },
  ];
  const sorted = [...entities].sort((a, b) => b.pressureScore - a.pressureScore);
  assert.equal(sorted[0].name, 'high');
});

test('status bands', () => {
  assert.equal(statusFromScore(10), STATUS.GREEN);
  assert.equal(statusFromScore(40), STATUS.YELLOW);
  assert.equal(statusFromScore(60), STATUS.RED);
  assert.equal(statusFromScore(85), STATUS.CRITICAL);
});

test('distanceMeters is symmetric', () => {
  const d = distanceMeters(48.27, 7.72, 48.28, 7.73);
  const d2 = distanceMeters(48.28, 7.73, 48.27, 7.72);
  assert.ok(Math.abs(d - d2) < 0.5);
  assert.ok(d > 800 && d < 2000);
});

test('stressFactor respects target wait', () => {
  const s = stressFactor(60, 30, 1000);
  assert.equal(s, 2);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});
