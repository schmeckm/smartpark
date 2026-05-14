'use strict';

/**
 * Backend smoke: ML Feature Monitor + Forecast Accuracy observability chain (deterministic fixture).
 *
 * Seeds a dedicated park + RIDE `park_assets` + governed `ride_feature_snapshots_5m` rows (no MQTT/UNS).
 * After `predict`, backdates `ml_prediction_results.created_at` in the DB so horizon-15 accuracy can run
 * immediately, then inserts the “actual” snapshot at `created_at + 15m` (semantic match for evaluation).
 *
 * Opt-in: `ML_FORECAST_OBSERVABILITY_E2E=1` (or `true`) **and**:
 * - Postgres reachable (migrations applied)
 * - Seeded user (default demo admin)
 * - `ML_TRACE_ENABLED=true`, `ML_PROFILE_ENABLED=true`, `ML_FEATURE_WEIGHTS_ENABLED=true`
 *
 * Does not assert numeric forecast values beyond accuracy fixture. Does not modify forecast or model logic.
 *
 * From repository root (`Smart Park/`):
 *
 * PowerShell:
 *   cd "C:\\path\\to\\Smart Park"
 *   $env:ML_FORECAST_OBSERVABILITY_E2E='1'; $env:ML_TRACE_ENABLED='true'; $env:ML_PROFILE_ENABLED='true'; $env:ML_FEATURE_WEIGHTS_ENABLED='true'; npm run test:integration:ml-observability
 *
 * Bash:
 *   ML_FORECAST_OBSERVABILITY_E2E=1 ML_TRACE_ENABLED=true ML_PROFILE_ENABLED=true ML_FEATURE_WEIGHTS_ENABLED=true \\
 *     npm run test:integration:ml-observability
 *
 * From `admin-dashboard/` the npm script forwards to the root package (`--prefix ..`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const request = require('supertest');
const { sequelize, MlPredictionResult, MlPredictionTrace } = require('../../models');
const env = require('../../config/env');
const { app, loginAccessToken } = require('../../test-utils/integration-http');
const {
  seedMlForecastObservabilityFixture,
  cleanupMlForecastObservabilityFixture,
  FIXTURE_PARK_ID,
  FIXTURE_ASSET_ID,
  backdateMlPredictionResultsForAccuracy,
  insertAccuracyActualSnapshot,
  deleteAccuracyLogsForPrediction,
} = require('./ml-forecast-observability.fixture');

const ENABLED =
  process.env.ML_FORECAST_OBSERVABILITY_E2E === '1' ||
  process.env.ML_FORECAST_OBSERVABILITY_E2E === 'true';

/** Minutes to subtract from `now` when backdating prediction rows so `created_at + 15m <= now`. */
const BACKDATE_MINUTES = 40;

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let dbOk = false;

test.before(async () => {
  if (!ENABLED) return;
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch {
    dbOk = false;
  }
});

test('ML observability (seeded): predict → traces → accuracy KPIs + horizon-15 actual', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  if (!env.mlTraceEnabled || !env.mlProfileEnabled || !env.mlFeatureWeightsEnabled) {
    t.skip();
    return;
  }

  await seedMlForecastObservabilityFixture();
  const parkId = FIXTURE_PARK_ID;
  const rideId = FIXTURE_ASSET_ID;

  try {
    const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');

    const predictRes = await request(app)
      .get(`/api/v1/ai/ml/predict/rides/${encodeURIComponent(rideId)}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);

    assert.equal(predictRes.status, 200, predictRes.text);
    assert.equal(predictRes.body.success, true);
    assert.ok(predictRes.body.data, 'forecast envelope missing data');

    let predictionId = '';
    let traceRows = [];
    for (let i = 0; i < 40; i += 1) {
      const listRes = await request(app)
        .get('/api/v1/ai/ml/prediction-traces')
        .query({ rideId, limit: 10 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Park-Id', parkId);

      assert.notEqual(listRes.status, 404, 'prediction-traces list must not be 404');
      assert.equal(listRes.status, 200, listRes.text);
      assert.equal(listRes.body.success, true);
      traceRows = Array.isArray(listRes.body.data) ? listRes.body.data : [];
      if (traceRows.length > 0) {
        predictionId = String(traceRows[0].predictionId || '').trim();
        if (predictionId) break;
      }
      await delay(200);
    }

    assert.ok(predictionId, 'expected a prediction trace for fixture ride after predict');

    const foRes = await request(app)
      .get('/api/v1/ai/ml/prediction-traces/filter-options')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);

    assert.equal(foRes.status, 200, foRes.text);
    assert.equal(foRes.body.success, true);
    const fo = foRes.body.data;
    assert.ok(fo && typeof fo === 'object', 'filter-options payload missing');
    assert.ok(Array.isArray(fo.modelNames), 'modelNames must be array');
    assert.ok(Array.isArray(fo.targetNames), 'targetNames must be array');
    assert.ok(fo.modelNames.includes('ride_wait_forecast'), 'expected ride_wait_forecast in filter options');
    assert.ok(fo.targetNames.includes('ride_wait_minutes'), 'expected ride_wait_minutes in filter options');

    const OTHER_PARK = 'e2ef0099-0000-4000-8000-000000000099';
    await MlPredictionTrace.create({
      predictionId: randomUUID(),
      parkId: OTHER_PARK,
      rideId: null,
      modelName: 'e2e_other_park_filter_options',
      targetName: 'ride_wait_minutes',
      featureVectorJson: {},
      featureSourcesJson: {},
      featureStatusJson: {},
      missingFeaturesJson: [],
      fallbackUsed: false,
    });
    try {
      const foScoped = await request(app)
        .get('/api/v1/ai/ml/prediction-traces/filter-options')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Park-Id', parkId);
      assert.equal(foScoped.status, 200, foScoped.text);
      const names = foScoped.body.data.modelNames;
      assert.ok(
        !names.includes('e2e_other_park_filter_options'),
        'filter-options must be scoped to active park'
      );
    } finally {
      await MlPredictionTrace.destroy({ where: { parkId: OTHER_PARK } }).catch(() => {});
    }

    const listAllRes = await request(app)
      .get('/api/v1/ai/ml/prediction-traces')
      .query({ rideId, limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);
    assert.equal(listAllRes.status, 200, listAllRes.text);
    const listAllCount = Array.isArray(listAllRes.body.data) ? listAllRes.body.data.length : 0;
    assert.ok(listAllCount >= 1, 'expected trace list without model filter');

    const listFiltered = await request(app)
      .get('/api/v1/ai/ml/prediction-traces')
      .query({ rideId, modelName: 'ride_wait_forecast', limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);
    assert.equal(listFiltered.status, 200, listFiltered.text);
    const filteredRows = Array.isArray(listFiltered.body.data) ? listFiltered.body.data : [];
    assert.ok(filteredRows.length >= 1, 'modelName filter should return matching traces');
    for (const row of filteredRows) {
      assert.equal(String(row.modelName), 'ride_wait_forecast');
    }

    const listNone = await request(app)
      .get('/api/v1/ai/ml/prediction-traces')
      .query({ rideId, modelName: '__no_such_model_for_e2e__', limit: 10 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);
    assert.equal(listNone.status, 200, listNone.text);
    assert.equal(Array.isArray(listNone.body.data) ? listNone.body.data.length : 0, 0);

    const detailRes = await request(app)
      .get(`/api/v1/ai/ml/prediction-traces/${encodeURIComponent(predictionId)}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);

    assert.notEqual(detailRes.status, 404, 'prediction-trace detail must not be 404 for owned trace');
    assert.equal(detailRes.status, 200, detailRes.text);
    assert.equal(detailRes.body.success, true);
    const envelope = detailRes.body.data;
    assert.ok(envelope && typeof envelope === 'object', 'detail envelope missing');

    assert.ok(Object.prototype.hasOwnProperty.call(envelope, 'trace'), 'missing trace');
    assert.ok(Object.prototype.hasOwnProperty.call(envelope, 'results'), 'missing results');
    assert.ok(Array.isArray(envelope.results), 'results must be array');
    assert.ok(Object.prototype.hasOwnProperty.call(envelope, 'learnedCoefficients'), 'missing learnedCoefficients');
    assert.ok(Object.prototype.hasOwnProperty.call(envelope, 'manualBusinessWeights'), 'missing manualBusinessWeights');

    const tr = envelope.trace;
    assert.ok(tr && typeof tr === 'object', 'trace object missing');
    assert.ok(tr.featureVectorJson != null && typeof tr.featureVectorJson === 'object', 'featureVectorJson missing');
    assert.ok(
      Object.keys(tr.featureVectorJson).length > 0,
      'featureVectorJson must be non-empty for governed snapshot fixture'
    );
    assert.ok(
      tr.weightedFeatureVectorJson != null && typeof tr.weightedFeatureVectorJson === 'object',
      'weightedFeatureVectorJson must be object'
    );

    const h15 = envelope.results.find((r) => Number(r.horizonMinutes) === 15);
    assert.ok(h15, 'expected a prediction result row for horizon 15');

    await backdateMlPredictionResultsForAccuracy(predictionId, parkId, BACKDATE_MINUTES);
    const prRow = await MlPredictionResult.findOne({ where: { predictionId, parkId } });
    assert.ok(prRow, 'ml_prediction_results row expected after backdate');
    const createdAnchor = new Date(prRow.createdAt);
    assert.ok(Number.isFinite(createdAnchor.getTime()), 'invalid prediction created_at');
    const nominalEvalAt = new Date(createdAnchor.getTime() + 15 * 60 * 1000);
    await insertAccuracyActualSnapshot(nominalEvalAt);
    await deleteAccuracyLogsForPrediction(predictionId);

    let kpi = null;
    for (let j = 0; j < 15; j += 1) {
      const kpiRes = await request(app)
        .get('/api/v1/ai/ml/forecast-accuracy/kpis')
        .query({ rideId })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Park-Id', parkId);

      assert.notEqual(kpiRes.status, 404, 'forecast-accuracy KPIs must not be 404');
      assert.equal(kpiRes.status, 200, kpiRes.text);
      assert.equal(kpiRes.body.success, true);
      kpi = kpiRes.body.data;
      assert.ok(kpi && typeof kpi === 'object', 'KPI payload missing');
      if (Number(kpi.totalEvaluations) >= 1) break;
      await delay(150);
    }

    for (const key of ['totalEvaluations', 'avgAbsoluteError', 'avgPercentageError', 'rmse', 'bias']) {
      assert.ok(Object.prototype.hasOwnProperty.call(kpi, key), `KPI missing ${key}`);
    }
    assert.ok(Number(kpi.totalEvaluations) >= 1, 'totalEvaluations >= 1 after catch-up');

    const logsRes = await request(app)
      .get('/api/v1/ai/ml/forecast-accuracy')
      .query({ rideId, horizonMinutes: 15, limit: 20 })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);

    assert.equal(logsRes.status, 200, logsRes.text);
    assert.equal(logsRes.body.success, true);
    const logs = Array.isArray(logsRes.body.data) ? logsRes.body.data : [];
    const log15 = logs.find(
      (row) =>
        String(row.predictionId || '') === predictionId &&
        Number(row.horizonMinutes) === 15
    );
    assert.ok(log15, 'expected accuracy log for horizon 15 and fixture prediction');

    for (const key of ['predictedValue', 'actualValue', 'absoluteError', 'bias', 'accuracyStatus']) {
      assert.ok(Object.prototype.hasOwnProperty.call(log15, key), `accuracy log missing ${key}`);
    }
    assert.equal(Number(log15.actualValue), 25, 'actual wait from governed snapshot must be 25');

    const dqRes = await request(app)
      .get('/api/v1/ai/feature-data-quality')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Park-Id', parkId);

    assert.notEqual(dqRes.status, 404, 'feature-data-quality must not be 404');
    assert.equal(dqRes.status, 200, dqRes.text);
    assert.equal(dqRes.body.success, true);
    const dq = dqRes.body.data;
    assert.ok(dq && typeof dq === 'object', 'DQ payload missing');
    assert.ok(dq.kpis && typeof dq.kpis === 'object', 'DQ kpis missing');
    assert.ok(Object.prototype.hasOwnProperty.call(dq.kpis, 'avgCompletenessScore'), 'avgCompletenessScore missing');
    assert.ok(
      dq.kpis.avgCompletenessScore === null || typeof dq.kpis.avgCompletenessScore === 'number',
      'avgCompletenessScore must be number or null'
    );
  } finally {
    await cleanupMlForecastObservabilityFixture();
  }
});
