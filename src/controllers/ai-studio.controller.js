const { asyncHandler } = require('../utils/async-handler');
const { AiStudioService } = require('../services/ai-studio.service');
const { AiStudioFeatureDraftService } = require('../services/ai-studio-feature-draft.service');

const svc = new AiStudioService();
const featureDraftSvc = new AiStudioFeatureDraftService();

const getCatalog = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: svc.getCatalog() });
});

const getDatasetStats = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const parkId = req.parkContext.id;
  const entityId = q.entityId && String(q.entityId).trim() !== '' ? q.entityId : null;
  const data = await svc.getDatasetStats(parkId, q.entityType, entityId, {
    dataset: q.dataset,
  });
  res.json({ success: true, data });
});

const listModels = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query || {};
  const rows = await svc.listModels(parkId, q);
  res.json({ success: true, data: rows });
});

const getOneModel = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await svc.getModel(parkId, id);
  res.json({ success: true, data: row });
});

const postTrain = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const row = await svc.train(parkId, body);
  res.status(201).json({ success: true, data: row });
});

const patchActivate = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id, activeFlag } = req.validated || {};
  const row = await svc.setActive(parkId, id, activeFlag);
  res.json({ success: true, data: row });
});

const postPredict = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await svc.predict(parkId, body);
  res.json({ success: true, data });
});

const getFeatureDraft = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const q = req.validated || req.query;
  const datasetScope = q.datasetScope || 'single_asset';
  const data = await featureDraftSvc.getDraft(parkId, q.entityType, q.entityId, datasetScope);
  res.json({ success: true, data });
});

const putFeatureDraft = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await featureDraftSvc.putDraft(parkId, body);
  res.json({ success: true, data });
});

module.exports = {
  getCatalog,
  getDatasetStats,
  listModels,
  getOneModel,
  postTrain,
  patchActivate,
  postPredict,
  getFeatureDraft,
  putFeatureDraft,
};
