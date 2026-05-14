/**
 * Ride wait-time prediction: ride-specific ridge → global ridge → baseline.
 */
const { Op } = require('sequelize');
const { Park, ParkAsset, RideFeatureSnapshot } = require('../../models');
const {
  featureVectorFromMap,
  snapshotToFeatureMap,
  applyMlFeatureMask,
  TRAINING_FEATURE_NAMES,
} = require('./ride-feature-vector.util');
const { loadExplicitlyDisabledMlFeatureKeys } = require('./ride-ml-feature-mask.service');
const { predictRidge } = require('./ride-ridge.util');
const { findActiveModel } = require('./ml-model-registry.service');
const { baselineForecastFromSnapshot } = require('./ride-baseline-forecast.service');
const { topFactorsFromImportance } = require('./feature-importance.util');
const { scheduleRideWaitMlTrace } = require('./ml-prediction-trace.service');
const { isForecastEligiblePlain } = require('../../utils/ride-snapshot-eligibility.util');

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

  if (snap && !isForecastEligiblePlain(snap)) {
    const dq =
      snap.dataQualityReason != null && String(snap.dataQualityReason).trim() !== ''
        ? String(snap.dataQualityReason).trim()
        : null;
    const reasonCode = dq === 'RIDE_CLOSED' ? 'RIDE_CLOSED' : 'PARK_CLOSED';
    const horizonsBlocked =
      Array.isArray(ctx.horizons) && ctx.horizons.length ? ctx.horizons.map((h) => Number(h)) : [15, 30, 60];
    const syntheticSnap = { ...snap, currentWaitTimeMin: 0, waitTime: 0 };
    const b = baselineForecastFromSnapshot(syntheticSnap, { horizons: horizonsBlocked });
    const predictions = b.predictions.map((p) => ({
      ...p,
      value: 0,
      source: 'BASELINE',
    }));
    const rawClosed = snapshotToFeatureMap(syntheticSnap);
    const maskedClosed = applyMlFeatureMask(rawClosed, new Set());
    const horizonMetaClosed = predictions.map(() => ({
      source: 'BASELINE',
      fallbackUsed: true,
      resultModelName: 'closed_period_forecast',
      resultModelVersion: null,
      reasonCodes: [reasonCode],
    }));
    scheduleRideWaitMlTrace({
      parkId: ctx.parkId,
      rideId: ctx.rideId,
      note: 'FORECAST_INELIGIBLE',
      governedSnapshotQualityReason: dq || reasonCode,
      rawFeatureMap: rawClosed,
      maskedFeatureMap: maskedClosed,
      maskedKeys: new Set(),
      predictions,
      horizonMeta: horizonMetaClosed,
      overallConfidence: null,
      registryModelId: null,
      topFactors: b.topFactors,
    });
    return {
      rideId: ctx.rideId,
      timestamp,
      predictionMode: 'BASELINE_ONLY',
      modelId: null,
      confidence: null,
      predictions,
      topFactors: b.topFactors,
      note: 'FORECAST_INELIGIBLE',
      closedReasonCode: reasonCode,
      snapshotWaitForExplain: 0,
      featureValuesForExplain: maskedClosed,
      mlFeaturesMaskedByCapability: [],
    };
  }

  if (!snap) {
    const cur = { currentWaitTimeMin: 0, waitTime: 0, snapshotAt: timestamp };
    const b = baselineForecastFromSnapshot(cur, { horizons });
    const rawNoSnap = snapshotToFeatureMap(cur);
    const explainNoSnap = applyMlFeatureMask(rawNoSnap, new Set());
    const horizonMetaNoSnap = b.predictions.map(() => ({
      source: 'BASELINE',
      fallbackUsed: true,
      resultModelName: 'baseline_forecast',
      resultModelVersion: null,
    }));
    scheduleRideWaitMlTrace({
      parkId: ctx.parkId,
      rideId: ctx.rideId,
      note: 'NO_SNAPSHOT',
      rawFeatureMap: rawNoSnap,
      maskedFeatureMap: explainNoSnap,
      maskedKeys: new Set(),
      predictions: b.predictions,
      horizonMeta: horizonMetaNoSnap,
      overallConfidence: b.confidence,
      registryModelId: null,
      topFactors: b.topFactors,
    });
    return {
      rideId: ctx.rideId,
      timestamp,
      predictionMode: b.predictionMode,
      modelId: null,
      confidence: b.confidence,
      predictions: b.predictions,
      topFactors: b.topFactors,
      note: 'NO_SNAPSHOT',
      snapshotWaitForExplain: 0,
      featureValuesForExplain: {},
      mlFeaturesMaskedByCapability: [],
    };
  }

  const rawFeatureMap = snapshotToFeatureMap(snap);
  const snapshotWaitForExplain = Number(rawFeatureMap.current_wait_time) || 0;
  const disabledMlKeys = await loadExplicitlyDisabledMlFeatureKeys(ctx.parkId, ctx.rideId);
  const featureValuesForExplain = applyMlFeatureMask(rawFeatureMap, disabledMlKeys);
  const mlFeaturesMaskedByCapability = disabledMlKeys.size
    ? [...disabledMlKeys].filter((k) => TRAINING_FEATURE_NAMES.includes(k)).sort()
    : [];

  const xVec = featureVectorFromMap(featureValuesForExplain);
  const predictions = [];
  const horizonMeta = [];
  let anyBaseline = false;
  let anyRideMl = false;
  let anyGlobalMl = false;
  let modelIdFor60 = null;
  let modelTypeFor60 = null;
  let confidenceAcc = [];
  let topFactors = [];

  for (const h of horizons) {
    let mlModelRow = null;
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

    // Champion/Challenger: run both models and pick the one with lower MAE
    const candidates = [];
    for (const row of [rideRow, globalRow]) {
      if (!row) continue;
      try {
        const payload = row.modelPayload || {};
        const pred = predictRidge(payload, xVec);
        if (pred != null && Number.isFinite(pred)) {
          candidates.push({
            row,
            value: Math.max(0, Math.min(240, pred)),
            mae: Number(row.metrics?.maeMinutes) || Infinity,
            payload,
          });
        }
      } catch { /* skip broken model */ }
    }
    if (candidates.length > 1) {
      candidates.sort((a, b) => a.mae - b.mae);
    }
    const winner = candidates[0] || null;

    if (winner) {
      value = winner.value;
      source = 'ML_MODEL';
      mlModelRow = winner.row;
      if (winner.row.modelType === 'RIDE_SPECIFIC_MODEL') anyRideMl = true;
      if (winner.row.modelType === 'GLOBAL_RIDE_MODEL') anyGlobalMl = true;
      confidenceAcc.push(clampConfidence(winner.mae));
      if (h === 60) {
        modelIdFor60 = winner.row.modelId;
        modelTypeFor60 = winner.row.modelType;
        topFactors = topFactorsFromImportance(importanceFromPayload(winner.payload), 5);
      }
    }

    if (source !== 'ML_MODEL' || value == null || !Number.isFinite(value)) {
      const b = baselineForecastFromSnapshot(snap, { horizons: [h] });
      value = b.predictions[0].value;
      source = 'BASELINE';
      anyBaseline = true;
      if (h === 60 && !topFactors.length) topFactors = b.topFactors;
    }

    const challenger = candidates.length > 1 ? candidates[1] : null;

    predictions.push({
      horizonMinutes: h,
      value: Math.round(Number(value) * 10) / 10,
      unit: 'min',
      source,
      challengerValue: challenger ? Math.round(challenger.value * 10) / 10 : undefined,
      challengerModel: challenger ? challenger.row.modelType : undefined,
    });

    horizonMeta.push({
      source,
      fallbackUsed: source === 'BASELINE',
      resultModelName: source === 'ML_MODEL' && mlModelRow ? mlModelRow.modelId : 'baseline_forecast',
      resultModelVersion:
        source === 'ML_MODEL' && mlModelRow && mlModelRow.trainedAt
          ? new Date(mlModelRow.trainedAt).toISOString()
          : null,
      challengerModelName: challenger ? challenger.row.modelId : null,
      championMae: winner ? winner.mae : null,
      challengerMae: challenger ? challenger.mae : null,
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

  scheduleRideWaitMlTrace({
    parkId: ctx.parkId,
    rideId: ctx.rideId,
    rawFeatureMap,
    maskedFeatureMap: featureValuesForExplain,
    maskedKeys: disabledMlKeys,
    predictions,
    horizonMeta,
    overallConfidence: confidence,
    registryModelId: modelId || null,
    topFactors,
  });

  return {
    rideId: ctx.rideId,
    timestamp,
    predictionMode,
    modelId: modelId || null,
    confidence,
    predictions,
    topFactors,
    snapshotWaitForExplain,
    featureValuesForExplain,
    mlFeaturesMaskedByCapability,
  };
}

module.exports = {
  predictRideWaitTimes,
  loadLatestRideSnapshot,
};
