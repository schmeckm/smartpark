const { asyncHandler } = require('../utils/async-handler');
const { AiStudioService } = require('../services/ai-studio.service');
const aiStudioBatchTrainer = require('../services/ai-studio-batch-trainer.service');
const { AiStudioFeatureDraftService } = require('../services/ai-studio-feature-draft.service');
const { AuditLogService } = require('../services/audit-log.service');

const svc = new AiStudioService();
const featureDraftSvc = new AiStudioFeatureDraftService();
const audit = new AuditLogService();

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

const postValidateFeatures = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await svc.validateFeatureStoreFeatures(parkId, body.entityType, body.entityId, body.features);
  res.json({ success: true, data });
});

const getBatchTrainStatus = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await aiStudioBatchTrainer.getBatchTrainStatus(parkId);
  res.json({ success: true, data });
});

const postBatchTrainRides = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await aiStudioBatchTrainer.startParkRideBatchTrain(parkId, svc, body);
  res.status(202).json({ success: true, data });
});

const postBatchApply = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await aiStudioBatchTrainer.applyParkRideBatchAlgorithms(parkId, body.batchId, svc);
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
  await audit.log({
    action: activeFlag ? 'ai_studio_model.activate' : 'ai_studio_model.deactivate',
    entityType: 'AiStudioModel',
    entityId: id,
    newValue: JSON.stringify({ activeFlag }),
  });
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

/** Query/body flags often arrive as strings; some stacks duplicate query keys into arrays. */
function wantsPermanentStudioDelete(req) {
  const fromValidated = req.validated?.permanent;
  const fromQuery = req.query?.permanent;
  const candidates = [fromValidated, fromQuery].flat().filter((x) => x !== undefined && x !== '');
  for (const v of candidates) {
    if (v === true || v === 1) return true;
    if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  }
  return false;
}

const postRuntimeResolution = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || req.body;
  const data = await svc.explainRuntimeResolution(parkId, body);
  res.json({ success: true, data });
});

const deleteArchiveModel = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const id = req.validated?.id || req.params.id;
  const isPermanent = wantsPermanentStudioDelete(req);
  if (isPermanent) {
    const data = await svc.permanentlyDeleteStudioModel(parkId, id);
    await audit.log({
      action: 'ai_studio_model.delete_permanent',
      entityType: 'AiStudioModel',
      entityId: id,
    });
    res.json({ success: true, data });
    return;
  }
  const row = await svc.archiveStudioModel(parkId, id, req.user?.id || null);
  await audit.log({
    action: 'ai_studio_model.archive',
    entityType: 'AiStudioModel',
    entityId: id,
  });
  res.json({ success: true, data: row });
});

const postRestoreModel = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { id } = req.validated || req.params;
  const row = await svc.restoreStudioModel(parkId, id, req.user?.id || null);
  await audit.log({
    action: 'ai_studio_model.restore',
    entityType: 'AiStudioModel',
    entityId: id,
  });
  res.json({ success: true, data: row });
});

module.exports = {
  getCatalog,
  getDatasetStats,
  postValidateFeatures,
  getBatchTrainStatus,
  postBatchTrainRides,
  postBatchApply,
  listModels,
  getOneModel,
  postTrain,
  patchActivate,
  deleteArchiveModel,
  postRestoreModel,
  postPredict,
  getFeatureDraft,
  putFeatureDraft,
  postRuntimeResolution,
};
