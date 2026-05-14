const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { ParkAsset } = require('../models');
const { predictRideWaitTimes } = require('../services/ml/ride-prediction.service');
const {
  buildRidgeRideWaitExplainability,
  finalizeExplainabilityMvpEnvelope,
} = require('../services/ai/prediction-explanation-normalizer.service');
const { trainGlobalModel, trainRideModel } = require('../services/ml/ride-model-training.service');
const { buildRideDataset } = require('../services/ml/ride-dataset.service');
const { getParkBoardMlAggregates } = require('../services/ml/addon-board-ml-bridge.service');

function isExplainRequested(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const x = value.trim().toLowerCase();
    return x === '1' || x === 'true';
  }
  return false;
}

const getPredictRide = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  const q = req.validated || req.query || {};
  const raw = String(q.horizon || '15,30,60')
    .split(',')
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const horizons = raw.length ? raw : [15, 30, 60];

  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideId },
    attributes: ['assetId'],
  });
  if (!asset) {
    throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }

  const data = await predictRideWaitTimes({ parkId, rideId, horizons });
  if (isExplainRequested(q.explain)) {
    const explanation = finalizeExplainabilityMvpEnvelope(buildRidgeRideWaitExplainability(data));
    res.json({ success: true, data: { ...data, explanation } });
    return;
  }
  res.json({ success: true, data });
});

const postTrainGlobalWait = asyncHandler(async (req, res) => {
  const body = req.validated || req.body || {};
  const parkId = req.parkContext.id;
  const data = await trainGlobalModel({
    parkId,
    rowLimit: body.rowLimit,
  });
  res.json({ success: true, data });
});

const postTrainRideWait = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideId },
    attributes: ['assetId'],
  });
  if (!asset) {
    throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  const data = await trainRideModel(rideId, { parkId });
  res.json({ success: true, data });
});

const getParkMlSummary = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const data = await getParkBoardMlAggregates(parkId, {
    zoneId: q.zoneId || null,
    forecastCriticalMinutes: typeof q.criticalAtMinutes === 'number' ? q.criticalAtMinutes : undefined,
    limit: typeof q.limit === 'number' ? q.limit : undefined,
    offset: typeof q.offset === 'number' ? q.offset : undefined,
  });
  res.json({ success: true, data });
});

const getRideDatasetStats = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const data = await buildRideDataset({
    parkId,
    rideId: q.rideId || undefined,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    rowLimit: q.rowLimit ? Number(q.rowLimit) : 6000,
  });
  res.json({
    success: true,
    data: {
      rowCount: data.rowCount,
      horizons: data.horizons,
      stats: data.stats,
      sampleRows: data.sampleRows,
    },
  });
});

module.exports = {
  getPredictRide,
  postTrainGlobalWait,
  postTrainRideWait,
  getParkMlSummary,
  getRideDatasetStats,
};
