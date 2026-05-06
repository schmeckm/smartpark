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

module.exports = {
  deactivateForScope,
  findActiveModel,
  insertModel,
  GLOBAL_TYPES,
  RIDE_TYPES,
};
