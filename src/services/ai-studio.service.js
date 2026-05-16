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
const { TRAINING_FEATURE_NAMES } = require('./ml/ride-feature-vector.util');
const {
  FEATURE_STORE_TRAIN_FEATURES,
  buildRideStudioRows,
  mapSnapshotRowToStudioFeatures,
  summarizeRideFeatureStoreRows,
  computeRideFeatureStoreCoverage,
} = require('./ai-studio-dataset.service');
const { buildStudioResolutionExplanation } = require('./ai-studio-runtime-resolution.util');
const { trainWithAlgorithm, predictFeatureStorePayload } = require('./ai-studio-feature-store-ml.util');

function studioSlotKey(p) {
  return `${p.modelScope}|${p.entityType}|${p.entityId ?? ''}|${p.targetVariable}`;
}

function studioGovernanceStatus(row) {
  if (row.archivedAt) return 'ARCHIVED';
  if (row.activeFlag) return 'ACTIVE';
  return 'CANDIDATE';
}

function mapStudioModelRow(plain) {
  if (!plain) return plain;
  const out = { ...plain, governanceStatus: studioGovernanceStatus(plain) };
  if (plain.deploymentStatus != null) out.deploymentStatus = plain.deploymentStatus;
  if (typeof plain.bestMaeInSlot === 'boolean') out.bestMaeInSlot = plain.bestMaeInSlot;
  return out;
}

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

function filterCompleteStudioRows(rows, featureKeys) {
  return rows.filter(
    (r) =>
      r.targetWaitPlusHorizon != null &&
      Number.isFinite(r.targetWaitPlusHorizon) &&
      featureKeys.every((k) => Number.isFinite(r.features[k]))
  );
}

class AiStudioService {
  getCatalog() {
    return {
      entityTypes: ENTITY_TYPES.map((code) => ({
        code,
        targets: TARGETS_BY_ENTITY[code] || [],
        assetTypeCode: ASSET_TYPE_FOR_ENTITY[code] || null,
      })),
      features: [...new Set([...STUDIO_FEATURES, ...TRAINING_FEATURE_NAMES])].map((code) => ({
        code,
        label: code.replace(/_/g, ' '),
      })),
      /** FEATURE_STORE training uses the same feature keys as ride Ridge (`TRAINING_FEATURE_NAMES`). */
      featureStoreTrainFeatures: [...FEATURE_STORE_TRAIN_FEATURES],
      datasets: [
        { code: 'SANDBOX', description: 'Synthetic stub learner (backwards compatible)' },
        { code: 'FEATURE_STORE', description: 'Real rows from ride_feature_snapshots_5m; z-scored supervised training (RIDE, Phase 2)' },
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
      /** Where algorithm choice is enforced: training payload (no post-hoc PATCH). */
      algorithmSupport: {
        SANDBOX: {
          implementationNote:
            'Training uses deterministic stub learners (seeded pseudo-metrics) for algorithm comparison — not production-grade fits.',
          selectableAlgorithms: MANUAL_ALGORITHMS.map((code) => ({
            code,
            label: code.replace(/_/g, ' '),
            implementationKind: 'sandbox_stub',
          })),
          autoStrategySupported: true,
        },
        FEATURE_STORE: {
          implementationNote:
            'Phase 2 trains on ride_feature_snapshots_5m with z-score normalization: ridge linear regression, random forest, gradient boosting (stumps+), or small ReLU MLP — same feature keys as production ride Ridge.',
          selectableAlgorithms: MANUAL_ALGORITHMS.map((code) => ({
            code,
            label: code.replace(/_/g, ' '),
            implementationKind:
              code === 'linear_regression'
                ? 'ridge_ols_trained'
                : code === 'random_forest'
                  ? 'random_forest_js'
                  : code === 'gradient_boosting'
                    ? 'gradient_boosting_js'
                    : 'mlp_relu_js',
          })),
          autoStrategySupported: true,
        },
      },
      /** Productive ML (ride wait) — separate from AI Studio registry. */
      productionMlRuntime: {
        modelStore: 'ml_model_registry',
        algorithmFamily: 'ridge_linear',
        summary:
          'Ride wait production combines active RIDE_SPECIFIC_MODEL and GLOBAL_RIDE_MODEL Ridge payloads per horizon; when both predict, the implementation prefers the lower in-registry MAE (champion) — still from active registry rows only.',
        studioVsProduction:
          'AI Studio models (ai_studio_models) are used only by POST /ai/studio/predict unless separately integrated; they do not replace production registry resolution.',
      },
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
    let featureStoreFeatureCoverage = null;
    let featureStoreCoverageRowsAnalyzed = 0;
    let featureCompleteness = null;
    let featureCompletenessRowsAnalyzed = 0;
    if (opts.dataset === 'FEATURE_STORE' && entityType === 'RIDE' && resolvedEntityId) {
      featureStorePreview = await summarizeRideFeatureStoreRows(parkId, resolvedEntityId, 15);
      const cov = await computeRideFeatureStoreCoverage(parkId, resolvedEntityId, { limit: 8000 });
      featureStoreFeatureCoverage = cov.coverage;
      featureStoreCoverageRowsAnalyzed = cov.rowsAnalyzed;
      // Canonical name for frontend: share of rows with non-null raw X sources / total rows analyzed.
      featureCompleteness = cov.coverage;
      featureCompletenessRowsAnalyzed = cov.rowsAnalyzed;
    }

    /** Rows that matter for the *selected* asset (when entityId resolves). FEATURE_STORE uses ride_feature_snapshots; SANDBOX / heuristics use ride_wait_time_samples or other entity counters. */
    let heuristicRowsSelectedEntity = null;
    if (resolvedEntityId) {
      if (opts.dataset === 'FEATURE_STORE' && entityType === 'RIDE' && featureStorePreview) {
        heuristicRowsSelectedEntity = featureStorePreview.snapshotBucketRows;
      } else {
        heuristicRowsSelectedEntity = entitySampleCount;
      }
    }

    return {
      parkId,
      entityType,
      entityId: entityId || null,
      rowCount,
      parkSnapshotCount: parkSnapCount,
      entitySampleCount,
      heuristicRowsSelectedEntity,
      missingRate,
      seasonalityScore,
      volatilityScore,
      windowDays: 30,
      featureStorePreview,
      featureStoreFeatureCoverage,
      featureStoreCoverageRowsAnalyzed,
      featureCompleteness,
      featureCompletenessRowsAnalyzed,
    };
  }

  /**
   * FEATURE_STORE — per-X share of snapshot rows with raw (non-null) sources before imputation.
   *
   * @param {string[]|null|undefined} featureKeys - optional filter; defaults to all train features
   */
  async validateFeatureStoreFeatures(parkId, entityType, entityId, featureKeys = null) {
    if (entityType !== 'RIDE') {
      throw new AppError('FEATURE_STORE feature validation requires entityType RIDE', 422, {
        code: 'FEATURE_STORE_VALIDATE_SCOPE',
      });
    }
    if (!entityId || String(entityId).trim() === '') {
      throw new AppError('entityId required for feature validation', 422, { code: 'ENTITY_REQUIRED' });
    }
    const resolvedEntityId = await this.lookupCanonicalAssetId(parkId, entityType, entityId);
    const { coverage: fullCoverage, rowsAnalyzed } = await computeRideFeatureStoreCoverage(parkId, resolvedEntityId, {
      limit: 8000,
    });
    const allowed = new Set(FEATURE_STORE_TRAIN_FEATURES);
    const keys =
      Array.isArray(featureKeys) && featureKeys.length
        ? featureKeys.filter((k) => allowed.has(k))
        : [...FEATURE_STORE_TRAIN_FEATURES];
    const featureCoverage = {};
    for (const k of keys) {
      featureCoverage[k] = fullCoverage[k] ?? 0;
    }
    return {
      entityType,
      entityId: resolvedEntityId,
      rowsAnalyzed,
      featureCoverage,
      featureCompleteness: featureCoverage,
      featureCompletenessRowsAnalyzed: rowsAnalyzed,
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
   * Train selected algorithm on snapshot rows; last 20% holdout; deterministic RNG from seed.
   */
  async trainFeatureStoreTrain(parkId, internalAssetId, featureKeys, horizonMinutes, algorithm, rng, trainingOptions) {
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

    const trained = trainWithAlgorithm(
      trainRows,
      holdRows,
      featureKeys,
      algorithm,
      rng,
      horizonMinutes,
      trainingOptions && typeof trainingOptions === 'object' ? trainingOptions : {}
    );
    trained.datasetSnapshotJson.completeRowsTotal = complete.length;
    trained.datasetSnapshotJson.labelDateFrom = complete[0].snapshotAt.toISOString();
    trained.datasetSnapshotJson.labelDateTo = complete[complete.length - 1].snapshotAt.toISOString();
    trained.modelPayload.completeRowsTotal = complete.length;
    return trained;
  }

  async nextVersion(parkId, modelScope, entityType, entityId, targetVariable) {
    const last = await AiStudioModel.findOne({
      where: {
        parkId,
        modelScope,
        entityType,
        entityId: entityId || { [Op.is]: null },
        targetVariable,
        archivedAt: { [Op.is]: null },
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
      featureStoreTrainingOptions = undefined,
      batchTrainId: batchTrainIdRaw = null,
    } = body;

    const batchTrainId =
      batchTrainIdRaw != null && String(batchTrainIdRaw).trim() !== ''
        ? String(batchTrainIdRaw).trim()
        : null;

    if (!ENTITY_TYPES.includes(entityType)) {
      throw new AppError('Invalid entity type', 422, { code: 'INVALID_ENTITY_TYPE' });
    }
    this.assertValidTarget(entityType, targetVariable);

    const ds = String(dataset).toUpperCase();
    if (ds === 'FEATURE_STORE') {
      for (const f of features) {
        if (!FEATURE_STORE_TRAIN_FEATURES.includes(f)) {
          throw new AppError(
            `FEATURE_STORE training does not support feature "${f}". Use only ridge keys: ${FEATURE_STORE_TRAIN_FEATURES.join(', ')}.`,
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
        throw new AppError('FEATURE_STORE supports target wait_time_plus_15 only', 422, {
          code: 'FEATURE_STORE_TARGET',
        });
      }
      const hm = Number(horizonMinutes) || 15;

      let algorithm = manualAlgorithm;
      if (strategy === 'AUTO' || !algorithm) {
        algorithm = this.pickAutoAlgorithm(stats, targetVariable);
      }
      if (!MANUAL_ALGORITHMS.includes(algorithm)) {
        throw new AppError('Invalid algorithm', 422, { code: 'INVALID_ALGORITHM' });
      }

      const version = await this.nextVersion(parkId, modelScope, entityType, entityIdResolved, targetVariable);
      const fsOpts =
        featureStoreTrainingOptions && typeof featureStoreTrainingOptions === 'object'
          ? featureStoreTrainingOptions
          : {};
      const rng = mulberry32(
        hashSeed([
          String(parkId),
          String(entityIdResolved),
          features.slice().sort().join(','),
          String(version),
          algorithm,
          'FEATURE_STORE',
          JSON.stringify(fsOpts),
        ])
      );
      const trained = await this.trainFeatureStoreTrain(
        parkId,
        entityIdResolved,
        features,
        hm,
        algorithm,
        rng,
        fsOpts
      );

      const modelPayload = {
        ...trained.modelPayload,
        ...(batchTrainId ? { batchTrainId } : {}),
      };

      const row = await AiStudioModel.create({
        parkId,
        modelScope,
        entityType,
        entityId: entityIdResolved,
        targetVariable,
        featuresJson: features,
        strategy: strategy === 'AUTO' ? 'AUTO' : 'MANUAL',
        algorithm: trained.modelPayload.algorithm || algorithm,
        version,
        mae: trained.mae,
        rmse: trained.rmse,
        r2: trained.r2,
        lastTrainingAt: new Date(),
        activeFlag: false,
        modelPayload,
        featureImportanceJson: trained.featureImportance,
        evalHoldoutJson: trained.evalHoldout,
        datasetSnapshotJson: { ...stats, ...trained.datasetSnapshotJson },
      });
      return mapStudioModelRow(row.get({ plain: true }));
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

    return mapStudioModelRow(row.get({ plain: true }));
  }

  async listModels(parkId, query = {}) {
    const where = { parkId };
    if (query.entityType) where.entityType = query.entityType;
    if (query.targetVariable) where.targetVariable = query.targetVariable;
    if (query.modelScope) where.modelScope = query.modelScope;
    if (query.activeOnly === true || query.activeOnly === 'true') where.activeFlag = true;
    const includeArchived = query.includeArchived === true || query.includeArchived === 'true';
    if (!includeArchived) {
      where.archivedAt = { [Op.is]: null };
    }

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
    const plains = rows.map((r) => r.get({ plain: true }));
    return this.enrichStudioRowsWithSlotMeta(plains).map((p) => mapStudioModelRow(p));
  }

  /**
   * Per-slot best MAE among non-archived rows; deploymentStatus + bestMaeInSlot for registry transparency.
   */
  enrichStudioRowsWithSlotMeta(plains) {
    const slotToBestId = new Map();
    const bySlot = new Map();
    for (const p of plains) {
      if (p.archivedAt) continue;
      const k = studioSlotKey(p);
      if (!bySlot.has(k)) bySlot.set(k, []);
      bySlot.get(k).push(p);
    }
    for (const [, arr] of bySlot) {
      const withMae = arr.filter((x) => x.mae != null && Number.isFinite(Number(x.mae)));
      if (!withMae.length) continue;
      const best = [...withMae].sort((a, b) => Number(a.mae) - Number(b.mae))[0];
      if (best?.id) slotToBestId.set(studioSlotKey(best), best.id);
    }
    return plains.map((p) => {
      const slot = studioSlotKey(p);
      const enriched = {
        ...p,
        deploymentStatus: p.archivedAt ? 'archived' : p.activeFlag ? 'active_deployment' : 'candidate',
        bestMaeInSlot: !p.archivedAt && slotToBestId.get(slot) === p.id,
      };
      return enriched;
    });
  }

  async getModel(parkId, id) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });
    const plain = row.get({ plain: true });
    const [enriched] = this.enrichStudioRowsWithSlotMeta([plain]);
    return mapStudioModelRow(enriched);
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

  /**
   * Drop AiParkForecastService in-memory resolve cache for this park so ride-grid picks up new active models immediately.
   */
  invalidateParkForecastRideModelCache(parkId) {
    try {
      const { clearStudioRideFsModelResolveCacheForPark } = require('./ai-park-forecast.service');
      clearStudioRideFsModelResolveCacheForPark(parkId);
    } catch {
      /* avoid hard-fail if module graph changes */
    }
  }

  async setActive(parkId, id, activeFlag) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });

    await sequelize.transaction(async (t) => {
      if (activeFlag) {
        await AiStudioModel.update(
          { activeFlag: false },
          {
            where: { ...this.slotWhereClause(row), parkId, archivedAt: { [Op.is]: null } },
            transaction: t,
          }
        );
      }
      await row.update({ activeFlag: !!activeFlag }, { transaction: t });
    });

    return this.getModel(parkId, id);
  }

  async archiveStudioModel(parkId, id, userId = null) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });
    const plain = row.get({ plain: true });
    if (plain.archivedAt) return mapStudioModelRow(plain);
    if (plain.activeFlag) {
      throw new AppError('Cannot archive an active registry model', 409, { code: 'MODEL_ACTIVE' });
    }
    const others = await AiStudioModel.count({
      where: {
        ...this.slotWhereClause(row),
        parkId,
        archivedAt: { [Op.is]: null },
        id: { [Op.ne]: row.id },
      },
    });
    if (others === 0) {
      throw new AppError('Cannot archive the last studio model version for this slot', 409, {
        code: 'MODEL_LAST_DEPLOYABLE_VERSION',
      });
    }
    await row.update({
      archivedAt: new Date(),
      archivedBy: userId || null,
      activeFlag: false,
    });
    return this.getModel(parkId, id);
  }

  async restoreStudioModel(parkId, id, _userId = null) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });
    if (!row.archivedAt) return this.getModel(parkId, id);
    await row.update({ archivedAt: null, archivedBy: null });
    return this.getModel(parkId, id);
  }

  /**
   * Hard-delete a studio row after soft-archive. Keeps governance: active or non-archived rows cannot be purged.
   */
  async permanentlyDeleteStudioModel(parkId, id) {
    const row = await AiStudioModel.findOne({ where: { id, parkId } });
    if (!row) throw new AppError('Model not found', 404, { code: 'NOT_FOUND' });
    const plain = row.get({ plain: true });
    if (!plain.archivedAt) {
      throw new AppError('Only archived models can be permanently deleted. Archive first.', 409, {
        code: 'MODEL_NOT_ARCHIVED',
      });
    }
    if (plain.activeFlag) {
      throw new AppError('Cannot delete an active model', 409, { code: 'MODEL_ACTIVE' });
    }
    await row.destroy();
    return { id: plain.id, deleted: true };
  }

  async findActiveCandidate(parkId, modelScope, entityType, entityId, targetVariable) {
    const where = {
      parkId,
      modelScope,
      entityType,
      targetVariable,
      activeFlag: true,
      archivedAt: { [Op.is]: null },
    };
    if (modelScope === 'entity') {
      where.entityId = entityId;
    } else {
      where.entityId = { [Op.is]: null };
    }
    return AiStudioModel.findOne({ where });
  }

  async findSlotCandidatesForResolution(parkId, modelScope, entityType, entityId, targetVariable) {
    const where = {
      parkId,
      modelScope,
      entityType,
      targetVariable,
      archivedAt: { [Op.is]: null },
    };
    if (modelScope === 'entity') {
      where.entityId = entityId;
    } else {
      where.entityId = { [Op.is]: null };
    }
    const rows = await AiStudioModel.findAll({ where, order: [['version', 'DESC']] });
    return rows.map((r) => r.get({ plain: true }));
  }

  /**
   * Explain which model POST /ai/studio/predict would use (active-only; best MAE is informational).
   */
  async explainRuntimeResolution(parkId, body) {
    const { entityType, entityId = null, targetVariable } = body;
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new AppError('Invalid entity type', 422, { code: 'INVALID_ENTITY_TYPE' });
    }
    this.assertValidTarget(entityType, targetVariable);

    let canonicalEntityId = null;
    if (entityId && entityType !== 'WHOLE_PARK') {
      canonicalEntityId = await this.lookupCanonicalAssetId(parkId, entityType, entityId);
    }

    let entityCandidates = [];
    if (entityType !== 'WHOLE_PARK' && canonicalEntityId) {
      entityCandidates = await this.findSlotCandidatesForResolution(
        parkId,
        'entity',
        entityType,
        canonicalEntityId,
        targetVariable
      );
    }

    let categoryCandidates = [];
    if (entityType !== 'WHOLE_PARK') {
      categoryCandidates = await this.findSlotCandidatesForResolution(
        parkId,
        'category',
        entityType,
        null,
        targetVariable
      );
    }

    const parkCandidates = await this.findSlotCandidatesForResolution(
      parkId,
      'park',
      'WHOLE_PARK',
      null,
      targetVariable
    );

    const explanation = buildStudioResolutionExplanation({
      canonicalEntityId,
      entityType,
      entityCandidates,
      categoryCandidates,
      parkCandidates,
    });

    return {
      parkId,
      entityType,
      entityIdRequested: entityId || null,
      targetVariable,
      canonicalEntityId,
      ...explanation,
    };
  }

  /**
   * SANDBOX: raw feature values. FEATURE_STORE: z-score using payload.normalization.
   */
  predictWithModel(modelRow, featuresInput) {
    const payload = modelRow.modelPayload || {};
    const feats = modelRow.featuresJson || [];

    const fsPayload =
      payload.stub === false &&
      payload.normalization &&
      typeof payload.normalization === 'object' &&
      (payload.dataset === 'FEATURE_STORE' ||
        payload.algorithm === 'random_forest' ||
        payload.algorithm === 'gradient_boosting' ||
        payload.algorithm === 'neural_network' ||
        payload.rf ||
        payload.gbm ||
        payload.mlp ||
        (payload.weights && typeof payload.weights === 'object'));

    if (fsPayload) {
      const featureOrder =
        Array.isArray(payload.featureKeys) && payload.featureKeys.length > 0
          ? payload.featureKeys
          : Array.isArray(feats) && feats.length > 0
            ? feats
            : [];
      if (featureOrder.length > 0) {
        const pv = predictFeatureStorePayload(payload, featuresInput, featureOrder);
        if (pv != null && Number.isFinite(pv)) {
          return Number(Math.max(0, pv).toFixed(4));
        }
      }
    }

    const weights = payload.weights || {};
    const isNormalized =
      payload.stub === false && payload.normalization && typeof payload.normalization === 'object';

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
    const features = mapSnapshotRowToStudioFeatures(rp);
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
