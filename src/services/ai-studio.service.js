const crypto = require('crypto');
const { Op, QueryTypes } = require('sequelize');
const models = require('../models');
const {
  sequelize,
  AiStudioModel,
  ParkFeatureSnapshot,
  RideFeatureSnapshot,
} = models;
const { AssetsRepository } = require('../modules/assets/assets.repository');
const { AppError } = require('../utils/app-error');
const {
  FEATURE_STORE_TRAIN_FEATURES,
  buildRideStudioRows,
  mapSnapshotRowToStudioFeatures,
  summarizeRideFeatureStoreRows,
} = require('./ai-studio-dataset.service');

const STUDIO_FEATURES = [
  'weather',
  'traffic',
  'holiday',
  'school_break',
  'time_of_day',
  'day_of_week',
  'staffing',
  'capacity',
  'historical_demand',
  'neighbor_wait_times',
];

const ENTITY_TYPES = ['RIDE', 'RESTAURANT', 'SHOW', 'PARKING', 'ENTRY_GATE', 'WHOLE_PARK'];

const TARGETS_BY_ENTITY = {
  RIDE: ['wait_time_minutes', 'wait_time_plus_15', 'throughput'],
  RESTAURANT: ['queue_minutes', 'revenue'],
  SHOW: ['occupancy_rate', 'attendance'],
  PARKING: ['occupancy_rate', 'revenue'],
  ENTRY_GATE: ['queue_minutes', 'throughput'],
  WHOLE_PARK: ['crowd_index', 'revenue'],
};

const MANUAL_ALGORITHMS = ['linear_regression', 'random_forest', 'gradient_boosting', 'neural_network'];

const ASSET_TYPE_FOR_ENTITY = {
  RIDE: 'RIDE',
  RESTAURANT: 'RESTAURANT',
  SHOW: 'SHOW',
  PARKING: 'PARKING',
  ENTRY_GATE: 'ENTRANCE',
};

function hashSeed(parts) {
  const h = crypto.createHash('sha256').update(parts.join('|')).digest();
  return h.readUInt32BE(0);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Gaussian elimination (partial pivot) for β in (ZᵀZ + λI)β ≈ Zᵀy — small p only. */
function solveLinearSystemAugmented(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let maxRow = i;
    for (let k = i + 1; k < n; k += 1) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    const piv = M[i][i];
    if (Math.abs(piv) < 1e-14) continue;
    for (let j = i; j <= n; j += 1) M[i][j] /= piv;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const c = M[k][i];
      for (let j = i; j <= n; j += 1) M[k][j] -= c * M[i][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) x[i] = M[i][n];
  return x;
}

/**
 * OLS with ridge on design matrix Z (first column intercept). Returns beta length p+1.
 */
function fitRidgeOLS(Z, y, ridge = 1e-6) {
  const n = Z.length;
  const p1 = Z[0].length;
  const ZtZ = Array.from({ length: p1 }, () => Array(p1).fill(0));
  const Zty = Array(p1).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < p1; j += 1) {
      Zty[j] += Z[i][j] * y[i];
      for (let k = 0; k < p1; k += 1) {
        ZtZ[j][k] += Z[i][j] * Z[i][k];
      }
    }
  }
  for (let i = 0; i < p1; i += 1) ZtZ[i][i] += ridge;
  return solveLinearSystemAugmented(ZtZ, Zty);
}

function buildDesignRow(features, featureKeys, normalization) {
  const zrow = [1];
  for (const k of featureKeys) {
    const raw = features[k];
    const m = normalization[k].mean;
    const s = normalization[k].std;
    zrow.push((raw - m) / s);
  }
  return zrow;
}

function filterCompleteStudioRows(rows, featureKeys) {
  return rows.filter(
    (r) =>
      r.targetWaitPlusHorizon != null &&
      Number.isFinite(r.targetWaitPlusHorizon) &&
      featureKeys.every((k) => Number.isFinite(r.features[k]))
  );
}

function computeZScoreStats(trainRows, featureKeys) {
  const normalization = {};
  for (const k of featureKeys) {
    const vals = trainRows.map((r) => r.features[k]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    let std = Math.sqrt(Math.max(0, variance));
    if (!Number.isFinite(std) || std < 1e-9) std = 1;
    normalization[k] = { mean, std };
  }
  return normalization;
}

function maeRmseR2(actual, predicted) {
  const n = actual.length;
  if (!n) return { mae: null, rmse: null, r2: null };
  let sumAbs = 0;
  let sumSq = 0;
  const meanY = actual.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i += 1) {
    const d = predicted[i] - actual[i];
    sumAbs += Math.abs(d);
    sumSq += d * d;
    ssTot += (actual[i] - meanY) ** 2;
    ssRes += (actual[i] - predicted[i]) ** 2;
  }
  const mae = sumAbs / n;
  const rmse = Math.sqrt(sumSq / n);
  const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : null;
  return {
    mae: Number(mae.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    r2: r2 != null ? Number(r2.toFixed(4)) : null,
  };
}

class AiStudioService {
  getCatalog() {
    return {
      entityTypes: ENTITY_TYPES.map((code) => ({
        code,
        targets: TARGETS_BY_ENTITY[code] || [],
        assetTypeCode: ASSET_TYPE_FOR_ENTITY[code] || null,
      })),
      features: STUDIO_FEATURES.map((code) => ({ code, label: code.replace(/_/g, ' ') })),
      /** Phase 1 FEATURE_STORE uses only these (traffic / neighbor_wait_times not configured on snapshots). */
      featureStoreTrainFeatures: [...FEATURE_STORE_TRAIN_FEATURES],
      datasets: [
        { code: 'SANDBOX', description: 'Synthetic stub learner (backwards compatible)' },
        { code: 'FEATURE_STORE', description: 'Real rows from ride_feature_snapshots_5m (RIDE entity, Phase 1)' },
      ],
      manualAlgorithms: MANUAL_ALGORITHMS.map((code) => ({
        code,
        label: code.replace(/_/g, ' '),
      })),
      hierarchy: [
        { scope: 'entity', description: 'Specific asset (strongest match)' },
        { scope: 'category', description: 'All assets of the entity type in the park' },
        { scope: 'park', description: 'Whole-park aggregate models' },
      ],
      predictionOrder: ['entity', 'category', 'park', 'rules_fallback'],
    };
  }

  assertValidTarget(entityType, targetVariable) {
    const allowed = TARGETS_BY_ENTITY[entityType];
    if (!allowed || !allowed.includes(targetVariable)) {
      throw new AppError(`Target ${targetVariable} not allowed for ${entityType}`, 422, {
        code: 'INVALID_TARGET',
      });
    }
  }

  assertValidFeatures(features) {
    const bad = features.filter((f) => !STUDIO_FEATURES.includes(f));
    if (bad.length) {
      throw new AppError(`Unknown features: ${bad.join(', ')}`, 422, { code: 'INVALID_FEATURES' });
    }
  }

  resolveTrainScope({ entityType, entityId }) {
    if (entityType === 'WHOLE_PARK') {
      return { modelScope: 'park', entityIdResolved: null };
    }
    if (entityId) {
      return { modelScope: 'entity', entityIdResolved: entityId };
    }
    return { modelScope: 'category', entityIdResolved: null };
  }

  async lookupCanonicalAssetId(parkId, entityType, rawId) {
    const code = ASSET_TYPE_FOR_ENTITY[entityType];
    if (!code || rawId == null || String(rawId).trim() === '') return null;
    const rawText = String(rawId).trim();
    const rawLower = rawText.toLowerCase();

    const repo = new AssetsRepository(models);
    const rows = await repo.listAssets({ parkId, assetTypeCode: code, limit: 2000 });
    for (const r of rows) {
      const p = r.get({ plain: true });
      const aid = p.assetId != null ? String(p.assetId).trim() : '';
      const ext = p.externalEntityId != null ? String(p.externalEntityId).trim() : '';
      if (!aid) continue;
      if (ext === rawText || aid === rawText) return aid;
      if (aid.toLowerCase() === rawLower) return aid;
    }
    return null;
  }

  async resolveCanonicalAssetId(parkId, entityType, rawId) {
    const id = await this.lookupCanonicalAssetId(parkId, entityType, rawId);
    if (id) return id;
    const code = ASSET_TYPE_FOR_ENTITY[entityType];
    const rawText = String(rawId).trim();
    throw new AppError(
      `No platform asset matching "${rawText}" in this park for type ${code} (${entityType}). ` +
        'Confirm the header park is the one where the asset was synced. Try the asset dropdown (internal id), ' +
        'or paste the ThemeParks external_entity_id from Master Data. Category scope avoids per-asset ids.',
      404,
      {
        code: 'ENTITY_NOT_FOUND',
        details: { parkId, entityType, expectedAssetTypeCode: code, rawId: rawText },
      }
    );
  }

  /**
   * @param {{ dataset?: string }} [opts]
   */
  async getDatasetStats(parkId, entityType, entityId, opts = {}) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let resolvedEntityId = null;
    if (entityId) {
      resolvedEntityId = await this.lookupCanonicalAssetId(parkId, entityType, entityId);
    }

    const parkSnapCount = await ParkFeatureSnapshot.count({
      where: {
        internalParkId: parkId,
        snapshotAt: { [Op.gte]: thirtyDaysAgo },
      },
    });

    let entitySampleCount = 0;
    const code = ASSET_TYPE_FOR_ENTITY[entityType];
    if (entityType === 'WHOLE_PARK') {
      entitySampleCount = parkSnapCount;
    } else if (code === 'RIDE') {
      const replacements = { parkId, thirtyDaysAgo };
      let sql = `
        SELECT COUNT(*)::int AS c
        FROM ride_wait_time_samples rws
        INNER JOIN park_assets pa ON pa.asset_id = rws.park_asset_id
        INNER JOIN asset_types at ON at.id = pa.asset_type_id
        WHERE pa.park_id = :parkId AND at.code = 'RIDE' AND rws.sampled_at >= :thirtyDaysAgo`;
      if (resolvedEntityId) {
        sql += ' AND pa.asset_id = :entityId';
        replacements.entityId = resolvedEntityId;
      }
      const [rideSampleRows] = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
      entitySampleCount = rideSampleRows[0]?.c ?? 0;
    } else if (code) {
      const replacements = { parkId, thirtyDaysAgo, code };
      let sql = `
        SELECT COUNT(*)::int AS c
        FROM park_assets pa
        INNER JOIN asset_types at ON at.id = pa.asset_type_id
        WHERE pa.park_id = :parkId AND at.code = :code`;
      if (resolvedEntityId) {
        sql += ' AND pa.asset_id = :entityId';
        replacements.entityId = resolvedEntityId;
      }
      const [assetRows] = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
      entitySampleCount = Math.max(50, (assetRows[0]?.c ?? 0) * 120);
    } else {
      entitySampleCount = parkSnapCount;
    }

    const rowCount = Math.max(1, parkSnapCount + entitySampleCount);

    const snaps = await ParkFeatureSnapshot.findAll({
      where: { internalParkId: parkId, snapshotAt: { [Op.gte]: thirtyDaysAgo } },
      attributes: ['avgWait', 'isWeekend'],
      order: [['snapshotAt', 'DESC']],
      limit: 400,
      raw: true,
    });

    let seasonalityScore = 0.45;
    let volatilityScore = 0.45;
    if (snaps.length > 20) {
      const waits = snaps.map((s) => Number(s.avgWait)).filter((x) => Number.isFinite(x) && x >= 0);
      if (waits.length > 10) {
        const mean = waits.reduce((a, b) => a + b, 0) / waits.length;
        const variance = waits.reduce((a, b) => a + (b - mean) ** 2, 0) / waits.length;
        const cv = mean > 1e-6 ? Math.sqrt(variance) / mean : 0;
        volatilityScore = clamp(cv / 1.2, 0.08, 0.95);
      }
      const wk = snaps.filter((s) => s.isWeekend === true).length;
      const ratio = wk / snaps.length;
      seasonalityScore = clamp(Math.abs(ratio - 0.35) * 2.2, 0.12, 0.92);
    }

    const missingRate = clamp(0.22 - Math.log10(rowCount + 10) * 0.04, 0.03, 0.38);

    let featureStorePreview = null;
    if (opts.dataset === 'FEATURE_STORE' && entityType === 'RIDE' && resolvedEntityId) {
      featureStorePreview = await summarizeRideFeatureStoreRows(parkId, resolvedEntityId, 15);
    }

    return {
      parkId,
      entityType,
      entityId: entityId || null,
      rowCount,
      parkSnapshotCount: parkSnapCount,
      entitySampleCount,
      missingRate,
      seasonalityScore,
      volatilityScore,
      windowDays: 30,
      featureStorePreview,
    };
  }

  pickAutoAlgorithm(stats, targetVariable) {
    const rows = stats.rowCount || 0;
    const missing = stats.missingRate || 0.1;
    const seas = stats.seasonalityScore || 0.5;
    const vol = stats.volatilityScore || 0.5;
    const targetIsRate =
      String(targetVariable).includes('rate') || targetVariable === 'occupancy_rate';

    if (rows < 800) return 'linear_regression';
    if (missing > 0.28) return 'random_forest';
    if (seas > 0.72) return 'gradient_boosting';
    if (vol > 0.78) return 'random_forest';
    if (targetIsRate && rows < 6000) return 'random_forest';
    if (rows > 32000) return 'neural_network';
    return 'gradient_boosting';
  }

  buildStubTraining(seedBase, algorithm, features, stats) {
    const rand = mulberry32(hashSeed([String(seedBase), algorithm, ...features.sort()]));
    const baseR2 =
      algorithm === 'linear_regression'
        ? 0.42 + rand() * 0.12
        : algorithm === 'random_forest'
          ? 0.55 + rand() * 0.14
          : algorithm === 'gradient_boosting'
            ? 0.58 + rand() * 0.15
            : 0.52 + rand() * 0.18;

    const r2 = clamp(baseR2 * clamp(1 - stats.missingRate * 0.35, 0.65, 1.05), 0.18, 0.92);
    const scale = 12 + rand() * 28;
    const rmse = scale * (1.15 - r2);
    const mae = rmse * (0.72 + rand() * 0.12);

    const importance = {};
    let sum = 0;
    for (const f of features) {
      const w = rand() + 0.15;
      importance[f] = w;
      sum += w;
    }
    for (const f of Object.keys(importance)) {
      importance[f] = Number((importance[f] / sum).toFixed(4));
    }

    const weights = {};
    for (const f of features) {
      weights[f] = Number(((rand() - 0.45) * (0.8 / Math.sqrt(features.length || 1))).toFixed(6));
    }
    const intercept = Number((8 + rand() * 20).toFixed(4));

    const points = [];
    const n = 48;
    for (let i = 0; i < n; i += 1) {
      const actual = 15 + rand() * 55 + Math.sin(i / 5) * 6;
      const noise = (rand() - 0.5) * rmse * 0.9;
      const predicted = actual + noise;
      points.push({
        i,
        actual: Number(actual.toFixed(2)),
        predicted: Number(predicted.toFixed(2)),
      });
    }

    return {
      mae: Number(mae.toFixed(3)),
      rmse: Number(rmse.toFixed(3)),
      r2: Number(r2.toFixed(4)),
      featureImportance: importance,
      modelPayload: {
        intercept,
        weights,
        stub: true,
        algorithm,
        dataset: 'SANDBOX',
      },
      evalHoldout: { points, holdoutRows: n },
    };
  }

  /**
   * Train z-score linear regression on snapshot rows; last 20% holdout.
   */
  async trainFeatureStoreLinear(parkId, internalAssetId, featureKeys, horizonMinutes) {
    const rawRows = await buildRideStudioRows(parkId, {
      internalAssetId,
      horizonMinutes,
      limit: 8000,
    });
    const complete = filterCompleteStudioRows(rawRows, featureKeys);
    if (complete.length < featureKeys.length + 10) {
      throw new AppError(
        `Not enough complete FEATURE_STORE rows (${complete.length}). Need at least ${featureKeys.length + 10} rows with all selected features and a future wait label.`,
        422,
        { code: 'INSUFFICIENT_FEATURE_STORE_DATA' }
      );
    }

    const splitIdx = Math.floor(complete.length * 0.8);
    if (splitIdx < featureKeys.length + 3 || complete.length - splitIdx < 3) {
      throw new AppError('Not enough rows to split 80/20 for training and holdout', 422, {
        code: 'INSUFFICIENT_SPLIT',
      });
    }

    const trainRows = complete.slice(0, splitIdx);
    const holdRows = complete.slice(splitIdx);

    const normalization = computeZScoreStats(trainRows, featureKeys);
    const Ztrain = trainRows.map((r) => buildDesignRow(r.features, featureKeys, normalization));
    const yTrain = trainRows.map((r) => r.targetWaitPlusHorizon);
    const beta = fitRidgeOLS(Ztrain, yTrain, 1e-6);

    const intercept = beta[0];
    const weights = {};
    for (let j = 0; j < featureKeys.length; j += 1) {
      weights[featureKeys[j]] = beta[j + 1];
    }

    const Zhold = holdRows.map((r) => buildDesignRow(r.features, featureKeys, normalization));
    const yHold = holdRows.map((r) => r.targetWaitPlusHorizon);
    const predHold = Zhold.map((zrow) => zrow.reduce((acc, z, idx) => acc + z * beta[idx], 0));

    const { mae, rmse, r2 } = maeRmseR2(yHold, predHold);

    const absW = featureKeys.map((k) => Math.abs(weights[k] || 0));
    const sumAbs = absW.reduce((a, b) => a + b, 0) || 1;
    const featureImportance = {};
    for (let i = 0; i < featureKeys.length; i += 1) {
      featureImportance[featureKeys[i]] = Number((absW[i] / sumAbs).toFixed(4));
    }

    const points = holdRows.map((r, idx) => ({
      i: idx,
      actual: Number(yHold[idx].toFixed(2)),
      predicted: Number(predHold[idx].toFixed(2)),
    }));

    const t0 = trainRows[0].snapshotAt;
    const t1 = trainRows[trainRows.length - 1].snapshotAt;
    const modelPayload = {
      stub: false,
      algorithm: 'linear_regression',
      dataset: 'FEATURE_STORE',
      horizonMinutes,
      normalization,
      intercept: Number(intercept.toFixed(6)),
      weights,
      featureKeys: [...featureKeys],
      trainingRowsUsed: trainRows.length,
      holdoutRowsUsed: holdRows.length,
      trainDateFrom: t0 instanceof Date ? t0.toISOString() : new Date(t0).toISOString(),
      trainDateTo: t1 instanceof Date ? t1.toISOString() : new Date(t1).toISOString(),
      completeRowsTotal: complete.length,
    };

    return {
      mae,
      rmse,
      r2,
      featureImportance,
      modelPayload,
      evalHoldout: { points, holdoutRows: holdRows.length },
      datasetSnapshotJson: {
        dataset: 'FEATURE_STORE',
        horizonMinutes,
        trainingRowsUsed: trainRows.length,
        holdoutRowsUsed: holdRows.length,
        completeRowsTotal: complete.length,
        trainDateFrom: modelPayload.trainDateFrom,
        trainDateTo: modelPayload.trainDateTo,
        labelDateFrom: complete[0].snapshotAt.toISOString(),
        labelDateTo: complete[complete.length - 1].snapshotAt.toISOString(),
      },
    };
  }

  async nextVersion(parkId, modelScope, entityType, entityId, targetVariable) {
    const last = await AiStudioModel.findOne({
      where: {
        parkId,
        modelScope,
        entityType,
        entityId: entityId || { [Op.is]: null },
        targetVariable,
      },
      order: [['version', 'DESC']],
      attributes: ['version'],
    });
    return (last?.version || 0) + 1;
  }

  async train(parkId, body) {
    const {
      entityType,
      entityId = null,
      targetVariable,
      features,
      strategy = 'MANUAL',
      algorithm: manualAlgorithm = null,
      dataset = 'SANDBOX',
      horizonMinutes = 15,
    } = body;

    if (!ENTITY_TYPES.includes(entityType)) {
      throw new AppError('Invalid entity type', 422, { code: 'INVALID_ENTITY_TYPE' });
    }
    this.assertValidTarget(entityType, targetVariable);

    const ds = String(dataset).toUpperCase();
    if (ds === 'FEATURE_STORE') {
      for (const f of features) {
        if (!FEATURE_STORE_TRAIN_FEATURES.includes(f)) {
          throw new AppError(
            `FEATURE_STORE training does not support feature "${f}". Use only: ${FEATURE_STORE_TRAIN_FEATURES.join(', ')}. (traffic and neighbor_wait_times are not configured.)`,
            422,
            { code: 'INVALID_FEATURES_FOR_FEATURE_STORE' }
          );
        }
      }
    } else {
      this.assertValidFeatures(features);
    }

    let { modelScope, entityIdResolved } = this.resolveTrainScope({ entityType, entityId });
    if (modelScope === 'entity') {
      entityIdResolved = await this.resolveCanonicalAssetId(parkId, entityType, entityIdResolved);
    }

    const stats = await this.getDatasetStats(parkId, entityType, entityIdResolved, { dataset: ds });

    if (ds === 'FEATURE_STORE') {
      if (entityType !== 'RIDE' || modelScope !== 'entity') {
        throw new AppError('FEATURE_STORE training requires RIDE entity scope with a specific asset', 422, {
          code: 'FEATURE_STORE_SCOPE',
        });
      }
      if (targetVariable !== 'wait_time_plus_15') {
        throw new AppError('Phase 1 FEATURE_STORE supports target wait_time_plus_15 only', 422, {
          code: 'FEATURE_STORE_TARGET',
        });
      }
      const hm = 15;
      const trained = await this.trainFeatureStoreLinear(parkId, entityIdResolved, features, hm);

      const version = await this.nextVersion(parkId, modelScope, entityType, entityIdResolved, targetVariable);
      const row = await AiStudioModel.create({
        parkId,
        modelScope,
        entityType,
        entityId: entityIdResolved,
        targetVariable,
        featuresJson: features,
        strategy: 'MANUAL',
        algorithm: 'linear_regression',
        version,
        mae: trained.mae,
        rmse: trained.rmse,
        r2: trained.r2,
        lastTrainingAt: new Date(),
        activeFlag: false,
        modelPayload: trained.modelPayload,
        featureImportanceJson: trained.featureImportance,
        evalHoldoutJson: trained.evalHoldout,
        datasetSnapshotJson: { ...stats, ...trained.datasetSnapshotJson },
      });
      return row.get({ plain: true });
    }

    let algorithm = manualAlgorithm;
    if (strategy === 'AUTO' || !algorithm) {
      algorithm = this.pickAutoAlgorithm(stats, targetVariable);
    }
    if (!MANUAL_ALGORITHMS.includes(algorithm)) {
      throw new AppError('Invalid algorithm', 422, { code: 'INVALID_ALGORITHM' });
    }

    const version = await this.nextVersion(parkId, modelScope, entityType, entityIdResolved, targetVariable);
    const seedBase = `${parkId}-${modelScope}-${entityType}-${entityIdResolved ?? 'all'}-${targetVariable}-v${version}`;
    const stub = this.buildStubTraining(seedBase, algorithm, features, stats);

    const row = await AiStudioModel.create({
      parkId,
      modelScope,
      entityType,
      entityId: entityIdResolved,
      targetVariable,
      featuresJson: features,
      strategy: strategy === 'AUTO' ? 'AUTO' : 'MANUAL',
      algorithm,
      version,
      mae: stub.mae,
      rmse: stub.rmse,
      r2: stub.r2,
      lastTrainingAt: new Date(),
      activeFlag: false,
      modelPayload: stub.modelPayload,
      featureImportanceJson: stub.featureImportance,
      evalHoldoutJson: stub.evalHoldout,
      datasetSnapshotJson: { ...stats, dataset: 'SANDBOX' },
    });

    return row.get({ plain: true });
  }

  async listModels(parkId, query = {}) {
    const where = { parkId };
    if (query.entityType) where.entityType = query.entityType;
    if (query.targetVariable) where.targetVariable = query.targetVariable;
    if (query.modelScope) where.modelScope = query.modelScope;
    if (query.activeOnly === true || query.activeOnly === 'true') where.activeFlag = true;

    const rows = await AiStudioModel.findAll({
      where,
      order: [
        ['targetVariable', 'ASC'],
        ['modelScope', 'ASC'],
        ['entityType', 'ASC'],
        ['version', 'DESC'],
      ],
      limit: Math.min(Number(query.limit) || 200, 500),
    });
    return rows.map((r) => r.get({ plain: true }));
  }

  async getModel(parkId, id) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });
    return row.get({ plain: true });
  }

  slotWhereClause(row) {
    return {
      parkId: row.parkId,
      modelScope: row.modelScope,
      entityType: row.entityType,
      entityId: row.entityId || { [Op.is]: null },
      targetVariable: row.targetVariable,
    };
  }

  async setActive(parkId, id, activeFlag) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });

    await sequelize.transaction(async (t) => {
      if (activeFlag) {
        await AiStudioModel.update(
          { activeFlag: false },
          { where: this.slotWhereClause(row), transaction: t }
        );
      }
      await row.update({ activeFlag: !!activeFlag }, { transaction: t });
    });

    return this.getModel(parkId, id);
  }

  async findActiveCandidate(parkId, modelScope, entityType, entityId, targetVariable) {
    const where = {
      parkId,
      modelScope,
      entityType,
      targetVariable,
      activeFlag: true,
    };
    if (modelScope === 'entity') {
      where.entityId = entityId;
    } else {
      where.entityId = { [Op.is]: null };
    }
    return AiStudioModel.findOne({ where });
  }

  /**
   * SANDBOX: raw feature values. FEATURE_STORE: z-score using payload.normalization.
   */
  predictWithModel(modelRow, featuresInput) {
    const payload = modelRow.modelPayload || {};
    const weights = payload.weights || {};
    const feats = modelRow.featuresJson || [];
    const isNormalized = payload.stub === false && payload.normalization && typeof payload.normalization === 'object';

    let v = Number(payload.intercept) || 0;
    if (isNormalized) {
      const norm = payload.normalization;
      for (const f of feats) {
        const raw = Number(featuresInput[f]);
        if (!Number.isFinite(raw)) continue;
        const meta = norm[f];
        if (!meta || !Number.isFinite(meta.mean)) continue;
        const s = Number.isFinite(meta.std) && meta.std > 1e-12 ? meta.std : 1;
        const z = (raw - meta.mean) / s;
        v += (weights[f] || 0) * z;
      }
    } else {
      for (const f of feats) {
        const x = Number(featuresInput[f]);
        if (Number.isFinite(x)) {
          v += (weights[f] || 0) * x;
        }
      }
    }
    return Number(Math.max(0, v).toFixed(4));
  }

  async resolveLatestSnapshotFeatures(parkId, canonicalAssetId) {
    const rideRow = await RideFeatureSnapshot.findOne({
      where: { internalParkId: parkId, internalAssetId: canonicalAssetId },
      order: [['snapshotAt', 'DESC']],
    });
    if (!rideRow) {
      return { features: null, resolvedSnapshotAt: null, ridePlain: null };
    }
    const rp = rideRow.get({ plain: true });
    const parkRow = await ParkFeatureSnapshot.findOne({
      where: {
        provider: rp.provider,
        externalParkId: rp.externalParkId,
        snapshotAt: rp.snapshotAt,
      },
    });
    const features = mapSnapshotRowToStudioFeatures(rp, parkRow ? parkRow.get({ plain: true }) : null);
    const resolvedSnapshotAt =
      rp.snapshotAt instanceof Date ? rp.snapshotAt.toISOString() : new Date(rp.snapshotAt).toISOString();
    return { features, resolvedSnapshotAt, ridePlain: rp };
  }

  rulesFallback(targetVariable, featuresInput) {
    const hist = Number(featuresInput.historical_demand);
    const cap = Number(featuresInput.capacity);
    const base =
      Number.isFinite(hist) && hist >= 0
        ? hist
        : Number.isFinite(cap) && cap > 0
          ? Math.min(cap * 0.22, 45)
          : 18;
    if (targetVariable === 'occupancy_rate') return clamp(base / 100, 0, 1);
    if (targetVariable === 'crowd_index') return clamp(base * 1.4, 0, 120);
    if (targetVariable === 'revenue') return Math.max(0, base * 120 + 400);
    if (targetVariable === 'wait_time_plus_15') return clamp(base, 0, 240);
    return clamp(base + (Number(featuresInput.weather) || 0) * 0.5, 0, 240);
  }

  async predict(parkId, body) {
    const {
      entityType,
      entityId = null,
      targetVariable,
      features = {},
      featureSource = 'manual',
    } = body;
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new AppError('Invalid entity type', 422, { code: 'INVALID_ENTITY_TYPE' });
    }
    this.assertValidTarget(entityType, targetVariable);

    const fs = String(featureSource).toLowerCase();
    let featuresMerged = { ...features };

    let resolvedSnapshotAt = null;
    let snapshotMeta = null;

    if (fs === 'latest_snapshot') {
      if (entityType !== 'RIDE') {
        throw new AppError('latest_snapshot is only supported for RIDE in Phase 1', 422, {
          code: 'FEATURE_SOURCE_SCOPE',
        });
      }
      const canonicalAssetId = entityId ? await this.lookupCanonicalAssetId(parkId, entityType, entityId) : null;
      if (!canonicalAssetId) {
        throw new AppError('entityId required for latest_snapshot (canonical asset UUID)', 422, {
          code: 'ENTITY_REQUIRED',
        });
      }
      const snap = await this.resolveLatestSnapshotFeatures(parkId, canonicalAssetId);
      resolvedSnapshotAt = snap.resolvedSnapshotAt;
      if (!snap.features) {
        throw new AppError('No ride_feature_snapshots_5m row found for this asset', 404, {
          code: 'SNAPSHOT_NOT_FOUND',
        });
      }
      featuresMerged = { ...snap.features };
      snapshotMeta = {
        provider: snap.ridePlain?.provider ?? null,
        externalParkId: snap.ridePlain?.externalParkId ?? null,
        externalEntityId: snap.ridePlain?.externalEntityId ?? null,
      };
    }

    let used = null;
    let scopeUsed = null;

    let canonicalEntityId = null;
    if (entityId && entityType !== 'WHOLE_PARK') {
      canonicalEntityId = await this.lookupCanonicalAssetId(parkId, entityType, entityId);
    }
    if (canonicalEntityId) {
      used = await this.findActiveCandidate(parkId, 'entity', entityType, canonicalEntityId, targetVariable);
      if (used) scopeUsed = 'entity';
    }

    if (!used && entityType !== 'WHOLE_PARK') {
      used = await this.findActiveCandidate(parkId, 'category', entityType, null, targetVariable);
      if (used) scopeUsed = 'category';
    }

    if (!used) {
      used = await this.findActiveCandidate(parkId, 'park', 'WHOLE_PARK', null, targetVariable);
      if (used) scopeUsed = 'park';
    }

    const baseOut = {
      featureSource: fs === 'latest_snapshot' ? 'latest_snapshot' : 'manual',
      resolvedSnapshotAt,
      snapshotMeta,
    };

    if (used) {
      const plain = used.get({ plain: true });
      const missingForModel = (plain.featuresJson || []).filter((k) => !Number.isFinite(Number(featuresMerged[k])));
      const value = this.predictWithModel(plain, featuresMerged);
      return {
        ...baseOut,
        value,
        fallback: false,
        model: {
          modelId: used.id,
          modelScope: used.modelScope,
          entityType: used.entityType,
          entityId: used.entityId,
          algorithm: used.algorithm,
          version: used.version,
          r2: used.r2,
          mae: used.mae,
          rmse: used.rmse,
          stub: plain.modelPayload?.stub !== false,
          dataset: plain.modelPayload?.dataset || 'SANDBOX',
        },
        resolution: scopeUsed,
        partialFeaturesWarning:
          missingForModel.length && plain.modelPayload?.stub === false
            ? `Missing non-finite inputs for: ${missingForModel.join(', ')}`
            : null,
      };
    }

    const value = this.rulesFallback(targetVariable, featuresMerged);
    return {
      ...baseOut,
      value,
      fallback: true,
      model: null,
      resolution: 'rules_fallback',
    };
  }
}

module.exports = {
  AiStudioService,
  STUDIO_FEATURES,
  ENTITY_TYPES,
  TARGETS_BY_ENTITY,
  MANUAL_ALGORITHMS,
  FEATURE_STORE_TRAIN_FEATURES,
};
