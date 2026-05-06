/**
 * Ride wait-time prediction: ride-specific ridge → global ridge → baseline.
 */
const { Op } = require('sequelize');
const { Park, ParkAsset, RideFeatureSnapshot } = require('../../models');
const { featureVectorFromMap, snapshotToFeatureMap } = require('./ride-feature-vector.util');
const { predictRidge } = require('./ride-ridge.util');
const { findActiveModel } = require('./ml-model-registry.service');
const { baselineForecastFromSnapshot } = require('./ride-baseline-forecast.service');
const { topFactorsFromImportance } = require('./feature-importance.util');

function clampConfidence(mae) {
  if (mae == null || !Number.isFinite(mae)) return 0.55;
  return Math.max(0.38, Math.min(0.92, 1 - mae / 50));
}

function importanceFromPayload(payload) {
  if (!payload || !payload.weights || !payload.featureNames) return {};
  const names = payload.featureNames;
  const w = payload.weights.slice(1);
  const abs = w.map((v) => Math.abs(v));
  const sum = abs.reduce((a, b) => a + b, 0) || 1;
  const o = {};
  for (let i = 0; i < names.length; i++) o[names[i]] = abs[i] / sum;
  return o;
}

/**
 * @param {string} parkId - internal park UUID (X-Park-Id)
 * @param {string} rideId - park_assets.asset_id
 */
async function loadLatestRideSnapshot(parkId, rideId) {
  const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId: rideId },
    attributes: ['assetId', 'externalEntityId'],
  });
  if (!park || !asset) return null;
  const extPark = park.externalEntityId ? String(park.externalEntityId) : null;
  const extAsset = asset.externalEntityId ? String(asset.externalEntityId) : null;

  const or = [{ internalParkId: parkId, internalAssetId: rideId }];
  if (extPark && extAsset) {
    or.push({ provider: 'themeparks_wiki', externalParkId: extPark, externalEntityId: extAsset });
  }

  const row = await RideFeatureSnapshot.findOne({
    where: { [Op.or]: or },
    order: [['snapshotAt', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * @param {{ parkId: string, rideId: string, horizons?: number[] }} ctx
 */
async function predictRideWaitTimes(ctx) {
  const horizons =
    Array.isArray(ctx.horizons) && ctx.horizons.length ? ctx.horizons.map((h) => Number(h)) : [15, 30, 60];
  const snap = await loadLatestRideSnapshot(ctx.parkId, ctx.rideId);
  const timestamp = new Date().toISOString();

  if (!snap) {
    const cur = { currentWaitTimeMin: 0, waitTime: 0, snapshotAt: timestamp };
    const b = baselineForecastFromSnapshot(cur, { horizons });
    return {
      rideId: ctx.rideId,
      timestamp,
      predictionMode: b.predictionMode,
      modelId: null,
      confidence: b.confidence,
      predictions: b.predictions,
      topFactors: b.topFactors,
      note: 'NO_SNAPSHOT',
    };
  }

  const xVec = featureVectorFromMap(snapshotToFeatureMap(snap));
  const predictions = [];
  let anyBaseline = false;
  let anyRideMl = false;
  let anyGlobalMl = false;
  let modelIdFor60 = null;
  let modelTypeFor60 = null;
  let confidenceAcc = [];
  let topFactors = [];

  for (const h of horizons) {
    let source = 'BASELINE';
    let value;
    const rideRow = await findActiveModel({
      modelTypes: ['RIDE_SPECIFIC_MODEL'],
      scopeType: 'ride',
      scopeId: ctx.rideId,
      horizonMinutes: h,
    });
    const globalRow = await findActiveModel({
      modelTypes: ['GLOBAL_RIDE_MODEL'],
      scopeType: 'global',
      scopeId: null,
      horizonMinutes: h,
    });
    const modelRow = rideRow || globalRow;

    if (modelRow) {
      try {
        const payload = modelRow.modelPayload || {};
        value = predictRidge(payload, xVec);
        value = Math.max(0, Math.min(240, value));
        source = 'ML_MODEL';
        if (modelRow.modelType === 'RIDE_SPECIFIC_MODEL') anyRideMl = true;
        if (modelRow.modelType === 'GLOBAL_RIDE_MODEL') anyGlobalMl = true;
        confidenceAcc.push(clampConfidence(modelRow.metrics?.maeMinutes));
        if (h === 60) {
          modelIdFor60 = modelRow.modelId;
          modelTypeFor60 = modelRow.modelType;
          topFactors = topFactorsFromImportance(importanceFromPayload(payload), 5);
        }
      } catch {
        value = null;
      }
    }

    if (source !== 'ML_MODEL' || value == null || !Number.isFinite(value)) {
      const b = baselineForecastFromSnapshot(snap, { horizons: [h] });
      value = b.predictions[0].value;
      source = 'BASELINE';
      anyBaseline = true;
      if (h === 60 && !topFactors.length) topFactors = b.topFactors;
    }

    predictions.push({
      horizonMinutes: h,
      value: Math.round(Number(value) * 10) / 10,
      unit: 'min',
      source,
    });
  }

  let predictionMode = 'BASELINE_ONLY';
  let modelId = null;
  if (anyRideMl && !anyBaseline) {
    predictionMode = 'RIDE_SPECIFIC_MODEL';
    modelId = modelIdFor60 || (await findActiveModel({
      modelTypes: ['RIDE_SPECIFIC_MODEL'],
      scopeType: 'ride',
      scopeId: ctx.rideId,
      horizonMinutes: 60,
    }))?.modelId;
  } else if (anyGlobalMl && !anyBaseline) {
    predictionMode = 'GLOBAL_RIDE_MODEL';
    modelId =
      modelTypeFor60 === 'GLOBAL_RIDE_MODEL'
        ? modelIdFor60
        : (
            await findActiveModel({
              modelTypes: ['GLOBAL_RIDE_MODEL'],
              scopeType: 'global',
              scopeId: null,
              horizonMinutes: 60,
            })
          )?.modelId;
  } else if (anyRideMl || anyGlobalMl) {
    predictionMode = 'HYBRID_MODEL';
    modelId = modelIdFor60;
  }

  const confidence =
    confidenceAcc.length > 0
      ? Math.round((confidenceAcc.reduce((a, b) => a + b, 0) / confidenceAcc.length) * 100) / 100
      : baselineForecastFromSnapshot(snap, { horizons: [30] }).confidence;

  if (!topFactors.length) {
    topFactors = baselineForecastFromSnapshot(snap, { horizons: [60] }).topFactors;
  }

  return {
    rideId: ctx.rideId,
    timestamp,
    predictionMode,
    modelId: modelId || null,
    confidence,
    predictions,
    topFactors,
  };
}

module.exports = {
  predictRideWaitTimes,
  loadLatestRideSnapshot,
};
