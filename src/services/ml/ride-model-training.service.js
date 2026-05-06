/**
 * Train ridge wait-time models and persist to ml_model_registry.
 */
const { ParkAsset } = require('../../models');
const { buildRideDataset } = require('./ride-dataset.service');
const { TRAINING_FEATURE_NAMES, featureVectorFromMap } = require('./ride-feature-vector.util');
const { fitRidge, predictRidge, maeRmse, featureImportanceFromWeights } = require('./ride-ridge.util');
const { deactivateForScope, insertModel, findActiveModel } = require('./ml-model-registry.service');
const { topFactorsFromImportance } = require('./feature-importance.util');

const MIN_GLOBAL_ROWS = 80;
const MIN_RIDE_ROWS = 5000;
const MIN_RIDE_COVERAGE_DAYS = 30;
const MIN_RIDE_TARGET_ROWS = 400;

function splitTrainVal(X, y, trainRatio = 0.8) {
  const n = X.length;
  const split = Math.max(10, Math.floor(n * trainRatio));
  return {
    Xtr: X.slice(0, split),
    ytr: y.slice(0, split),
    Xva: X.slice(split),
    yva: y.slice(split),
  };
}

async function trainGlobalModel(opts = {}) {
  const horizons = opts.horizons || [15, 30, 60];
  const ds = await buildRideDataset({
    parkId: opts.parkId,
    rideId: opts.rideId,
    from: opts.from,
    to: opts.to,
    horizons,
    rowLimit: opts.rowLimit || 15000,
  });

  const result = { horizons: {}, errors: [] };

  for (const h of horizons) {
    const key = `wait_time_${h}`;
    const X = [];
    const y = [];
    for (const r of ds.rows) {
      const t = r.targets[key];
      if (t == null || !Number.isFinite(Number(t))) continue;
      X.push(featureVectorFromMap(r.features));
      y.push(Number(t));
    }
    if (X.length < MIN_GLOBAL_ROWS) {
      result.errors.push({ horizonMinutes: h, code: 'INSUFFICIENT_ROWS', rowCount: X.length });
      continue;
    }
    const { Xtr, ytr, Xva, yva } = splitTrainVal(X, y, opts.trainRatio ?? 0.8);
    try {
      const fit = fitRidge(Xtr, ytr, opts.lambda ?? 2);
      const predVa = Xva.map((row) => predictRidge(fit, row));
      const { mae, rmse } = maeRmse(yva, predVa);
      const importance = featureImportanceFromWeights(fit, TRAINING_FEATURE_NAMES);
      const modelId = `global_ride_wait_time_${h}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
      await deactivateForScope({
        modelType: 'GLOBAL_RIDE_MODEL',
        scopeType: 'global',
        scopeId: null,
        horizonMinutes: h,
      });
      const payload = { kind: 'ridge_v1', featureNames: TRAINING_FEATURE_NAMES, ...fit };
      await insertModel({
        modelId,
        modelType: 'GLOBAL_RIDE_MODEL',
        scopeType: 'global',
        scopeId: null,
        target: key,
        horizonMinutes: h,
        featureList: TRAINING_FEATURE_NAMES,
        modelPayload: payload,
        metrics: { maeMinutes: mae, rmseMinutes: rmse, validationRows: yva.length },
        trainingRows: ytr.length,
        trainedAt: new Date(),
        isActive: true,
      });
      result.horizons[h] = {
        modelId,
        maeMinutes: mae,
        rmseMinutes: rmse,
        trainingRows: ytr.length,
        topFactors: topFactorsFromImportance(importance, 5),
      };
    } catch (e) {
      result.errors.push({ horizonMinutes: h, code: 'TRAIN_FAILED', message: e.message });
    }
  }
  return result;
}

function coverageDaysFromRows(rows) {
  if (!rows.length) return 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const r of rows) {
    const t = new Date(r.timestamp).getTime();
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  return (maxT - minT) / (24 * 60 * 60 * 1000);
}

/**
 * @param {string} rideId - park_assets.asset_id (UUID)
 * @param {{ parkId?: string, from?: Date, to?: Date }} [opts]
 */
async function trainRideModel(rideId, opts = {}) {
  let parkId = opts.parkId;
  if (!parkId) {
    const asset = await ParkAsset.findOne({ where: { assetId: rideId }, attributes: ['parkId'] });
    parkId = asset?.parkId ? String(asset.parkId) : null;
  }
  if (!parkId) {
    return { trained: false, reason: 'ASSET_NOT_FOUND', rideId };
  }

  const horizons = opts.horizons || [15, 30, 60];
  const ds = await buildRideDataset({
    parkId,
    rideId,
    from: opts.from,
    to: opts.to,
    horizons,
    rowLimit: opts.rowLimit || 25000,
  });

  if (ds.rowCount < MIN_RIDE_ROWS) {
    return { trained: false, reason: 'NOT_ENOUGH_ROWS', rowCount: ds.rowCount, minRequired: MIN_RIDE_ROWS };
  }
  const coverageDays = coverageDaysFromRows(ds.rows);
  if (coverageDays < MIN_RIDE_COVERAGE_DAYS) {
    return {
      trained: false,
      reason: 'INSUFFICIENT_COVERAGE_DAYS',
      coverageDays: Math.round(coverageDays * 10) / 10,
      minRequired: MIN_RIDE_COVERAGE_DAYS,
    };
  }

  const key60 = 'wait_time_60';
  const rows60 = ds.rows.filter((r) => r.targets[key60] != null && Number.isFinite(Number(r.targets[key60])));
  const validTargetRate = ds.rowCount ? rows60.length / ds.rowCount : 0;
  if (validTargetRate < 0.8) {
    return { trained: false, reason: 'LOW_VALID_TARGET_RATE', validTargetRate };
  }

  let globalMae60 = null;
  const globalRow = await findActiveModel({
    modelTypes: ['GLOBAL_RIDE_MODEL'],
    scopeType: 'global',
    scopeId: null,
    horizonMinutes: 60,
  });
  if (globalRow?.metrics?.maeMinutes != null) {
    globalMae60 = Number(globalRow.metrics.maeMinutes);
  }

  const out = { trained: true, horizons: {}, skippedComparison: globalMae60 == null, rideId };

  for (const h of horizons) {
    const key = `wait_time_${h}`;
    const X = [];
    const y = [];
    for (const r of ds.rows) {
      const t = r.targets[key];
      if (t == null || !Number.isFinite(Number(t))) continue;
      X.push(featureVectorFromMap(r.features));
      y.push(Number(t));
    }
    if (X.length < MIN_RIDE_TARGET_ROWS) {
      out.horizons[h] = { skipped: true, reason: 'INSUFFICIENT_TARGET_ROWS', rowCount: X.length };
      continue;
    }
    const { Xtr, ytr, Xva, yva } = splitTrainVal(X, y, opts.trainRatio ?? 0.8);
    const fit = fitRidge(Xtr, ytr, opts.lambda ?? 2);
    const predVa = Xva.map((row) => predictRidge(fit, row));
    const { mae } = maeRmse(yva, predVa);

    if (h === 60 && globalMae60 != null && mae > globalMae60 * 0.9) {
      return {
        trained: false,
        reason: 'RIDE_MODEL_NOT_BETTER_THAN_GLOBAL',
        rideMaeMinutes: mae,
        globalMaeMinutes: globalMae60,
      };
    }

    const importance = featureImportanceFromWeights(fit, TRAINING_FEATURE_NAMES);
    const modelId = `ride_${rideId}_wait_${h}_${Date.now()}`;
    await deactivateForScope({
      modelType: 'RIDE_SPECIFIC_MODEL',
      scopeType: 'ride',
      scopeId: rideId,
      horizonMinutes: h,
    });
    await insertModel({
      modelId,
      modelType: 'RIDE_SPECIFIC_MODEL',
      scopeType: 'ride',
      scopeId: String(rideId),
      target: key,
      horizonMinutes: h,
      featureList: TRAINING_FEATURE_NAMES,
      modelPayload: { kind: 'ridge_v1', featureNames: TRAINING_FEATURE_NAMES, ...fit },
      metrics: { maeMinutes: mae, validationRows: yva.length },
      trainingRows: ytr.length,
      trainedAt: new Date(),
      isActive: true,
    });
    out.horizons[h] = { modelId, maeMinutes: mae, trainingRows: ytr.length };
  }

  return out;
}

module.exports = {
  trainGlobalModel,
  trainRideModel,
  MIN_GLOBAL_ROWS,
  MIN_RIDE_ROWS,
  MIN_RIDE_COVERAGE_DAYS,
};
