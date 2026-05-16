'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateWgs84CorridorCoordinates,
  evaluateRouteRealismWarnings,
} = require('./traffic-corridor-coords');

test('validateWgs84CorridorCoordinates rejects out-of-range lat', () => {
  const r = validateWgs84CorridorCoordinates({
    originLat: 91,
    originLng: 0,
    destinationLat: 0,
    destinationLng: 0,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'COORD_WGS84_INVALID');
});

test('evaluateRouteRealismWarnings flags travel time and distance', () => {
  const w = evaluateRouteRealismWarnings({
    travelTimeSeconds: 0,
    routeDistanceMeters: -1,
    currentTravelTimeMin: 10,
    operatorBaselineTravelTimeMin: 10,
  });
  assert.ok(w.some((x) => x.code === 'TRAVEL_TIME_INVALID'));
  assert.ok(w.some((x) => x.code === 'ROUTE_DISTANCE_INVALID'));
});

test('evaluateRouteRealismWarnings flags extreme drift vs operator baseline', () => {
  const low = evaluateRouteRealismWarnings({
    travelTimeSeconds: 60,
    routeDistanceMeters: 1000,
    currentTravelTimeMin: 2,
    operatorBaselineTravelTimeMin: 10,
  });
  assert.ok(low.some((x) => x.code === 'CURRENT_FAR_BELOW_BASELINE'));
  const high = evaluateRouteRealismWarnings({
    travelTimeSeconds: 6000,
    routeDistanceMeters: 1000,
    currentTravelTimeMin: 50,
    operatorBaselineTravelTimeMin: 10,
  });
  assert.ok(high.some((x) => x.code === 'CURRENT_FAR_ABOVE_BASELINE'));
});
