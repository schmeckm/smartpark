const { asyncHandler } = require('../../utils/async-handler');
const { AppError } = require('../../utils/app-error');
const { AssetsRepository } = require('../assets/assets.repository');
const { enrichRideFromTemplate } = require('../adapters/themeparks/themeparks-sync.service');

function repo() {
  const models = require('../../models');
  return new AssetsRepository(models);
}

const listAssets = asyncHandler(async (req, res) => {
  const q = { ...(req.validated || req.query) };
  const headerParkId = req.parkContext?.id;
  if (headerParkId) {
    if (q.parkId && String(q.parkId) !== String(headerParkId)) {
      throw new AppError('parkId query does not match X-Park-Id', 400, { code: 'PARK_ID_MISMATCH' });
    }
    if (!q.parkId) q.parkId = headerParkId;
  }
  const data = await repo().listAssets({
    parkId: q.parkId,
    assetTypeCode: q.assetTypeCode,
    limit: q.limit,
    offset: q.offset,
  });
  res.json({ success: true, data });
});

const getAsset = asyncHandler(async (req, res) => {
  const row = await repo().getAssetById(req.params.assetId);
  if (!row) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const updateRideMaster = asyncHandler(async (req, res) => {
  const { sequelize, RideMasterData } = require('../../models');
  const body = { ...(req.validated || req.body) };
  const targets = body.targets;
  delete body.targets;
  if (body.operatorMin != null && body.minStaff == null) body.minStaff = body.operatorMin;
  if (body.operatorStandard != null && body.normalStaff == null) body.normalStaff = body.operatorStandard;
  if (body.operatorPeak != null && body.peakStaff == null) body.peakStaff = body.operatorPeak;
  delete body.operatorMin;
  delete body.operatorStandard;
  delete body.operatorPeak;

  const assetId = req.params.assetId;
  const row = await RideMasterData.findByPk(assetId);
  if (!row) throw new AppError('Ride master data not found for asset', 404, { code: 'NOT_FOUND' });

  const t = await sequelize.transaction();
  try {
    await row.update(body, { transaction: t });
    if (targets && typeof targets === 'object') {
      const r = repo();
      await r.upsertAssetTargetsFromProfile(assetId, targets, t);
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  const full = await repo().getAssetById(assetId);
  res.json({ success: true, data: full });
});

const postEnrichRideTemplate = asyncHandler(async (req, res) => {
  const { sequelize, ...models } = require('../../models');
  const body = req.validated || req.body;
  const t = await sequelize.transaction();
  let meta = {};
  try {
    meta = await enrichRideFromTemplate(models, req.params.assetId, body.templateCode || 'RIDE_DEFAULT', t);
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  const full = await repo().getAssetById(req.params.assetId);
  res.json({ success: true, data: full, meta });
});

const listRuntimeOverrides = asyncHandler(async (req, res) => {
  const r = repo();
  const asset = await r.assertAssetExists(req.params.assetId);
  if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  const data = await r.listRuntimeOverrides(req.params.assetId);
  res.json({ success: true, data });
});

const postRuntimeOverride = asyncHandler(async (req, res) => {
  const { sequelize } = require('../../models');
  const r = repo();
  const asset = await r.assertAssetExists(req.params.assetId);
  if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  const body = req.validated || req.body;
  const t = await sequelize.transaction();
  try {
    const row = await r.createRuntimeOverride(
      {
        assetId: req.params.assetId,
        payload: body.payload,
        validFrom: body.validFrom,
        validTo: body.validTo,
        active: body.active,
      },
      t
    );
    await t.commit();
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    await t.rollback();
    throw e;
  }
});

const patchRuntimeOverride = asyncHandler(async (req, res) => {
  const { sequelize } = require('../../models');
  const r = repo();
  const asset = await r.assertAssetExists(req.params.assetId);
  if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  const body = req.validated || req.body;
  const t = await sequelize.transaction();
  try {
    const row = await r.updateRuntimeOverride(req.params.overrideId, req.params.assetId, body, t);
    if (!row) throw new AppError('Runtime override not found', 404, { code: 'NOT_FOUND' });
    await t.commit();
    res.json({ success: true, data: row });
  } catch (e) {
    await t.rollback();
    throw e;
  }
});

module.exports = {
  listAssets,
  getAsset,
  updateRideMaster,
  postEnrichRideTemplate,
  listRuntimeOverrides,
  postRuntimeOverride,
  patchRuntimeOverride,
};
