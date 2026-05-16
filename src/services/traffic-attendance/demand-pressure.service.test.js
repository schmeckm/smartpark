'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DemandPressureService } = require('./demand-pressure.service');

test('DemandPressureService: weighted traffic from latest snapshots', async () => {
  const c1 = { id: 'c1', weight: 1 };
  const c2 = { id: 'c2', weight: 3 };
  const snaps = {
    c1: { delayPercent: 55, congestionScore: 55 },
    c2: { delayPercent: 55, congestionScore: 55 },
  };
  const svc = new DemandPressureService({
    TrafficCorridor: {
      findAll: async () => [c1, c2],
    },
    TrafficCorridorSnapshot5m: {
      findOne: async ({ where }) => {
        const o = snaps[where.corridorId];
        if (!o) return null;
        return { get: (opts) => (opts?.plain ? { ...o } : o) };
      },
    },
  });
  const out = await svc.computeTrafficPressureForPark('park-1');
  assert.equal(out.traffic_pressure_score, 50);
  assert.equal(out.corridorSnapshotCount, 2);
});

test('DemandPressureService: no snapshots yields zero traffic pressure', async () => {
  const svc = new DemandPressureService({
    TrafficCorridor: {
      findAll: async () => [{ id: 'x', weight: 1, get: (o) => (o?.plain ? { id: 'x', weight: 1 } : {}) }],
    },
    TrafficCorridorSnapshot5m: {
      findOne: async () => null,
    },
  });
  const out = await svc.computeTrafficPressureForPark('park-1');
  assert.equal(out.traffic_pressure_score, 0);
  assert.equal(out.corridorSnapshotCount, 0);
});

test('DemandPressureService: legacy ratio delayPercent is normalized', async () => {
  const c1 = {
    id: 'c1',
    get: (opts) => (opts?.plain ? { id: 'c1', weight: 1 } : {}),
  };
  const svc = new DemandPressureService({
    TrafficCorridor: { findAll: async () => [c1] },
    TrafficCorridorSnapshot5m: {
      findOne: async () => ({
        get: (opts) =>
          opts?.plain ? { delayPercent: 0.25, congestionScore: 25, rawPayloadJson: {} } : {},
      }),
    },
  });
  const out = await svc.computeTrafficPressureForPark('park-1');
  assert.equal(out.traffic_pressure_score, 25);
});