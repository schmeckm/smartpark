const { Op } = require('sequelize');
const { MlModelRegistry } = require('../../models');

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
  const row = await MlModelRegistry.findOne({ where: { modelId: mid } });
  if (!row) return null;
  const plain = row.get({ plain: true });
  if (plain.scopeType === 'ride') {
    if (!trace || !trace.rideId || String(plain.scopeId) !== String(trace.rideId)) return null;
  }
  return plain;
}

module.exports = {
  deactivateForScope,
  findActiveModel,
  insertModel,
  findModelRegistryRowForTrace,
  GLOBAL_TYPES,
  RIDE_TYPES,
};
