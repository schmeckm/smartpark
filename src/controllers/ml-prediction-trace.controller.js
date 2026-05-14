'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const {
  listPredictionTraces,
  listPredictionTraceFilterOptions,
  getPredictionTraceByPredictionId,
  enrichMlPredictionTraceDetail,
  getPredictionTraceCoefficientsReadOnly,
} = require('../services/ml/ml-prediction-trace.service');

const getMlPredictionTraces = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  const rows = await listPredictionTraces({
    parkId,
    rideId: q.rideId || null,
    modelName: q.modelName || null,
    targetName: q.targetName || null,
    from: q.from || null,
    to: q.to || null,
    limit: q.limit,
  });
  res.json({ success: true, data: rows });
});

const getMlPredictionTraceFilterOptions = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await listPredictionTraceFilterOptions(parkId);
  res.json({ success: true, data });
});

const getMlPredictionTraceById = asyncHandler(async (req, res) => {
  const { predictionId } = req.validated || req.params;
  const parkId = req.parkContext.id;
  const { trace, results } = await getPredictionTraceByPredictionId(predictionId);
  if (!trace || String(trace.parkId) !== String(parkId)) {
    throw new AppError('Prediction trace not found', 404, { code: 'NOT_FOUND' });
  }
  const { learnedCoefficients, manualBusinessWeights } = await enrichMlPredictionTraceDetail(trace, results);
  res.json({ success: true, data: { trace, results, learnedCoefficients, manualBusinessWeights } });
});

const getMlPredictionTraceCoefficients = asyncHandler(async (req, res) => {
  const { predictionId } = req.validated || req.params;
  const parkId = req.parkContext.id;
  const out = await getPredictionTraceCoefficientsReadOnly(predictionId, parkId);
  if (!out) {
    throw new AppError('Prediction trace not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data: out.data });
});

module.exports = {
  getMlPredictionTraces,
  getMlPredictionTraceFilterOptions,
  getMlPredictionTraceById,
  getMlPredictionTraceCoefficients,
};
