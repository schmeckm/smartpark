'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TRACKS,
  CONTRIBUTION_SOURCE,
  normalizeContributionSource,
  finalizeContributionSources,
  finalizeExplainabilityMvpEnvelope,
  buildAdrForecastExplainability,
  buildRidgeRideWaitExplainability,
  buildAiStudioExplainabilityPlaceholder,
  parseImpactMinutesString,
  directionFromImpact,
} = require('./prediction-explanation-normalizer.service');

test('parseImpactMinutesString parses signed minute strings', () => {
  assert.equal(parseImpactMinutesString('+5 min'), 5);
  assert.equal(parseImpactMinutesString('-3 min'), -3);
  assert.equal(parseImpactMinutesString('0 min'), 0);
  assert.equal(parseImpactMinutesString(null), 0);
});

test('directionFromImpact thresholds', () => {
  assert.equal(directionFromImpact(1), 'INCREASE');
  assert.equal(directionFromImpact(-1), 'DECREASE');
  assert.equal(directionFromImpact(0), 'NEUTRAL');
});

test('normalizeContributionSource: legacy labels, canon passthrough, unknown fallback', () => {
  assert.equal(normalizeContributionSource(undefined), CONTRIBUTION_SOURCE.UNKNOWN);
  assert.equal(normalizeContributionSource(null), CONTRIBUTION_SOURCE.UNKNOWN);
  assert.equal(normalizeContributionSource(''), CONTRIBUTION_SOURCE.UNKNOWN);
  assert.equal(normalizeContributionSource('  '), CONTRIBUTION_SOURCE.UNKNOWN);
  assert.equal(normalizeContributionSource('x_context'), CONTRIBUTION_SOURCE.BASELINE_INTEGRATION);
  assert.equal(normalizeContributionSource('x_layer'), CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC);
  assert.equal(normalizeContributionSource('ridge_model'), CONTRIBUTION_SOURCE.RIDGE_MODEL);
  assert.equal(normalizeContributionSource('capability_ml_policy'), CONTRIBUTION_SOURCE.CAPABILITY_ML_POLICY);
  assert.equal(normalizeContributionSource('not_a_real_source'), CONTRIBUTION_SOURCE.UNKNOWN);
});

test('finalizeContributionSources normalizes each row in place', () => {
  const rows = [{ source: 'x_context' }, { source: 'x_layer' }, { source: 'ridge_model' }, { source: 'typo' }];
  finalizeContributionSources(rows);
  assert.equal(rows[0].source, CONTRIBUTION_SOURCE.BASELINE_INTEGRATION);
  assert.equal(rows[1].source, CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC);
  assert.equal(rows[2].source, CONTRIBUTION_SOURCE.RIDGE_MODEL);
  assert.equal(rows[3].source, CONTRIBUTION_SOURCE.UNKNOWN);
});

test('finalizeExplainabilityMvpEnvelope: no-op for null / missing array; seals AiExplainabilityMvp-shaped payload', () => {
  assert.equal(finalizeExplainabilityMvpEnvelope(null), null);
  assert.equal(finalizeExplainabilityMvpEnvelope(undefined), undefined);
  assert.deepEqual(finalizeExplainabilityMvpEnvelope({}), {});
  const mvp = {
    target: 't',
    featureContributions: [{ source: 'x_layer', feature: 'f', impact: 1, direction: 'N', explanation: 'e' }],
  };
  finalizeExplainabilityMvpEnvelope(mvp);
  assert.equal(mvp.featureContributions[0].source, CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC);
});

test('ADR forecast explainability: normalized shape and featureContributions', () => {
  const summary = {
    currentAvgWaitMinutes: 28,
    forecast15Minutes: 32,
    forecast60Minutes: 38,
    confidence: 0.82,
    factors: [{ code: 'open_ratio', value: 0.72, contribution: 0.05, scope: 'PARK' }],
    topInfluencingFactors: [{ feature: 'rain_shift', impact: '+4 min', detail: 'Wet weather demand' }],
    crowdLevelPercent: 72,
    forecastSource: 'baseline_x_layer',
  };
  const legacy = {
    baseValue: 28,
    finalPrediction: 38,
    confidence: 0.82,
    adjustments: [{ factor: 'trend', direction: 'UP', magnitude: 4, reason: 'Slope' }],
  };
  const ex = buildAdrForecastExplainability({
    track: TRACKS.ADR_FORECAST,
    scope: 'park',
    summary,
    legacyExplanation: legacy,
    horizonMinutes: 60,
  });
  assert.equal(ex.unit, 'min');
  assert.equal(ex.modelInfo.track, TRACKS.ADR_FORECAST);
  assert.ok(Array.isArray(ex.featureContributions));
  assert.ok(ex.featureContributions.length >= 1);
  assert.equal(ex.target, 'predicted_queue_time_next_60min');
  assert.equal(ex.baseline, 28);
  assert.ok(typeof ex.summary === 'string' && ex.summary.length > 0);
  const open = ex.featureContributions.find((c) => c.feature === 'open_ratio');
  assert.ok(open);
  assert.equal(open.source, CONTRIBUTION_SOURCE.BASELINE_INTEGRATION);
  const trendAdj = ex.featureContributions.find((c) => c.feature === 'trend');
  assert.ok(trendAdj);
  assert.equal(trendAdj.source, CONTRIBUTION_SOURCE.X_LAYER_HEURISTIC);
});

test('ADR explainability: sparse summary does not throw', () => {
  const ex = buildAdrForecastExplainability({
    track: TRACKS.ADR_FORECAST,
    scope: 'entity',
    summary: {},
    legacyExplanation: {},
    horizonMinutes: 15,
  });
  assert.ok(Array.isArray(ex.featureContributions));
  assert.equal(ex.target, 'predicted_queue_time_next_15min');
});

test('Ridge ride wait: topFactors map to featureContributions with snapshot baseline', () => {
  const predictResult = {
    predictions: [
      { horizonMinutes: 15, value: 35, unit: 'min', source: 'ML_MODEL' },
      { horizonMinutes: 30, value: 38, unit: 'min', source: 'ML_MODEL' },
      { horizonMinutes: 60, value: 40, unit: 'min', source: 'ML_MODEL' },
    ],
    topFactors: [
      { feature: 'current_wait_time', impact: 'HIGH' },
      { feature: 'park_crowd_index', impact: 'MEDIUM' },
    ],
    confidence: 0.8,
    predictionMode: 'RIDE_SPECIFIC_MODEL',
    modelId: 'm1',
    snapshotWaitForExplain: 28,
    featureValuesForExplain: { current_wait_time: 28, park_crowd_index: 72 },
  };
  const ex = buildRidgeRideWaitExplainability(predictResult);
  assert.equal(ex.target, 'predicted_queue_time_next_30min');
  assert.equal(ex.baseline, 28);
  assert.equal(ex.prediction, 38);
  const q = ex.featureContributions.find((c) => c.feature === 'current_wait_time');
  assert.ok(q);
  assert.equal(q.value, 28);
  assert.equal(q.direction, 'NEUTRAL');
  assert.equal(q.source, CONTRIBUTION_SOURCE.RIDGE_MODEL);
  assert.equal(ex.modelInfo.track, TRACKS.RIDGE_RIDE_WAIT);
});

test('Ridge explainability: mlFeaturesMaskedByCapability adds rows and mlCapabilityMaskedFeatures list', () => {
  const ex = buildRidgeRideWaitExplainability({
    predictions: [
      { horizonMinutes: 30, value: 20, unit: 'min', source: 'ML_MODEL' },
      { horizonMinutes: 60, value: 22, unit: 'min', source: 'ML_MODEL' },
    ],
    topFactors: [{ feature: 'park_crowd_index', impact: 'HIGH' }],
    confidence: 0.8,
    predictionMode: 'RIDE_SPECIFIC_MODEL',
    modelId: 'm1',
    snapshotWaitForExplain: 18,
    featureValuesForExplain: { park_crowd_index: 55, rain_mm: 0 },
    mlFeaturesMaskedByCapability: ['rain_mm'],
  });
  assert.deepEqual(ex.mlCapabilityMaskedFeatures, ['rain_mm']);
  const cap = ex.featureContributions.find((c) => c.source === CONTRIBUTION_SOURCE.CAPABILITY_ML_POLICY);
  assert.ok(cap);
  assert.equal(cap.feature, 'rain_mm');
  assert.equal(cap.value, 0);
});

test('Ridge: missing snapshotWaitForExplain uses zero baseline without crashing', () => {
  const ex = buildRidgeRideWaitExplainability({
    predictions: [{ horizonMinutes: 60, value: 12, unit: 'min', source: 'BASELINE' }],
    topFactors: [],
    confidence: 0.5,
    predictionMode: 'BASELINE_ONLY',
  });
  assert.equal(ex.baseline, 0);
  assert.ok(Array.isArray(ex.featureContributions));
  assert.ok(ex.featureContributions.length >= 1);
});

test('AI Studio placeholder returns empty contributions and track', () => {
  const ex = buildAiStudioExplainabilityPlaceholder({ prediction: 3.2, modelId: 'cat-1' });
  assert.equal(ex.modelInfo.track, TRACKS.AI_STUDIO);
  assert.deepEqual(ex.featureContributions, []);
});
