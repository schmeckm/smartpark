'use strict';

/**
 * Phase 1 — ML ride-wait prediction trace (best-effort; never throws to forecast callers).
 * Governed inputs only: features derived from `ride_feature_snapshots_5m` via snapshotToFeatureMap.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const env = require('../../config/env');
const { logger } = require('../../utils/logger');
const { MlPredictionTrace, MlPredictionResult } = require('../../models');
const { TRAINING_FEATURE_NAMES, featureVectorFromMap } = require('./ride-feature-vector.util');
const { buildWeightedFeatureVector } = require('./ml-feature-weight.util');
const { loadResolvedWeightsForTrace } = require('./ml-feature-weights-resolve.service');
const {
  pickRegistryModelIdFromTrace,
  buildLearnedCoefficientsView,
} = require('./ml-learned-coefficients-view.util');
const { findModelRegistryRowForTrace } = require('./ml-model-registry.service');

const TARGET_RIDE_WAIT_MINUTES = 'ride_wait_minutes';

function isMlTraceEnabled() {
  return Boolean(env.mlTraceEnabled);
}

function buildPredictionId() {
  return crypto.randomUUID();
}

/**
 * Stable hash of the ordered feature vector (TRAINING_FEATURE_NAMES order),
 * aligned with `featureVectorFromMap` / ridge input.
 * @param {Record<string, number|undefined|null>} featureVector
 */
function hashFeatureVector(featureVector) {
  const ordered = featureVectorFromMap(featureVector);
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function featureSourcesForRideSnapshot() {
  const o = {};
  for (const k of TRAINING_FEATURE_NAMES) {
    o[k] = 'ride_feature_snapshot_5m';
  }
  return o;
}

/**
 * @param {Record<string, unknown>} rawMap - pre-mask snapshotToFeatureMap output
 * @param {Set<string>|null} maskedKeys
 */
function buildFeatureStatusAndMissing(rawMap, maskedKeys) {
  const featureStatusJson = {};
  const missing = [];
  for (const k of TRAINING_FEATURE_NAMES) {
    const v = rawMap[k];
    const num = Number(v);
    const isMissing = v == null || v === '' || !Number.isFinite(num);
    if (maskedKeys && maskedKeys.has(k)) {
      featureStatusJson[k] = 'masked';
    } else if (isMissing) {
      featureStatusJson[k] = 'missing';
      missing.push(k);
    } else {
      featureStatusJson[k] = 'ok';
    }
  }
  return { featureStatusJson, missingFeaturesJson: missing };
}

/**
 * Ordered storage matching TRAINING_FEATURE_NAMES (same coercion as training / ridge X).
 * @param {Record<string, unknown>} vec
 */
function orderedFeatureVectorJson(vec) {
  const arr = featureVectorFromMap(vec);
  const o = {};
  for (let i = 0; i < TRAINING_FEATURE_NAMES.length; i++) {
    o[TRAINING_FEATURE_NAMES[i]] = arr[i];
  }
  return o;
}

/**
 * @param {object} payload
 * @returns {Promise<object|null>}
 */
async function logPredictionTrace(payload) {
  if (!isMlTraceEnabled()) return null;
  try {
    const row = await MlPredictionTrace.create({
      predictionId: payload.predictionId,
      parkId: payload.parkId ?? null,
      rideId: payload.rideId ?? null,
      modelName: payload.modelName,
      modelVersion: payload.modelVersion ?? null,
      targetName: payload.targetName,
      horizonMinutes: payload.horizonMinutes ?? null,
      featureVectorJson: payload.featureVectorJson || {},
      featureSourcesJson: payload.featureSourcesJson || {},
      featureStatusJson: payload.featureStatusJson || {},
      missingFeaturesJson: Array.isArray(payload.missingFeaturesJson) ? payload.missingFeaturesJson : [],
      fallbackUsed: Boolean(payload.fallbackUsed),
      predictionInputHash: payload.predictionInputHash ?? null,
      weightedFeatureVectorJson: payload.weightedFeatureVectorJson || {},
      governedSnapshotQualityReason: payload.governedSnapshotQualityReason ?? null,
    });
    return row.get({ plain: true });
  } catch (err) {
    logger.warn({ err, msg: 'ml_prediction_traces write failed (ignored)' });
    return null;
  }
}

/**
 * @param {object} payload
 * @returns {Promise<object|null>}
 */
async function logPredictionResult(payload) {
  if (!isMlTraceEnabled()) return null;
  try {
    const row = await MlPredictionResult.create({
      predictionId: payload.predictionId,
      parkId: payload.parkId ?? null,
      rideId: payload.rideId ?? null,
      modelName: payload.modelName,
      modelVersion: payload.modelVersion ?? null,
      targetName: payload.targetName,
      horizonMinutes: payload.horizonMinutes ?? null,
      predictedValue: payload.predictedValue != null ? String(payload.predictedValue) : null,
      actualValue: payload.actualValue != null ? String(payload.actualValue) : null,
      confidenceScore:
        payload.confidenceScore != null && payload.confidenceScore !== ''
          ? String(payload.confidenceScore)
          : null,
      reasonCodesJson: Array.isArray(payload.reasonCodesJson) ? payload.reasonCodesJson : [],
      fallbackUsed: Boolean(payload.fallbackUsed),
    });
    return row.get({ plain: true });
  } catch (err) {
    logger.warn({ err, msg: 'ml_prediction_results write failed (ignored)' });
    return null;
  }
}

/**
 * @param {{ parkId?: string|null, rideId?: string|null, modelName?: string, targetName?: string, from?: Date|string, to?: Date|string, limit?: number }} filters
 */
async function listPredictionTraces(filters = {}) {
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
  const where = {};
  if (filters.parkId) where.parkId = String(filters.parkId);
  if (filters.rideId) where.rideId = String(filters.rideId);
  if (filters.modelName) where.modelName = String(filters.modelName);
  if (filters.targetName) where.targetName = String(filters.targetName);
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt[Op.gte] = new Date(filters.from);
    if (filters.to) where.createdAt[Op.lte] = new Date(filters.to);
  }
  const rows = await MlPredictionTrace.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * Distinct non-empty `model_name` / `target_name` values for Feature Monitor filter dropdowns.
 * Scoped by `park_id` (same as {@link listPredictionTraces}). Alphabetically sorted.
 *
 * @param {string|null|undefined} parkId
 * @returns {Promise<{ modelNames: string[], targetNames: string[] }>}
 */
async function listPredictionTraceFilterOptions(parkId) {
  const pk = String(parkId || '').trim();
  if (!pk) return { modelNames: [], targetNames: [] };
  const sequelize = MlPredictionTrace.sequelize;
  const baseWhere = `
    WHERE park_id = :parkId
      AND model_name IS NOT NULL
      AND BTRIM(model_name) <> ''`;
  const targetWhere = `
    WHERE park_id = :parkId
      AND target_name IS NOT NULL
      AND BTRIM(target_name) <> ''`;

  const modelRows = await sequelize.query(
    `SELECT DISTINCT model_name AS "modelName"
     FROM ml_prediction_traces
     ${baseWhere}
     ORDER BY model_name ASC`,
    { replacements: { parkId: pk }, type: sequelize.QueryTypes.SELECT }
  );
  const targetRows = await sequelize.query(
    `SELECT DISTINCT target_name AS "targetName"
     FROM ml_prediction_traces
     ${targetWhere}
     ORDER BY target_name ASC`,
    { replacements: { parkId: pk }, type: sequelize.QueryTypes.SELECT }
  );

  const modelNames = modelRows.map((r) => String(r.modelName)).filter((s) => s.length > 0);
  const targetNames = targetRows.map((r) => String(r.targetName)).filter((s) => s.length > 0);
  return { modelNames, targetNames };
}

/**
 * @returns {Promise<{ trace: object|null, results: object[] }>}
 */
async function getPredictionTraceByPredictionId(predictionId) {
  const pid = String(predictionId || '').trim();
  if (!pid) return { trace: null, results: [] };
  const trace = await MlPredictionTrace.findOne({ where: { predictionId: pid } });
  const results = await MlPredictionResult.findAll({
    where: { predictionId: pid },
    order: [
      ['horizonMinutes', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });
  return {
    trace: trace ? trace.get({ plain: true }) : null,
    results: results.map((r) => r.get({ plain: true })),
  };
}

/**
 * Phase 5 — read-only learned ridge coefficients + resolved manual weights for Feature Monitor detail.
 * @param {object|null} trace
 * @param {object[]} results
 */
async function enrichMlPredictionTraceDetail(trace, results) {
  let learnedCoefficients = null;
  if (trace) {
    const modelId = pickRegistryModelIdFromTrace(trace, results);
    if (modelId) {
      const reg = await findModelRegistryRowForTrace(modelId, trace);
      if (reg) {
        learnedCoefficients = buildLearnedCoefficientsView(reg.modelPayload, reg.modelId, reg);
      }
    }
  }
  let manualBusinessWeights = null;
  if (trace && trace.parkId && trace.rideId) {
    manualBusinessWeights = await loadResolvedWeightsForTrace(trace.parkId, trace.rideId);
  }
  return { learnedCoefficients, manualBusinessWeights };
}

/**
 * Phase 5 — read-only API projection of ridge coefficients from ml_model_registry for the trace’s resolved model.
 * Does not mutate forecasts; empty `coefficients` when baseline/fallback or payload missing.
 *
 * @param {string} predictionId
 * @param {string} parkId — active park (`X-Park-Id`)
 * @returns {Promise<{ data: object }|null>} `null` if trace missing or foreign park
 */
async function getPredictionTraceCoefficientsReadOnly(predictionId, parkId) {
  const pid = String(predictionId || '').trim();
  const pk = String(parkId || '').trim();
  if (!pid || !pk) return null;
  const { trace, results } = await getPredictionTraceByPredictionId(pid);
  if (!trace || String(trace.parkId) !== pk) return null;

  const registryModelId = pickRegistryModelIdFromTrace(trace, results);
  const resultsArr = Array.isArray(results) ? results : [];

  const displayRowForId = () => {
    if (!registryModelId) return null;
    const r60 = resultsArr.find(
      (r) => Number(r.horizonMinutes) === 60 && String(r.modelName) === registryModelId
    );
    if (r60) return r60;
    return resultsArr.find((r) => String(r.modelName) === registryModelId) || null;
  };

  const dispRow = displayRowForId();
  let modelName = dispRow?.modelName || trace.modelName || '';
  let modelVersion = dispRow?.modelVersion ?? trace.modelVersion ?? null;

  /** @type {Array<{ feature: string, coefficient: number, direction: string, absoluteRank: number }>} */
  let coefficients = [];
  if (registryModelId) {
    const reg = await findModelRegistryRowForTrace(registryModelId, trace);
    if (reg) {
      const view = buildLearnedCoefficientsView(reg.modelPayload, reg.modelId, reg);
      if (view && Array.isArray(view.rows) && view.rows.length) {
        coefficients = view.rows.map((r) => ({
          feature: r.feature,
          coefficient: r.coefficient,
          direction: r.direction,
          absoluteRank: r.absImpactRank,
        }));
        modelName = String(reg.modelId || modelName);
        modelVersion =
          reg.trainedAt != null ? new Date(reg.trainedAt).toISOString() : modelVersion ?? null;
      }
    }
  }

  return {
    data: {
      predictionId: trace.predictionId,
      modelName,
      modelVersion,
      coefficients,
    },
  };
}

/**
 * @param {object} opts
 * @param {string} opts.parkId
 * @param {string} opts.rideId
 * @param {'NO_SNAPSHOT'|'FORECAST_INELIGIBLE'|undefined} opts.note
 * @param {Record<string, unknown>} opts.rawFeatureMap
 * @param {Record<string, unknown>} opts.maskedFeatureMap
 * @param {Set<string>} opts.maskedKeys
 * @param {object[]} opts.predictions
 * @param {object[]} opts.horizonMeta
 * @param {number} opts.overallConfidence
 * @param {string|null} [opts.registryModelId]
 * @param {string|null} [opts.governedSnapshotQualityReason]
 */
async function runRideWaitMlTrace(opts) {
  if (!isMlTraceEnabled()) return;

  const {
    parkId,
    rideId,
    note,
    rawFeatureMap,
    maskedFeatureMap,
    maskedKeys,
    predictions,
    horizonMeta,
    overallConfidence,
    registryModelId,
    topFactors,
    governedSnapshotQualityReason,
  } = opts;

  const predictionId = buildPredictionId();
  const maskedSet = maskedKeys && maskedKeys.size ? new Set(maskedKeys) : null;
  const raw = rawFeatureMap || {};
  const masked = maskedFeatureMap || {};
  const { featureStatusJson, missingFeaturesJson } = buildFeatureStatusAndMissing(raw, maskedSet);
  const featureVectorJson = orderedFeatureVectorJson(masked);
  const predictionInputHash = hashFeatureVector(masked);

  let weightedFeatureVectorJson = {};
  if (parkId && rideId && env.mlFeatureWeightsEnabled) {
    try {
      const resolved = await loadResolvedWeightsForTrace(parkId, rideId);
      if (resolved) {
        weightedFeatureVectorJson = buildWeightedFeatureVector(
          masked,
          resolved.merged,
          resolved.sources,
          featureStatusJson
        );
      }
    } catch (err) {
      logger.warn({ err, msg: 'weighted_feature_vector_json build failed (trace continues)' });
    }
  }

  const isNoSnap = note === 'NO_SNAPSHOT';
  const isForecastIneligible = note === 'FORECAST_INELIGIBLE';
  const traceModelName = isNoSnap
    ? 'no_governed_snapshot'
    : isForecastIneligible
      ? 'closed_period_forecast'
      : 'ride_wait_forecast';
  const traceModelVersion = registryModelId || null;
  const anyFallback =
    isNoSnap ||
    isForecastIneligible ||
    (horizonMeta || []).some((h) => h && h.fallbackUsed);

  await logPredictionTrace({
    predictionId,
    parkId,
    rideId,
    modelName: traceModelName,
    modelVersion: traceModelVersion,
    targetName: TARGET_RIDE_WAIT_MINUTES,
    horizonMinutes: null,
    featureVectorJson,
    featureSourcesJson: featureSourcesForRideSnapshot(),
    featureStatusJson,
    missingFeaturesJson,
    fallbackUsed: anyFallback,
    predictionInputHash,
    weightedFeatureVectorJson,
    governedSnapshotQualityReason: governedSnapshotQualityReason ?? null,
  });

  const preds = predictions || [];
  const meta = horizonMeta || [];
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i];
    const hm = meta[i] || {};
    const codes = [];
    if (hm.source === 'BASELINE') codes.push('SOURCE_BASELINE');
    if (hm.source === 'ML_MODEL') codes.push('SOURCE_ML_MODEL');
    if (hm.fallbackUsed) codes.push('FALLBACK_BASELINE');
    if (Array.isArray(hm.reasonCodes)) {
      for (const c of hm.reasonCodes) codes.push(String(c));
    }
    if (isNoSnap) codes.push('NO_GOVERNED_SNAPSHOT');
    if (Number(p.horizonMinutes) === 60 && Array.isArray(topFactors)) {
      for (const tf of topFactors.slice(0, 5)) {
        if (tf && tf.feature) codes.push(`TOP_FACTOR:${tf.feature}`);
      }
    }

    await logPredictionResult({
      predictionId,
      parkId,
      rideId,
      modelName: hm.resultModelName || traceModelName,
      modelVersion: hm.resultModelVersion ?? null,
      targetName: TARGET_RIDE_WAIT_MINUTES,
      horizonMinutes: p.horizonMinutes ?? null,
      predictedValue: p.value,
      actualValue: null,
      confidenceScore: overallConfidence,
      reasonCodesJson: codes,
      fallbackUsed: Boolean(hm.fallbackUsed),
    });
  }
}

/**
 * Fire-and-forget trace for ride wait prediction path (never rejects to caller).
 */
function scheduleRideWaitMlTrace(opts) {
  if (!isMlTraceEnabled()) return;
  void runRideWaitMlTrace(opts).catch((err) =>
    logger.warn({ err, msg: 'runRideWaitMlTrace failed (ignored)' })
  );
}

module.exports = {
  isMlTraceEnabled,
  buildPredictionId,
  hashFeatureVector,
  logPredictionTrace,
  logPredictionResult,
  listPredictionTraces,
  listPredictionTraceFilterOptions,
  getPredictionTraceByPredictionId,
  enrichMlPredictionTraceDetail,
  getPredictionTraceCoefficientsReadOnly,
  scheduleRideWaitMlTrace,
  runRideWaitMlTrace,
  TARGET_RIDE_WAIT_MINUTES,
};
