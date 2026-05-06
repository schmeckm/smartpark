/**
 * Effective L3 ML profile per asset (assignment + overrides + legacy fallback).
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op } = require('sequelize');
const {
  ParkAsset,
  AssetType,
  MlProfile,
  AssetMlProfileAssignment,
  AssetMlOverride,
} = require('../models');

const DEFAULT_PROFILE_CODE = {
  RIDE: 'FAMILY_RIDE',
  SHOW: 'INDOOR_THEATER_SHOW',
  RESTAURANT: 'QUICK_SERVICE_RESTAURANT',
  SHOP: 'STANDARD_RETAIL_SHOP',
};

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} assetId UUID
 */
async function resolveAssignedProfile(assetId) {
  if (!assetId) return null;
  const today = todayDateOnly();
  return AssetMlProfileAssignment.findOne({
    where: {
      assetId,
      activeFlag: true,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: today } }] },
        { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
      ],
    },
    include: [{ model: MlProfile, as: 'mlProfile', where: { activeFlag: true }, required: true }],
    order: [['updatedAt', 'DESC']],
  });
}

/**
 * @param {string} assetId
 */
async function resolveDefaultProfileForAsset(assetId) {
  const asset = await ParkAsset.findByPk(assetId, {
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], required: false }],
  });
  if (!asset) return null;
  const typeCode = (asset.assetType && asset.assetType.code) || 'RIDE';
  const profileCode = DEFAULT_PROFILE_CODE[typeCode] || DEFAULT_PROFILE_CODE.RIDE;
  return MlProfile.findOne({ where: { profileCode, activeFlag: true } });
}

/**
 * @param {string} assetId
 */
async function resolveEffectiveMlConfig(assetId) {
  const warnings = [];
  const assignment = await resolveAssignedProfile(assetId);
  let profile = assignment?.mlProfile || null;
  let source = 'ASSIGNMENT';
  if (!profile) {
    profile = await resolveDefaultProfileForAsset(assetId);
    source = 'DEFAULT_ENTITY_TYPE';
    if (!profile) warnings.push('No ML profile and no default profile row');
  }
  const overrides = await AssetMlOverride.findAll({
    where: { assetId, activeFlag: true },
  });
  const overrideMap = {};
  for (const o of overrides) {
    overrideMap[o.overrideKey] = o.overrideValueJson;
    if (!o.overrideReason || String(o.overrideReason).trim() === '') {
      warnings.push(`Override "${o.overrideKey}" has no reason`);
    }
  }
  const flatProfile = profile ? profile.get({ plain: true }) : {};
  return {
    assetId,
    source,
    assignmentId: assignment?.id || null,
    profile: flatProfile,
    profileCode: flatProfile.profileCode || flatProfile.profile_code || null,
    overrides: overrideMap,
    warnings,
  };
}

/**
 * @param {string[]} assetIds
 * @returns {Promise<Map<string, string|null>>} assetId -> profile_code
 */
async function loadActiveProfileCodesByAssetIds(assetIds) {
  const map = new Map();
  if (!assetIds?.length) return map;
  const uniq = [...new Set(assetIds.filter(Boolean))];
  const today = todayDateOnly();
  const rows = await AssetMlProfileAssignment.findAll({
    where: {
      assetId: { [Op.in]: uniq },
      activeFlag: true,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: today } }] },
        { [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: today } }] },
      ],
    },
    include: [{ model: MlProfile, as: 'mlProfile', attributes: ['profileCode'], required: true }],
    order: [['updatedAt', 'DESC']],
  });
  const seen = new Set();
  for (const r of rows) {
    const aid = r.assetId;
    if (seen.has(aid)) continue;
    seen.add(aid);
    const code = r.mlProfile?.profileCode || null;
    map.set(aid, code);
  }
  for (const id of uniq) {
    if (!map.has(id)) map.set(id, null);
  }
  for (const id of uniq) {
    if (map.get(id)) continue;
    const def = await resolveDefaultProfileForAsset(id);
    map.set(id, def?.profileCode || null);
  }
  return map;
}

module.exports = {
  resolveEffectiveMlConfig,
  resolveAssignedProfile,
  resolveDefaultProfileForAsset,
  loadActiveProfileCodesByAssetIds,
  DEFAULT_PROFILE_CODE,
};
