'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeSnapshotMetrics,
  computeInboundPressureMvp,
  normalizeStoredDelayPercentAs100,
  computeWeightedTrafficPressure,
  computeExternalDemandPressure,
  computeProbabilisticAdditionalDemand,
  mapForecastStatus,
  buildRecommendations,
  buildExplanationJson,
  LEADING_INDICATOR_NOTE,
} = require('./attendance-risk-math');

test('computeSnapshotMetrics: inbound congestion from delay', () => {
  const m = computeSnapshotMetrics({
    currentTravelTimeMin: 25,
    baselineTravelTimeMin: 20,
    direction: 'inbound',
    weight: 1,
    incidentCount: 0,
  });
  assert.equal(m.delay_min, 5);
  assert.ok(Math.abs(m.delay_percent - 25) < 1e-9);
  assert.equal(m.congestion_score, 25);
  assert.equal(m.inbound_pressure_score, 25);
});

test('computeSnapshotMetrics: outbound has zero inbound pressure', () => {
  const m = computeSnapshotMetrics({
    currentTravelTimeMin: 40,
    baselineTravelTimeMin: 20,
    direction: 'outbound',
    weight: 1,
  });
  assert.equal(m.inbound_pressure_score, 0);
});

test('normalizeStoredDelayPercentAs100 maps legacy ratio', () => {
  assert.equal(normalizeStoredDelayPercentAs100(0.25), 25);
  assert.equal(normalizeStoredDelayPercentAs100(25), 25);
});

test('computeInboundPressureMvp snaps to MVP bands', () => {
  assert.equal(computeInboundPressureMvp({ delayPercent: 0, congestionScore: 0, incidentCount: 0, weight: 1 }), 0);
  assert.equal(computeInboundPressureMvp({ delayPercent: 55, congestionScore: 55, incidentCount: 0, weight: 1 }), 50);
});

test('computeWeightedTrafficPressure respects weights', () => {
  const w = computeWeightedTrafficPressure([
    { inbound_pressure_score: 40, weight: 1 },
    { inbound_pressure_score: 60, weight: 3 },
  ]);
  assert.equal(w, 55);
});

test('computeExternalDemandPressure uses weighted formula', () => {
  const e = computeExternalDemandPressure({
    traffic_pressure_score: 50,
    parking_pressure_score: 50,
    weather_score: 50,
    holiday_score: 50,
    event_score: 50,
  });
  assert.equal(e, 50);
});

test('computeProbabilisticAdditionalDemand matches MVP factors', () => {
  const p = computeProbabilisticAdditionalDemand(10000, 50);
  assert.equal(p.additional_demand_low, Math.round(10000 * 50 * 0.0012));
  assert.equal(p.additional_demand_mid, Math.round(10000 * 50 * 0.0022));
  assert.equal(p.additional_demand_high, Math.round(10000 * 50 * 0.0035));
  assert.equal(p.expected_attendance_low, 10000 + p.additional_demand_low);
});

test('mapForecastStatus bands', () => {
  assert.equal(mapForecastStatus(0), 'normal');
  assert.equal(mapForecastStatus(30), 'normal');
  assert.equal(mapForecastStatus(31), 'elevated');
  assert.equal(mapForecastStatus(61), 'high');
  assert.equal(mapForecastStatus(81), 'critical');
});

test('buildRecommendations returns non-empty per level', () => {
  assert.ok(buildRecommendations('normal').length);
  assert.ok(buildRecommendations('elevated').length);
  assert.ok(buildRecommendations('high').length >= 2);
  assert.ok(buildRecommendations('critical').length >= 2);
});

test('explanation_json includes leading indicator caveat', () => {
  const ex = buildExplanationJson({ traffic_pressure_score: 10, external_demand_pressure_score: 20 });
  assert.ok(String(ex.leadingIndicatorPrinciple).includes('leading indicator'));
  assert.equal(ex.leadingIndicatorPrinciple, LEADING_INDICATOR_NOTE);
});
