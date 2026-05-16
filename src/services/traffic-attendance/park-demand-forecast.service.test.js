'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ParkDemandForecastService } = require('./park-demand-forecast.service');
const { LEADING_INDICATOR_NOTE } = require('./attendance-risk-math');

test('ParkDemandForecastService.runForecast stores explanation with leading indicator caveat', async () => {
  let created;
  const mockModel = {
    create: async (payload) => {
      created = payload;
      return { get: () => ({ ...payload }) };
    },
  };
  const mockPressure = {
    computeTrafficPressureForPark: async () => ({ traffic_pressure_score: 80, corridorSnapshotCount: 2 }),
    computeExternalDemandPressureFromComponents: (p) =>
      p.traffic_pressure_score * 0.5 +
      p.parking_pressure_score * 0.2 +
      p.weather_score * 0.1 +
      p.holiday_score * 0.1 +
      p.event_score * 0.1,
  };
  const svc = new ParkDemandForecastService({
    demandPressureService: mockPressure,
    ParkDemandForecast5m: mockModel,
  });
  const out = await svc.runForecast(
    '00000000-0000-4000-8000-000000000001',
    { plannedDemand: 10000, knownRegisteredExpected: 0 },
    {}
  );
  assert.ok(created);
  assert.equal(String(created.explanationJson.leadingIndicatorPrinciple), LEADING_INDICATOR_NOTE);
  assert.ok(Array.isArray(created.recommendationsJson));
  assert.equal(out.status, 'elevated');
});

test('ParkDemandForecastService.runForecast persists zero traffic when no corridor snapshots', async () => {
  let created;
  const mockModel = {
    create: async (payload) => {
      created = payload;
      return { get: () => ({ ...payload }) };
    },
  };
  const mockPressure = {
    computeTrafficPressureForPark: async () => ({ traffic_pressure_score: 0, corridorSnapshotCount: 0 }),
    computeExternalDemandPressureFromComponents: (p) => p.traffic_pressure_score,
  };
  const svc = new ParkDemandForecastService({
    demandPressureService: mockPressure,
    ParkDemandForecast5m: mockModel,
  });
  await svc.runForecast('00000000-0000-4000-8000-000000000001', { plannedDemand: 1000, knownRegisteredExpected: 0 }, {});
  assert.equal(created.trafficPressureScore, 0);
  assert.equal(created.externalDemandPressureScore, 0);
});

test('ParkDemandForecastService.runForecast applies traffic only via probabilistic bands (not 1:1 visitors)', async () => {
  let created;
  const mockModel = {
    create: async (payload) => {
      created = payload;
      return { get: () => ({ ...payload }) };
    },
  };
  const mockPressure = {
    computeTrafficPressureForPark: async () => ({ traffic_pressure_score: 100, corridorSnapshotCount: 2 }),
    computeExternalDemandPressureFromComponents: (p) => p.traffic_pressure_score,
  };
  const svc = new ParkDemandForecastService({
    demandPressureService: mockPressure,
    ParkDemandForecast5m: mockModel,
  });
  await svc.runForecast('00000000-0000-4000-8000-000000000001', { plannedDemand: 5000, knownRegisteredExpected: 0 }, {});
  assert.equal(created.trafficPressureScore, 100);
  assert.equal(created.externalDemandPressureScore, 100);
  const expectedLow = 5000 + Math.round(5000 * 100 * 0.0012);
  assert.equal(created.expectedAttendanceLow, expectedLow);
  assert.notEqual(created.expectedAttendanceLow, 5100);
});

test('ParkDemandForecastService.runForecast queries traffic pressure from latest snapshots path', async () => {
  let trafficCalls = 0;
  const mockModel = {
    create: async (payload) => ({ get: () => ({ ...payload }) }),
  };
  const parkId = '00000000-0000-4000-8000-000000000001';
  const mockPressure = {
    computeTrafficPressureForPark: async (pid) => {
      trafficCalls += 1;
      assert.equal(pid, parkId);
      return { traffic_pressure_score: 42, corridorSnapshotCount: 2 };
    },
    computeExternalDemandPressureFromComponents: (p) => p.traffic_pressure_score,
  };
  const svc = new ParkDemandForecastService({
    demandPressureService: mockPressure,
    ParkDemandForecast5m: mockModel,
  });
  await svc.runForecast(parkId, { plannedDemand: 1000, knownRegisteredExpected: 0 }, {});
  assert.equal(trafficCalls, 1);
});
