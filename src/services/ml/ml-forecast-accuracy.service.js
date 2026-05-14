'use strict';

/**
 * Forecast accuracy tracking — read-only observability.
 * Compares ml_prediction_results to governed ride_feature_snapshots_5m at prediction_time + horizon.
 * Failures are swallowed; never impacts forecasting.
 */

const { Op } = require('sequelize');
const { sequelize } = require('../../db/sequelize');
const { logger } = require('../../utils/logger');
const { MlForecastAccuracyLog, MlPredictionResult, RideFeatureSnapshot } = require('../../models');
const { isAccuracyEligiblePlain } = require('../../utils/ride-snapshot-eligibility.util');

/** Aligns with ride-dataset.service.js horizon matching window (±7.5 min around nominal bucket). */
const HALF_WINDOW_MS = 7.5 * 60 * 1000;

const STATUS = {
  OK: 'OK',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
};

/** Query flag + list filter: exclude rows without a usable Ist comparison (UNKNOWN / null actual). */
function coerceComparableOnly(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
  }
  return false;
}

/**
 * @param {unknown} predicted
 * @param {unknown} actual
 * @returns {{
 *   accuracyStatus: string,
 *   absoluteError: number|null,
 *   percentageError: number|null,
 *   squaredError: number|null,
 *   bias: number|null,
 * }}
 */
function calculateAccuracyMetrics(predicted, actual) {
  const p = predicted != null && predicted !== '' ? Number(predicted) : NaN;
  const a = actual != null && actual !== '' ? Number(actual) : NaN;

  if (!Number.isFinite(p) || !Number.isFinite(a)) {
    return {
      accuracyStatus: STATUS.UNKNOWN,
      absoluteError: null,
      percentageError: null,
      squaredError: null,
      bias: null,
    };
  }

  const bias = p - a;
  const absoluteError = Math.abs(a - p);
  const squaredError = (p - a) ** 2;

  const denom = Math.abs(a);
  if (denom === 0) {
    return {
      accuracyStatus: STATUS.UNKNOWN,
      absoluteError,
      percentageError: null,
      squaredError,
      bias,
    };
  }

  const percentageError = absoluteError / denom;
  let accuracyStatus = STATUS.OK;
  if (percentageError > 0.25) accuracyStatus = STATUS.CRITICAL;
  else if (percentageError > 0.1) accuracyStatus = STATUS.WARNING;

  return {
    accuracyStatus,
    absoluteError,
    percentageError,
    squaredError,
    bias,
  };
}

/**
 * @param {string} parkId
 * @param {string} rideId
 * @param {Date} nominalEvalAt — prediction timestamp + horizon
 * @returns {Promise<{ actualValue: number|null, evaluationReason: string|null }>}
 */
async function resolveActualWaitFromGovernedSnapshot(parkId, rideId, nominalEvalAt) {
  if (!parkId || !rideId || !nominalEvalAt || !Number.isFinite(nominalEvalAt.getTime())) {
    return { actualValue: null, evaluationReason: null };
  }

  const mid = nominalEvalAt.getTime();
  const lo = new Date(mid - HALF_WINDOW_MS);
  const hi = new Date(mid + HALF_WINDOW_MS);

  const rows = await RideFeatureSnapshot.findAll({
    where: {
      internalParkId: String(parkId),
      internalAssetId: String(rideId),
      snapshotAt: { [Op.between]: [lo, hi] },
    },
    order: [['snapshotAt', 'ASC']],
    limit: 24,
  });

  let best = null;
  let bestDist = Infinity;
  let ineligibleWithWait = false;
  /** @type {string|null} */
  let ineligibleReason = null;

  for (const r of rows) {
    const plain = r.get({ plain: true });
    const eligible = isAccuracyEligiblePlain(plain);
    const ts = new Date(plain.snapshotAt).getTime();
    const w = plain.waitTime ?? plain.currentWaitTimeMin;
    const hasWait = w != null && w !== '' && Number.isFinite(Number(w));

    if (!eligible) {
      if (hasWait) {
        ineligibleWithWait = true;
        const rq = plain.dataQualityReason != null ? String(plain.dataQualityReason).trim() : '';
        if (rq === 'PARK_CLOSED') ineligibleReason = 'PARK_CLOSED';
        else if (rq === 'RIDE_CLOSED' && ineligibleReason !== 'PARK_CLOSED') ineligibleReason = 'RIDE_CLOSED';
      }
      continue;
    }

    if (!hasWait) continue;
    const num = Number(w);
    const d = Math.abs(ts - mid);
    if (d < bestDist) {
      bestDist = d;
      best = num;
    }
  }

  if (best != null) return { actualValue: best, evaluationReason: null };
  if (ineligibleWithWait) {
    return { actualValue: null, evaluationReason: ineligibleReason || 'PARK_CLOSED' };
  }
  return { actualValue: null, evaluationReason: null };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} pr — ml_prediction_results row (plain or Sequelize)
 * @returns {Promise<object|null>} created plain row or null on skip/error
 */
async function evaluatePredictionResultRow(pr) {
  const predictionId = pr.predictionId ?? pr.prediction_id;
  const parkId = pr.parkId ?? pr.park_id;
  const rideId = pr.rideId ?? pr.ride_id;
  const horizonMinutes = pr.horizonMinutes ?? pr.horizon_minutes;
  const targetName = pr.targetName ?? pr.target_name;
  const predictedRaw = pr.predictedValue ?? pr.predicted_value;
  const modelName = pr.modelName ?? pr.model_name;
  const modelVersion = pr.modelVersion ?? pr.model_version;
  const createdAt = pr.createdAt ?? pr.created_at;

  if (!predictionId || !parkId || !rideId || targetName == null || String(targetName).trim() === '') {
    return null;
  }
  const hm = Number(horizonMinutes);
  if (!Number.isFinite(hm) || hm < 0) return null;

  const anchor = new Date(createdAt);
  if (!Number.isFinite(anchor.getTime())) return null;

  const nominalEvalAt = new Date(anchor.getTime() + hm * 60 * 1000);
  if (nominalEvalAt.getTime() > Date.now()) return null;

  const exists = await MlForecastAccuracyLog.findOne({
    where: {
      predictionId: String(predictionId),
      horizonMinutes: hm,
      targetName: String(targetName),
    },
  });
  if (exists) return null;

  let actualValue = null;
  /** @type {string|null} */
  let snapshotEvaluationReason = null;
  try {
    const resolved = await resolveActualWaitFromGovernedSnapshot(String(parkId), String(rideId), nominalEvalAt);
    actualValue = resolved.actualValue;
    snapshotEvaluationReason = resolved.evaluationReason;
  } catch (err) {
    logger.warn({ err, msg: 'ml_forecast_accuracy snapshot lookup failed (UNKNOWN row)' });
  }

  const predictedNum = numOrNull(predictedRaw);
  const metrics = calculateAccuracyMetrics(predictedNum, actualValue);

  /** @type {string|null} */
  let evaluationReason = null;
  if (metrics.accuracyStatus === STATUS.UNKNOWN && actualValue == null && snapshotEvaluationReason) {
    evaluationReason = snapshotEvaluationReason;
  }

  // Do not persist noise: closed park/ride snapshots mark ineligibility explicitly — nothing to benchmark.
  if (
    metrics.accuracyStatus === STATUS.UNKNOWN &&
    actualValue == null &&
    evaluationReason &&
    (evaluationReason === 'PARK_CLOSED' || evaluationReason === 'RIDE_CLOSED')
  ) {
    return null;
  }

  try {
    const row = await MlForecastAccuracyLog.create({
      predictionId: String(predictionId),
      parkId: String(parkId),
      rideId: String(rideId),
      modelName: modelName != null ? String(modelName) : null,
      modelVersion: modelVersion != null ? String(modelVersion) : null,
      targetName: String(targetName),
      horizonMinutes: hm,
      predictedValue: predictedNum != null ? String(predictedNum) : null,
      actualValue: actualValue != null ? String(actualValue) : null,
      absoluteError: metrics.absoluteError != null ? String(metrics.absoluteError) : null,
      percentageError: metrics.percentageError != null ? String(metrics.percentageError) : null,
      squaredError: metrics.squaredError != null ? String(metrics.squaredError) : null,
      bias: metrics.bias != null ? String(metrics.bias) : null,
      accuracyStatus: metrics.accuracyStatus,
      evaluatedAt: nominalEvalAt,
      evaluationReason,
    });
    return row.get({ plain: true });
  } catch (err) {
    logger.warn({ err, msg: 'ml_forecast_accuracy_logs write failed (ignored)' });
    return null;
  }
}

/**
 * Batch-evaluate prediction results whose horizon has elapsed (park-scoped).
 * @param {{ parkId: string, limit?: number }} opts
 * @returns {Promise<{ processed: number, written: number }>}
 */
async function evaluateForecastAccuracy(opts = {}) {
  const parkId = String(opts.parkId || '').trim();
  const lim = Math.min(500, Math.max(1, Number(opts.limit) || 120));
  if (!parkId) return { processed: 0, written: 0 };

  let processed = 0;
  let written = 0;

  try {
    const rows = await sequelize.query(
      `
      SELECT pr.*
      FROM ml_prediction_results pr
      WHERE pr.park_id = :parkId
        AND pr.horizon_minutes IS NOT NULL
        AND pr.ride_id IS NOT NULL
        AND (pr.created_at + (pr.horizon_minutes * INTERVAL '1 minute')) <= NOW()
        AND NOT EXISTS (
          SELECT 1 FROM ml_forecast_accuracy_logs a
          WHERE a.prediction_id = pr.prediction_id
            AND COALESCE(a.horizon_minutes, -1) = COALESCE(pr.horizon_minutes, -1)
            AND a.target_name = pr.target_name
        )
      ORDER BY pr.created_at ASC
      LIMIT :lim
      `,
      {
        replacements: { parkId, lim },
        type: sequelize.QueryTypes.SELECT,
      }
    );

    for (const pr of rows) {
      processed += 1;
      const out = await evaluatePredictionResultRow(pr);
      if (out) written += 1;
    }
  } catch (err) {
    logger.warn({ err, msg: 'evaluateForecastAccuracy failed (ignored)' });
  }

  return { processed, written };
}

/**
 * Evaluate all unevaluated horizons for one prediction id (park-scoped safety via caller).
 * @param {string} traceId — prediction_id
 * @param {{ parkId: string }} opts
 */
async function evaluatePredictionTrace(traceId, opts = {}) {
  const pid = String(traceId || '').trim();
  const parkId = String(opts.parkId || '').trim();
  if (!pid || !parkId) return { processed: 0, written: 0 };

  let processed = 0;
  let written = 0;
  try {
    const results = await MlPredictionResult.findAll({
      where: { predictionId: pid, parkId },
      order: [
        ['horizonMinutes', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
    for (const r of results) {
      const plain = r.get({ plain: true });
      processed += 1;
      const out = await evaluatePredictionResultRow(plain);
      if (out) written += 1;
    }
  } catch (err) {
    logger.warn({ err, msg: 'evaluatePredictionTrace failed (ignored)' });
  }
  return { processed, written };
}

function buildListWhere(filters = {}) {
  const where = {};
  if (filters.parkId) where.parkId = String(filters.parkId);
  if (filters.rideId) where.rideId = String(filters.rideId);
  if (filters.modelName) where.modelName = String(filters.modelName);
  if (filters.targetName) where.targetName = String(filters.targetName);
  if (filters.horizonMinutes != null && filters.horizonMinutes !== '') {
    const h = Number(filters.horizonMinutes);
    if (Number.isFinite(h)) where.horizonMinutes = h;
  }
  if (coerceComparableOnly(filters.comparableOnly)) {
    where.accuracyStatus = { [Op.in]: ['OK', 'WARNING', 'CRITICAL'] };
  }
  if (filters.from || filters.to) {
    where.evaluatedAt = {};
    if (filters.from) where.evaluatedAt[Op.gte] = new Date(filters.from);
    if (filters.to) where.evaluatedAt[Op.lte] = new Date(filters.to);
  }
  return where;
}

/**
 * @param {{ parkId?: string, rideId?: string, modelName?: string, targetName?: string, from?: Date|string, to?: Date|string, horizonMinutes?: number|string, limit?: number, comparableOnly?: boolean|string|number }} filters
 */
async function listAccuracyLogs(filters = {}) {
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 50));
  const rows = await MlForecastAccuracyLog.findAll({
    where: buildListWhere(filters),
    order: [['evaluatedAt', 'DESC']],
    limit,
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * KPI aggregates over filtered logs (numeric metrics exclude UNKNOWN / incomplete rows).
 * @param {{ parkId?: string, rideId?: string, modelName?: string, targetName?: string, from?: Date|string, to?: Date|string, horizonMinutes?: number|string, comparableOnly?: boolean|string|number }} filters
 */
async function getAccuracyKpis(filters = {}) {
  const where = buildListWhere(filters);
  const whereSqlParts = ['1=1'];
  const repl = {};

  if (where.parkId) {
    whereSqlParts.push('park_id = :parkId');
    repl.parkId = where.parkId;
  }
  if (where.rideId) {
    whereSqlParts.push('ride_id = :rideId');
    repl.rideId = where.rideId;
  }
  if (where.modelName) {
    whereSqlParts.push('model_name = :modelName');
    repl.modelName = where.modelName;
  }
  if (where.targetName) {
    whereSqlParts.push('target_name = :targetName');
    repl.targetName = where.targetName;
  }
  if (where.horizonMinutes != null) {
    whereSqlParts.push('horizon_minutes = :horizonMinutes');
    repl.horizonMinutes = where.horizonMinutes;
  }
  if (where.evaluatedAt) {
    if (where.evaluatedAt[Op.gte]) {
      whereSqlParts.push('evaluated_at >= :fromDt');
      repl.fromDt = where.evaluatedAt[Op.gte];
    }
    if (where.evaluatedAt[Op.lte]) {
      whereSqlParts.push('evaluated_at <= :toDt');
      repl.toDt = where.evaluatedAt[Op.lte];
    }
  }
  if (coerceComparableOnly(filters.comparableOnly)) {
    whereSqlParts.push(`accuracy_status IN ('OK','WARNING','CRITICAL')`);
  }

  const whereClause = whereSqlParts.join(' AND ');

  const [agg] = await sequelize.query(
    `
    SELECT
      COUNT(*)::int AS "totalEvaluations",
      SUM(CASE WHEN accuracy_status = 'OK' THEN 1 ELSE 0 END)::int AS "okCount",
      SUM(CASE WHEN accuracy_status = 'WARNING' THEN 1 ELSE 0 END)::int AS "warningCount",
      SUM(CASE WHEN accuracy_status = 'CRITICAL' THEN 1 ELSE 0 END)::int AS "criticalCount",
      SUM(CASE WHEN accuracy_status = 'UNKNOWN' OR accuracy_status IS NULL THEN 1 ELSE 0 END)::int AS "unknownCount",
      SUM(CASE WHEN accuracy_status = 'UNKNOWN' AND evaluation_reason IN ('PARK_CLOSED', 'RIDE_CLOSED') THEN 1 ELSE 0 END)::int AS "closedPeriodUnknownCount",
      AVG(CASE WHEN accuracy_status IN ('OK','WARNING','CRITICAL') THEN absolute_error END)::double precision AS "avgAbsoluteError",
      AVG(CASE WHEN accuracy_status IN ('OK','WARNING','CRITICAL') THEN percentage_error END)::double precision AS "avgPercentageError",
      AVG(CASE WHEN accuracy_status IN ('OK','WARNING','CRITICAL') THEN bias END)::double precision AS "bias",
      AVG(CASE WHEN accuracy_status IN ('OK','WARNING','CRITICAL') THEN squared_error END)::double precision AS "meanSquaredError"
    FROM ml_forecast_accuracy_logs
    WHERE ${whereClause}
    `,
    { replacements: repl, type: sequelize.QueryTypes.SELECT }
  );

  const row = agg || {};
  const mse = row.meanSquaredError != null ? Number(row.meanSquaredError) : null;
  const rmse = mse != null && Number.isFinite(mse) && mse >= 0 ? Math.sqrt(mse) : null;

  return {
    avgAbsoluteError: row.avgAbsoluteError != null ? Number(row.avgAbsoluteError) : null,
    avgPercentageError: row.avgPercentageError != null ? Number(row.avgPercentageError) : null,
    rmse,
    bias: row.bias != null ? Number(row.bias) : null,
    totalEvaluations: Number(row.totalEvaluations) || 0,
    okCount: Number(row.okCount) || 0,
    warningCount: Number(row.warningCount) || 0,
    criticalCount: Number(row.criticalCount) || 0,
    unknownCount: Number(row.unknownCount) || 0,
    closedPeriodUnknownCount: Number(row.closedPeriodUnknownCount) || 0,
  };
}

/**
 * Aggregates win rates per model: how often each modelName was used and avg error.
 * @param {{ parkId?: string, comparableOnly?: boolean|string|number }} filters
 */
async function getModelWinRateStats(filters = {}) {
  const parts = [`accuracy_status IN ('OK','WARNING','CRITICAL')`];
  const repl = {};
  if (filters.parkId) {
    parts.push('park_id = :parkId');
    repl.parkId = String(filters.parkId);
  }
  if (coerceComparableOnly(filters.comparableOnly)) {
    parts.push(`actual_value IS NOT NULL`);
  }
  const whereClause = parts.join(' AND ');
  const rows = await sequelize.query(
    `
    SELECT
      COALESCE(model_name, 'baseline_forecast') AS "modelName",
      COUNT(*)::int AS "evaluations",
      AVG(absolute_error)::double precision AS "avgAbsoluteError",
      AVG(squared_error)::double precision AS "avgSquaredError",
      AVG(bias)::double precision AS "avgBias"
    FROM ml_forecast_accuracy_logs
    WHERE ${whereClause}
    GROUP BY COALESCE(model_name, 'baseline_forecast')
    ORDER BY "evaluations" DESC
    LIMIT 20
    `,
    { replacements: repl, type: sequelize.QueryTypes.SELECT }
  );
  const total = rows.reduce((s, r) => s + (Number(r.evaluations) || 0), 0);
  return rows.map((r) => ({
    modelName: r.modelName,
    evaluations: Number(r.evaluations) || 0,
    winRate: total > 0 ? Math.round(((Number(r.evaluations) || 0) / total) * 1000) / 10 : 0,
    avgAbsoluteError: r.avgAbsoluteError != null ? Math.round(Number(r.avgAbsoluteError) * 100) / 100 : null,
    rmse:
      r.avgSquaredError != null && Number.isFinite(Number(r.avgSquaredError))
        ? Math.round(Math.sqrt(Number(r.avgSquaredError)) * 100) / 100
        : null,
    avgBias: r.avgBias != null ? Math.round(Number(r.avgBias) * 100) / 100 : null,
  }));
}

/**
 * @param {string} id
 * @param {string} parkId
 */
async function getAccuracyLogById(id, parkId) {
  const rid = String(id || '').trim();
  const pk = String(parkId || '').trim();
  if (!rid || !pk) return null;
  const row = await MlForecastAccuracyLog.findOne({
    where: { id: rid, parkId: pk },
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * Retroactive lookback: "What was predicted X minutes ago for NOW?"
 * Finds prediction results created ~horizonMinutes ago that targeted the current time.
 * @param {{ rideId: string, parkId?: string }} filters
 * @returns {Promise<Array<{ horizon: number, predictedAt: string, predictedValue: number, modelName: string }>>}
 */
async function getRetroLookback({ rideId, parkId }) {
  if (!rideId) return [];
  const now = new Date();
  const horizons = [15, 30, 60];
  const results = [];

  for (const h of horizons) {
    const targetTime = new Date(now.getTime() - h * 60 * 1000);
    const windowMs = HALF_WINDOW_MS;
    const from = new Date(targetTime.getTime() - windowMs);
    const to = new Date(targetTime.getTime() + windowMs);
    const where = {
      rideId: String(rideId),
      horizonMinutes: h,
      createdAt: { [Op.between]: [from, to] },
    };
    if (parkId) where.parkId = String(parkId);

    const row = await MlPredictionResult.findOne({
      where,
      order: [['createdAt', 'DESC']],
      attributes: ['predictedValue', 'modelName', 'modelVersion', 'createdAt', 'horizonMinutes'],
    });
    if (row && row.predictedValue != null) {
      results.push({
        horizon: h,
        predictedAt: row.createdAt,
        predictedValue: Math.round(Number(row.predictedValue)),
        modelName: row.modelName || 'baseline',
      });
    }
  }
  return results;
}

module.exports = {
  STATUS,
  HALF_WINDOW_MS,
  coerceComparableOnly,
  calculateAccuracyMetrics,
  resolveActualWaitFromGovernedSnapshot,
  evaluateForecastAccuracy,
  evaluatePredictionTrace,
  evaluatePredictionResultRow,
  listAccuracyLogs,
  getAccuracyKpis,
  getModelWinRateStats,
  getRetroLookback,
  getAccuracyLogById,
};
