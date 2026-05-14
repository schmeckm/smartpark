'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const {
  evaluateForecastAccuracy,
  listAccuracyLogs,
  getAccuracyKpis,
  getModelWinRateStats,
  getRetroLookback,
  getAccuracyLogById,
} = require('../services/ml/ml-forecast-accuracy.service');

async function tryCatchUpEval(parkId) {
  try {
    await evaluateForecastAccuracy({ parkId, limit: 100 });
  } catch (err) {
    logger.warn({ err, msg: 'forecast-accuracy catch-up eval failed (ignored)' });
  }
}

function queryComparableOnly(q) {
  const v = q.comparableOnly;
  return v === true || v === 1 || v === '1' || v === 'true';
}

const getMlForecastAccuracyLogs = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  await tryCatchUpEval(parkId);
  const rows = await listAccuracyLogs({
    parkId,
    rideId: q.rideId || null,
    modelName: q.modelName || null,
    targetName: q.targetName || null,
    horizonMinutes: q.horizonMinutes != null ? q.horizonMinutes : null,
    from: q.from || null,
    to: q.to || null,
    limit: q.limit,
    comparableOnly: queryComparableOnly(q) || undefined,
  });
  res.json({ success: true, data: rows });
});

const getMlForecastAccuracyKpis = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  await tryCatchUpEval(parkId);
  const kpis = await getAccuracyKpis({
    parkId,
    rideId: q.rideId || null,
    modelName: q.modelName || null,
    targetName: q.targetName || null,
    horizonMinutes: q.horizonMinutes != null ? q.horizonMinutes : null,
    from: q.from || null,
    to: q.to || null,
    comparableOnly: queryComparableOnly(q) || undefined,
  });
  res.json({ success: true, data: kpis });
});

const getMlForecastAccuracyById = asyncHandler(async (req, res) => {
  const { id } = req.validated || req.params;
  const parkId = req.parkContext.id;
  const row = await getAccuracyLogById(id, parkId);
  if (!row) {
    throw new AppError('Forecast accuracy log not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data: row });
});

const getMlModelWinRateStats = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const stats = await getModelWinRateStats({
    parkId,
    comparableOnly: queryComparableOnly(q) || undefined,
  });
  res.json({ success: true, data: stats });
});

const getMlRetroLookback = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const rideId = (req.query || {}).rideId || null;
  if (!rideId) {
    return res.json({ success: true, data: [] });
  }
  const rows = await getRetroLookback({ rideId: String(rideId), parkId });
  res.json({ success: true, data: rows });
});

module.exports = {
  getMlForecastAccuracyLogs,
  getMlForecastAccuracyKpis,
  getMlForecastAccuracyById,
  getMlModelWinRateStats,
  getMlRetroLookback,
};
