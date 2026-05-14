const { asyncHandler } = require('../../utils/async-handler');
const { AppError } = require('../../utils/app-error');
const {
  listRules,
  createRule,
  patchRule,
  deleteRule,
  evaluatePredictiveMaintenanceForAsset,
  listKnownLiveSparkplugMetricsForAsset,
  maybeAppendPdmEvaluationLog,
  listPdmEvaluationLogs,
} = require('../../services/predictive-maintenance.service');
const { ParkAsset, Park } = require('../../models');

function parkScope(req) {
  return req.parkContext?.id || null;
}

const listPdmRules = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const data = await listRules(req.params.assetId, parkId);
  res.json({ success: true, data: { rules: data } });
});

const postPdmRule = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const body = req.validated || req.body;
  const data = await createRule(req.params.assetId, parkId, body);
  res.status(201).json({ success: true, data });
});

const patchPdmRule = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const body = req.validated || req.body;
  const data = await patchRule(req.params.ruleId, req.params.assetId, parkId, body);
  res.json({ success: true, data });
});

const deletePdmRule = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  await deleteRule(req.params.ruleId, req.params.assetId, parkId);
  res.status(204).send();
});

const getPdmSparkplugMetrics = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const data = await listKnownLiveSparkplugMetricsForAsset(req.params.assetId, parkId);
  res.json({ success: true, data });
});

const getPdmEvaluation = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const assetId = req.params.assetId;
  const asset = await ParkAsset.findOne({
    where: { parkId, assetId },
    attributes: ['assetId', 'parkId', 'name', 'slug'],
  });
  if (!asset) {
    throw new AppError('Asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  const park = await Park.findByPk(parkId, { attributes: ['slug', 'name', 'id'] });
  const parkSlug = park?.slug || park?.name || String(parkId);
  const rules = await listRules(assetId, parkId);
  const enabledPlain = rules.filter((r) => r.enabled !== false);
  const plain = asset.get({ plain: true });
  const evaluation = evaluatePredictiveMaintenanceForAsset(plain, parkSlug, enabledPlain);
  void maybeAppendPdmEvaluationLog({
    assetId,
    parkId,
    source: 'pdm_api',
    evaluation,
  }).catch(() => {});
  res.json({
    success: true,
    data: {
      rules,
      evaluation,
    },
  });
});

const listPdmEvaluationLogsHandler = asyncHandler(async (req, res) => {
  const parkId = parkScope(req);
  const body = req.validated || req.query;
  const limit = body.limit != null ? Number(body.limit) : 50;
  const logs = await listPdmEvaluationLogs(req.params.assetId, parkId, { limit });
  res.json({ success: true, data: { logs } });
});

module.exports = {
  listPdmRules,
  postPdmRule,
  patchPdmRule,
  deletePdmRule,
  getPdmSparkplugMetrics,
  getPdmEvaluation,
  listPdmEvaluationLogsHandler,
};
