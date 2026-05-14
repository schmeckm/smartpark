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
