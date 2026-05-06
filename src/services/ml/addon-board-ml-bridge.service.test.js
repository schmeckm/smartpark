const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parkDemandIndexFromAvg60,
  aggregateFromRideForecastParts,
} = require('./addon-board-ml-bridge.service');

test('parkDemandIndexFromAvg60 thresholds', () => {
  assert.equal(parkDemandIndexFromAvg60(10), 'LOW');
  assert.equal(parkDemandIndexFromAvg60(30), 'MEDIUM');
  assert.equal(parkDemandIndexFromAvg60(60), 'HIGH');
  assert.equal(parkDemandIndexFromAvg60(null), 'UNKNOWN');
});

test('all-zero 60m forecasts yield null avg and UNKNOWN demand', () => {
  const parts = [
    { rideId: 'a', zoneId: 'z1', isOpen: true, forecast60: 0 },
    { rideId: 'b', zoneId: 'z1', isOpen: true, forecast60: 0 },
  ];
  const agg = aggregateFromRideForecastParts(parts, 55);
  assert.equal(agg.averageForecastWaitTime60, null);
  assert.equal(agg.parkDemandForecastIndex, 'UNKNOWN');
});

test('aggregateFromRideForecastParts averages open rides and counts critical', () => {
  const parts = [
    { rideId: 'a', zoneId: 'z1', isOpen: true, forecast60: 40 },
    { rideId: 'b', zoneId: 'z1', isOpen: true, forecast60: 60 },
    { rideId: 'c', zoneId: 'z2', isOpen: false, forecast60: 120 },
    { rideId: 'd', zoneId: 'z2', isOpen: true, forecast60: 30 },
  ];
  const agg = aggregateFromRideForecastParts(parts, 55);
  assert.equal(agg.openRidesWithForecast, 3);
  assert.equal(agg.averageForecastWaitTime60, Math.round(((40 + 60 + 30) / 3) * 10) / 10);
  assert.equal(agg.forecastCriticalRides, 1);
  assert.equal(agg.parkDemandForecastIndex, 'MEDIUM');
  const z1 = agg.zones.find((z) => z.zoneId === 'z1');
  assert.ok(z1);
  assert.equal(z1.zoneForecastCriticalRides, 1);
  assert.equal(z1.zoneForecastWaitTime60, 50);
});
