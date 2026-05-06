/**
 * Enterprise ML influence CRUD (L1/L2/L3) and asset ML profile APIs.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { MlInfluenceAdminService, resolveEffectiveMlConfig } = require('../services/ml-influence-admin.service');
const { AiFeatureDataQualityService } = require('../services/ai-feature-data-quality.service');
const { ParkAsset } = require('../models');

const svc = new MlInfluenceAdminService();
const featureDqSvc = new AiFeatureDataQualityService();

function jsonRows(rows) {
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

const listGlobalFactors = asyncHandler(async (_req, res) => {
  const rows = await svc.listGlobalFactors();
  res.json({ success: true, data: jsonRows(rows) });
});

const postGlobalFactor = asyncHandler(async (req, res) => {
  const b = req.validated || req.body;
  const row = await svc.createGlobalFactor(b);
  res.status(201).json({ success: true, data: row.toJSON() });
});

const patchGlobalFactor = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { id, ...patch } = v;
  const row = await svc.updateGlobalFactor(id, patch);
  if (!row) throw new AppError('Not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row.toJSON() });
});

const deleteGlobalFactor = asyncHandler(async (req, res) => {
  const { id } = req.validated || req.params;
  const ok = await svc.deleteGlobalFactor(id);
  if (!ok) throw new AppError('Not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: { deleted: true } });
});

const listParkFactors = asyncHandler(async (req, res) => {
  const { parkId } = req.validated || req.params;
  if (parkId !== req.parkContext.id) {
    throw new AppError('Park id must match X-Park-Id', 403, { code: 'PARK_MISMATCH' });
  }
  const rows = await svc.listParkFactors(parkId);
  res.json({ success: true, data: jsonRows(rows) });
});

const patchParkFactors = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { parkId, factors } = v;
  if (parkId !== req.parkContext.id) {
    throw new AppError('Park id must match X-Park-Id', 403, { code: 'PARK_MISMATCH' });
  }
  const rows = await svc.patchParkFactors(parkId, factors);
  res.json({ success: true, data: jsonRows(rows) });
});

const listMlProfiles = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const rows = await svc.listMlProfiles(q);
  res.json({ success: true, data: jsonRows(rows) });
});

const postMlProfile = asyncHandler(async (req, res) => {
  const b = req.validated || req.body;
  const payload = {
    ...b,
    profileCode: String(b.profileCode || '')
      .trim()
      .toUpperCase(),
    entityType: String(b.entityType || '').trim(),
    profileName: String(b.profileName || '').trim(),
  };
  const row = await svc.createMlProfile(payload);
  res.status(201).json({ success: true, data: row.toJSON() });
});

const patchMlProfile = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { id, ...patch } = v;
  const row = await svc.updateMlProfile(id, patch);
  if (!row) throw new AppError('Not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row.toJSON() });
});

/** HTTP DELETE → sets activeFlag=false (ADR: no hard delete). */
const deleteMlProfile = asyncHandler(async (req, res) => {
  const { id } = req.validated || req.params;
  const row = await svc.deactivateMlProfile(id);
  if (!row) throw new AppError('Not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row.toJSON() });
});

async function assertAssetInPark(assetId, parkId) {
  const asset = await ParkAsset.findOne({ where: { assetId, parkId } });
  if (!asset) throw new AppError('Asset not found in park', 404, { code: 'NOT_FOUND' });
}

const putAssetMlProfile = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { assetId, profileId } = v;
  const parkId = req.parkContext.id;
  await assertAssetInPark(assetId, parkId);
  const row = await svc.putAssetMlProfile(assetId, { profileId, assignedBy: req.user?.id || null });
  res.json({ success: true, data: row.toJSON() });
});

const patchAssetMlOverrides = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const { assetId, ops } = v;
  const parkId = req.parkContext.id;
  await assertAssetInPark(assetId, parkId);
  const rows = await svc.patchAssetMlOverrides(assetId, ops);
  res.json({ success: true, data: jsonRows(rows) });
});

const getEffectiveMlConfig = asyncHandler(async (req, res) => {
  const { assetId } = req.validated || req.params;
  const parkId = req.parkContext.id;
  await assertAssetInPark(assetId, parkId);
  const data = await resolveEffectiveMlConfig(assetId);
  res.json({ success: true, data });
});

const getFeatureStoreMonitor = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await svc.getFeatureStoreMonitor(parkId);
  res.json({ success: true, data });
});

const getFeatureDataQuality = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const data = await featureDqSvc.getDashboard(parkId, q);
  res.json({ success: true, data });
});

const deleteParkFeatureSnapshot = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const data = await featureDqSvc.deleteParkSnapshotById(parkId, id);
  res.json({ success: true, data });
});

const purgeParkFeatureSnapshots = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { from, to } = req.validated || req.body;
  const data = await featureDqSvc.purgeParkSnapshotsInRange(parkId, from, to);
  res.json({ success: true, data });
});

const bulkDeleteParkFeatureSnapshots = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { ids } = req.validated || req.body;
  const data = await featureDqSvc.deleteParkSnapshotsByIds(parkId, ids);
  res.json({ success: true, data });
});

module.exports = {
  listGlobalFactors,
  postGlobalFactor,
  patchGlobalFactor,
  deleteGlobalFactor,
  listParkFactors,
  patchParkFactors,
  listMlProfiles,
  postMlProfile,
  patchMlProfile,
  deleteMlProfile,
  putAssetMlProfile,
  patchAssetMlOverrides,
  getEffectiveMlConfig,
  getFeatureStoreMonitor,
  getFeatureDataQuality,
  deleteParkFeatureSnapshot,
  purgeParkFeatureSnapshots,
  bulkDeleteParkFeatureSnapshots,
};
