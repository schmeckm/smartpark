'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DemandPressureService } = require('./demand-pressure.service');

test('DemandPressureService: weighted traffic from latest snapshots', async () => {
  const c1 = { id: 'c1', weight: 1 };
  const c2 = { id: 'c2', weight: 3 };
  const snaps = {
    c1: { inboundPressureScore: 40 },
    c2: { inboundPressureScore: 60 },
  };
  const svc = new DemandPressureService({
    TrafficCorridor: {
      findAll: async () => [c1, c2],
    },
    TrafficCorridorSnapshot5m: {
      findOne: async ({ where }) => snaps[where.corridorId] || null,
    },
  });
  const out = await svc.computeTrafficPressureForPark('park-1');
  assert.equal(out.traffic_pressure_score, 55);
  assert.equal(out.corridorSnapshotCount, 2);
});

test('DemandPressureService: no snapshots yields zero traffic pressure', async () => {
  const svc = new DemandPressureService({
    TrafficCorridor: {
      findAll: async () => [{ id: 'x', weight: 1 }],
    },
    TrafficCorridorSnapshot5m: {
      findOne: async () => null,
    },
  });
  const out = await svc.computeTrafficPressureForPark('park-1');
  assert.equal(out.traffic_pressure_score, 0);
  assert.equal(out.corridorSnapshotCount, 0);
});
