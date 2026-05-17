/**
 * Phase 3 — park-wide FEATURE_STORE batch training with in-memory progress (single active run per park).
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const models = require('../models');
const { AssetsRepository } = require('../modules/assets/assets.repository');
const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');
const { MANUAL_ALGORITHMS } = require('./ai-studio.service');
const { FEATURE_STORE_TRAIN_FEATURES } = require('./ai-studio-dataset.service');

const { ParkAsset, AiStudioModel, AiStudioBatchJob } = models;

/** @type {Map<string, object>} */
const batchStatusByPark = new Map();

function defaultStatus() {
  return {
    batchId: null,
    total: 0,
    current: 0,
    currentEntityId: '',
    currentEntityLabel: '',
    results: [],
    isRunning: false,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * @param {string} parkId
 * @param {string} entityId
 */
async function loadPreTrainSnapshot(parkId, entityId) {
  const asset = await ParkAsset.findOne({
    where: { assetId: entityId, parkId },
    attributes: ['evaluatedAlgorithm'],
  });
  const plain = asset?.get ? asset.get({ plain: true }) : asset;
  const previousAlgorithm =
    plain?.evaluatedAlgorithm != null && String(plain.evaluatedAlgorithm).trim() !== ''
      ? String(plain.evaluatedAlgorithm).trim()
      : null;

  const rows = await AiStudioModel.findAll({
    where: {
      parkId,
      modelScope: 'entity',
      entityType: 'RIDE',
      entityId,
      targetVariable: 'wait_time_plus_15',
      archivedAt: { [Op.is]: null },
    },
    order: [
      ['activeFlag', 'DESC'],
      ['version', 'DESC'],
    ],
    limit: 40,
    attributes: ['r2', 'algorithm', 'activeFlag', 'modelPayload'],
  });

  let previousR2 = null;
  for (const r of rows) {
    const p = r.get({ plain: true });
    if (p.modelPayload?.dataset !== 'FEATURE_STORE') continue;
    if (p.r2 == null || !Number.isFinite(Number(p.r2))) continue;
    previousR2 = Number(p.r2);
    break;
  }

  return { previousAlgorithm, previousR2 };
}

function statusFromRow(row) {
  if (!row) return { ...defaultStatus() };
  const plain = row.get ? row.get({ plain: true }) : row;
  const isRunning = plain.status === 'running';
  return {
    batchId: plain.batchId ?? null,
    total: plain.total ?? 0,
    current: plain.current ?? 0,
    currentEntityId: plain.currentEntityId || '',
    currentEntityLabel: plain.currentEntityLabel || '',
    results: Array.isArray(plain.resultsJson) ? [...plain.resultsJson] : [],
    isRunning,
    error: plain.error ?? null,
    startedAt: plain.startedAt ?? null,
    finishedAt: plain.finishedAt ?? null,
  };
}

async function loadLatestBatchJob(parkId) {
  return AiStudioBatchJob.findOne({
    where: { parkId: String(parkId) },
    order: [['startedAt', 'DESC']],
  });
}

async function persistBatchJob(parkId, status) {
  const key = String(parkId);
  const batchId = status.batchId;
  if (!batchId) return;

  const payload = {
    parkId: key,
    batchId,
    status: status.isRunning ? 'running' : status.error ? 'failed' : 'completed',
    total: status.total,
    current: status.current,
    currentEntityId: status.currentEntityId || null,
    currentEntityLabel: status.currentEntityLabel || null,
    resultsJson: status.results || [],
    error: status.error ?? null,
    startedAt: status.startedAt ? new Date(status.startedAt) : new Date(),
    finishedAt: status.finishedAt ? new Date(status.finishedAt) : null,
  };

  const existing = await AiStudioBatchJob.findOne({ where: { parkId: key, batchId } });
  if (existing) {
    await existing.update(payload);
  } else {
    await AiStudioBatchJob.create(payload);
  }
}

async function getBatchTrainStatus(parkId) {
  const key = String(parkId);
  const mem = batchStatusByPark.get(key);
  if (mem) {
    return {
      batchId: mem.batchId ?? null,
      total: mem.total,
      current: mem.current,
      currentEntityId: mem.currentEntityId,
      currentEntityLabel: mem.currentEntityLabel || '',
      results: Array.isArray(mem.results) ? [...mem.results] : [],
      isRunning: Boolean(mem.isRunning),
      error: mem.error ?? null,
      startedAt: mem.startedAt ?? null,
      finishedAt: mem.finishedAt ?? null,
    };
  }
  const row = await loadLatestBatchJob(key);
  return statusFromRow(row);
}

/**
 * @param {string} parkId
 * @param {string} batchId
 * @param {import('./ai-studio.service').AiStudioService} studioService
 */
async function applyParkRideBatchAlgorithms(parkId, batchId, studioService) {
  const key = String(parkId);
  const want = String(batchId || '').trim();
  if (!want) {
    throw new AppError('batchId is required', 422, { code: 'BATCH_ID_REQUIRED' });
  }
  if (!studioService || typeof studioService.setActive !== 'function') {
    throw new AppError('studioService is required', 500, { code: 'INTERNAL' });
  }

  let s = batchStatusByPark.get(key);
  if (!s) {
    const row = await loadLatestBatchJob(key);
    s = row ? statusFromRow(row) : null;
    if (s && s.batchId) batchStatusByPark.set(key, { ...s, results: [...(s.results || [])] });
  }
  if (!s) {
    throw new AppError('No batch status for this park', 404, { code: 'BATCH_NOT_FOUND' });
  }
  if (s.isRunning) {
    throw new AppError('Batch training still in progress', 409, { code: 'BATCH_IN_PROGRESS' });
  }
  if (!s.batchId || s.batchId !== want) {
    throw new AppError('batchId does not match the last completed batch', 404, { code: 'BATCH_MISMATCH' });
  }

  const okRows = (s.results || []).filter((r) => r.ok && r.algorithm && MANUAL_ALGORITHMS.includes(String(r.algorithm)));
  if (!okRows.length) {
    throw new AppError('No successful training rows with a valid algorithm to apply', 422, {
      code: 'BATCH_NOTHING_TO_APPLY',
    });
  }

  let updated = 0;
  let modelsActivated = 0;
  let modelsActivateSkipped = 0;

  for (const r of okRows) {
    const algo = String(r.algorithm).trim();
    // eslint-disable-next-line no-await-in-loop
    const [n] = await ParkAsset.update(
      { evaluatedAlgorithm: algo },
      { where: { assetId: r.entityId, parkId: key } }
    );
    updated += n;

    const modelId = r.modelId != null ? String(r.modelId).trim() : '';
    if (!modelId) {
      modelsActivateSkipped += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const mRow = await AiStudioModel.findOne({
      where: {
        id: modelId,
        parkId: key,
        entityId: r.entityId,
        modelScope: 'entity',
        entityType: 'RIDE',
        targetVariable: 'wait_time_plus_15',
        archivedAt: { [Op.is]: null },
      },
    });
    if (!mRow) {
      modelsActivateSkipped += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    const plain = mRow.get({ plain: true });
    const payload = plain.modelPayload && typeof plain.modelPayload === 'object' ? plain.modelPayload : {};
    if (String(payload.dataset || '').toUpperCase() !== 'FEATURE_STORE') {
      modelsActivateSkipped += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    if (String(payload.batchTrainId || '') !== want) {
      modelsActivateSkipped += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await studioService.setActive(key, modelId, true);
      modelsActivated += 1;
    } catch (err) {
      logger.warn(
        { err: err?.message, parkId: key, modelId, entityId: r.entityId },
        'batch_apply.model_activate_failed'
      );
      modelsActivateSkipped += 1;
    }
  }

  studioService.invalidateParkForecastRideModelCache(key);

  batchStatusByPark.delete(key);
  return { updated, applied: okRows.length, modelsActivated, modelsActivateSkipped };
}

/**
 * @param {string} parkId
 * @param {import('./ai-studio.service').AiStudioService} studioService
 * @param {object} options
 * @param {'AUTO'|'MANUAL'} [options.strategy]
 * @param {string|null} [options.algorithm]
 * @param {string[]} [options.features]
 * @param {object} [options.featureStoreTrainingOptions]
 */
async function startParkRideBatchTrain(parkId, studioService, options = {}) {
  const key = String(parkId);
  const existing = batchStatusByPark.get(key);
  if (existing?.isRunning) {
    throw new AppError('Batch training already in progress for this park', 409, {
      code: 'BATCH_IN_PROGRESS',
    });
  }

  const repo = new AssetsRepository(models);
  const rideRows = await repo.listAssets({ parkId, assetTypeCode: 'RIDE', limit: 2000 });
  const assets = rideRows
    .map((r) => {
      const p = r.get({ plain: true });
      const id = p.assetId != null ? String(p.assetId).trim() : '';
      if (!id) return null;
      const label = String(p.name || p.shortName || p.short_name || id).slice(0, 160);
      return { entityId: id, label };
    })
    .filter(Boolean);

  const strategy = options.strategy === 'MANUAL' ? 'MANUAL' : 'AUTO';
  const algorithm =
    options.algorithm != null && String(options.algorithm).trim() !== ''
      ? String(options.algorithm).trim()
      : null;
  if (strategy === 'MANUAL') {
    if (!algorithm || !MANUAL_ALGORITHMS.includes(algorithm)) {
      throw new AppError('MANUAL batch training requires a valid algorithm', 422, {
        code: 'BATCH_ALGORITHM_REQUIRED',
      });
    }
  }

  let features =
    Array.isArray(options.features) && options.features.length > 0 ? options.features : null;
  if (features) {
    const allow = new Set(FEATURE_STORE_TRAIN_FEATURES);
    features = features.filter((f) => allow.has(f));
    if (!features.length) {
      throw new AppError('No valid FEATURE_STORE features in request', 422, { code: 'BATCH_FEATURES_INVALID' });
    }
  } else {
    features = [...FEATURE_STORE_TRAIN_FEATURES];
  }

  const featureStoreTrainingOptions =
    options.featureStoreTrainingOptions && typeof options.featureStoreTrainingOptions === 'object'
      ? options.featureStoreTrainingOptions
      : undefined;

  if (!assets.length) {
    const idle = { ...defaultStatus(), finishedAt: new Date().toISOString() };
    batchStatusByPark.set(key, idle);
    return { accepted: true, total: 0, message: 'NO_RIDES' };
  }

  const batchId = crypto.randomUUID();
  const status = {
    batchId,
    total: assets.length,
    current: 0,
    currentEntityId: '',
    currentEntityLabel: '',
    results: [],
    isRunning: true,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  batchStatusByPark.set(key, status);
  await persistBatchJob(key, status);

  const trainOpts = { strategy, algorithm, features, featureStoreTrainingOptions };

  setImmediate(() => {
    void runBatchLoop(key, studioService, assets, trainOpts).catch(async (e) => {
      const st = batchStatusByPark.get(key);
      if (st) {
        st.isRunning = false;
        st.error = e.message || String(e);
        st.finishedAt = new Date().toISOString();
        st.currentEntityId = '';
        st.currentEntityLabel = '';
        await persistBatchJob(key, st);
      }
    });
  });

  return { accepted: true, total: assets.length, batchId };
}

/**
 * @param {string} parkKey
 * @param {import('./ai-studio.service').AiStudioService} studioService
 * @param {{ entityId: string, label: string }[]} assets
 * @param {{ strategy: string, algorithm: string|null, features: string[], featureStoreTrainingOptions?: object }} trainOpts
 */
async function runBatchLoop(parkKey, studioService, assets, trainOpts) {
  const status = batchStatusByPark.get(parkKey);
  if (!status) return;

  try {
    for (let i = 0; i < assets.length; i += 1) {
      const { entityId, label } = assets[i];
      status.currentEntityId = entityId;
      status.currentEntityLabel = label;

      // eslint-disable-next-line no-await-in-loop
      const snap = await loadPreTrainSnapshot(parkKey, entityId);

      try {
        // eslint-disable-next-line no-await-in-loop
        const row = await studioService.train(parkKey, {
          dataset: 'FEATURE_STORE',
          entityType: 'RIDE',
          entityId,
          targetVariable: 'wait_time_plus_15',
          features: trainOpts.features,
          strategy: trainOpts.strategy,
          algorithm: trainOpts.strategy === 'AUTO' ? null : trainOpts.algorithm,
          horizonMinutes: 15,
          featureStoreTrainingOptions: trainOpts.featureStoreTrainingOptions,
          batchTrainId: status.batchId,
        });
        status.results.push({
          entityId,
          assetLabel: label,
          ok: true,
          modelId: row.id,
          mae: row.mae,
          rmse: row.rmse,
          r2: row.r2,
          version: row.version,
          algorithm: row.algorithm,
          previousAlgorithm: snap.previousAlgorithm,
          previousR2: snap.previousR2,
        });
      } catch (err) {
        status.results.push({
          entityId,
          assetLabel: label,
          ok: false,
          error: err.message || String(err),
          code: err.details?.code || err.code || null,
          previousAlgorithm: snap.previousAlgorithm,
          previousR2: snap.previousR2,
        });
      }

      status.current = i + 1;
      // eslint-disable-next-line no-await-in-loop
      await persistBatchJob(parkKey, status);
    }
  } finally {
    status.isRunning = false;
    status.currentEntityId = '';
    status.currentEntityLabel = '';
    status.finishedAt = new Date().toISOString();
    await persistBatchJob(parkKey, status);
  }
}

module.exports = {
  getBatchTrainStatus,
  startParkRideBatchTrain,
  applyParkRideBatchAlgorithms,
};
