const { asyncHandler } = require('../../utils/async-handler');
const { AppError } = require('../../utils/app-error');
const { MasterDataService } = require('./master-data.service');
const { EntityTypeTemplatesService } = require('./entity-type-templates.service');

const svc = new MasterDataService();
const templatesSvc = new EntityTypeTemplatesService();

function serializeDetail(bundle) {
  return MasterDataService.serializeDetail(bundle);
}

const list = asyncHandler(async (req, res) => {
  const data = await svc.list(req.params.entityType, req.validated || req.query);
  res.json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const bundle = await svc.getById(req.params.entityType, req.params.id);
  res.json({ success: true, data: serializeDetail(bundle) });
});

const getAssetOne = asyncHandler(async (req, res) => {
  const bundle = await svc.getByAssetId(req.params.assetId);
  res.json({ success: true, data: serializeDetail(bundle) });
});

const patchOne = asyncHandler(async (req, res) => {
  const bundle = await svc.patch(req.params.entityType, req.params.id, req.validated || req.body);
  res.json({ success: true, data: serializeDetail(bundle) });
});

const removeOne = asyncHandler(async (req, res) => {
  const data = await svc.deactivate(req.params.entityType, req.params.id);
  res.json({ success: true, data });
});

const createOne = asyncHandler(async (req, res) => {
  const bundle = await svc.createManualAsset(req.params.entityType, req.validated || req.body);
  res.status(201).json({ success: true, data: serializeDetail(bundle) });
});

const listTemplates = asyncHandler(async (req, res) => {
  const entityType = req.validated?.entityType || req.query?.entityType;
  const rows = await templatesSvc.list(entityType);
  res.json({ success: true, data: rows.map((r) => r.get({ plain: true })) });
});

const getTemplate = asyncHandler(async (req, res) => {
  const row = await templatesSvc.getById(req.params.id);
  if (!row) {
    throw new AppError('Template not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data: row.get({ plain: true }) });
});

const applyTemplate = asyncHandler(async (req, res) => {
  const bundle = await svc.applyTemplate(req.params.entityType, req.params.id, req.validated || req.body);
  res.json({ success: true, data: serializeDetail(bundle) });
});

const getEnrichment = asyncHandler(async (req, res) => {
  const data = await svc.getEnrichment(req.params.assetId);
  res.json({ success: true, data });
});

const patchEnrichment = asyncHandler(async (req, res) => {
  const data = await svc.patchEnrichment(req.params.assetId, req.validated || req.body);
  res.json({ success: true, data });
});

const exportBundle = asyncHandler(async (req, res) => {
  const data = await svc.exportMasterData(req.params.entityType, req.validated || req.query);
  res.json({ success: true, data });
});

const importBundle = asyncHandler(async (req, res) => {
  const data = await svc.importMasterData(req.params.entityType, req.validated || req.body);
  res.json({ success: true, data });
});

const exportXlsx = asyncHandler(async (req, res) => {
  const buf = await svc.exportMasterDataXlsx(req.params.entityType, req.validated || req.query);
  const safe = String(req.params.entityType || 'export').replace(/[^a-z0-9_-]/gi, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="master-data-${safe}.xlsx"`);
  res.send(buf);
});

const importXlsx = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Upload a single .xlsx file as multipart field "file"', 400, { code: 'FILE_REQUIRED' });
  }
  const data = await svc.importMasterDataXlsx(req.params.entityType, req.file.buffer);
  res.json({ success: true, data });
});

module.exports = {
  list,
  getOne,
  getAssetOne,
  patchOne,
  removeOne,
  createOne,
  listTemplates,
  getTemplate,
  applyTemplate,
  getEnrichment,
  patchEnrichment,
  exportBundle,
  importBundle,
  exportXlsx,
  importXlsx,
};
