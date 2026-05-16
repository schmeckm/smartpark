const { Op } = require('sequelize');
const { MlModelRegistry } = require('../../models');
const { AppError } = require('../../utils/app-error');

const GLOBAL_TYPES = ['GLOBAL_RIDE_MODEL'];
const RIDE_TYPES = ['RIDE_SPECIFIC_MODEL'];

async function deactivateMatching(where) {
  await MlModelRegistry.update({ isActive: false }, { where });
}

/**
 * @param {{ modelType: string, scopeType?: string, scopeId?: string|null, horizonMinutes: number }} sel
 */
async function deactivateForScope(sel) {
  const where = {
    modelType: sel.modelType,
    horizonMinutes: sel.horizonMinutes,
    scopeType: sel.scopeType || 'global',
    isActive: true,
  };
  if (sel.scopeId === null || sel.scopeId === undefined) {
    where.scopeId = { [Op.is]: null };
  } else {
    where.scopeId = String(sel.scopeId);
  }
  await deactivateMatching(where);
}

async function findActiveModel({ modelTypes, scopeType, scopeId, horizonMinutes }) {
  const where = {
    modelType: { [Op.in]: modelTypes },
    scopeType,
    horizonMinutes,
    isActive: true,
    archivedAt: { [Op.is]: null },
  };
  if (scopeId === null || scopeId === undefined) {
    where.scopeId = { [Op.is]: null };
  } else {
    where.scopeId = String(scopeId);
  }
  const row = await MlModelRegistry.findOne({
    where,
    order: [['trainedAt', 'DESC']],
  });
  return row;
}

async function insertModel(entry) {
  return MlModelRegistry.create(entry);
}

/**
 * Load a registry row by `model_id` (auditable id string). Optional trace ensures ride-scoped rows
 * are only returned when they match the trace's ride.
 * @param {string} modelId
 * @param {{ rideId?: string|null }|null} [trace]
 * @returns {Promise<object|null>} plain row or null
 */
async function findModelRegistryRowForTrace(modelId, trace) {
  const mid = String(modelId || '').trim();
  if (!mid) return null;
  const row = await MlModelRegistry.findOne({ where: { modelId: mid, archivedAt: { [Op.is]: null } } });
  if (!row) return null;
  const plain = row.get({ plain: true });
  if (plain.scopeType === 'ride') {
    if (!trace || !trace.rideId || String(plain.scopeId) !== String(trace.rideId)) return null;
  }
  return plain;
}

async function countNonArchivedInScope({ modelType, scopeType, scopeId, horizonMinutes, excludeId }) {
  const where = {
    modelType,
    scopeType,
    horizonMinutes,
    archivedAt: { [Op.is]: null },
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  if (scopeId === null || scopeId === undefined) {
    where.scopeId = { [Op.is]: null };
  } else {
    where.scopeId = String(scopeId);
  }
  return MlModelRegistry.count({ where });
}

/**
 * Soft-archive a registry row (ride/global ridge). Excludes row from runtime resolution.
 * @param {string} id - PK (UUID)
 * @param {string|null} [userId]
 */
async function archiveRegistryEntryByPk(id, userId = null) {
  const row = await MlModelRegistry.findByPk(id);
  if (!row) throw new AppError('Registry model not found', 404, { code: 'NOT_FOUND' });
  const plain = row.get({ plain: true });
  if (plain.archivedAt) return plain;
  if (plain.isActive) {
    throw new AppError('Cannot archive an active registry deployment', 409, { code: 'MODEL_ACTIVE' });
  }
  const remainingOthers = await countNonArchivedInScope({
    modelType: plain.modelType,
    scopeType: plain.scopeType,
    scopeId: plain.scopeId,
    horizonMinutes: plain.horizonMinutes,
    excludeId: plain.id,
  });
  if (remainingOthers === 0) {
    throw new AppError('Cannot archive the last remaining registry version for this scope', 409, {
      code: 'MODEL_LAST_DEPLOYABLE_VERSION',
    });
  }
  await row.update({
    archivedAt: new Date(),
    archivedBy: userId || null,
    isActive: false,
  });
  return row.get({ plain: true });
}

/**
 * Hard-delete after archive. Active or non-archived rows cannot be purged.
 * @param {string} id - PK (UUID)
 */
async function permanentlyDeleteRegistryEntryByPk(id) {
  const row = await MlModelRegistry.findByPk(id);
  if (!row) throw new AppError('Registry model not found', 404, { code: 'NOT_FOUND' });
  const plain = row.get({ plain: true });
  if (!plain.archivedAt) {
    throw new AppError('Only archived registry rows can be permanently deleted. Archive first.', 409, {
      code: 'MODEL_NOT_ARCHIVED',
    });
  }
  if (plain.isActive) {
    throw new AppError('Cannot delete an active registry deployment', 409, { code: 'MODEL_ACTIVE' });
  }
  await row.destroy();
  return { id: plain.id, deleted: true };
}

module.exports = {
  deactivateForScope,
  findActiveModel,
  insertModel,
  findModelRegistryRowForTrace,
  archiveRegistryEntryByPk,
  permanentlyDeleteRegistryEntryByPk,
  countNonArchivedInScope,
  GLOBAL_TYPES,
  RIDE_TYPES,
};
