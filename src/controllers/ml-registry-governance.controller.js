'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { archiveRegistryEntryByPk, permanentlyDeleteRegistryEntryByPk } = require('../services/ml/ml-model-registry.service');
const { AuditLogService } = require('../services/audit-log.service');

const audit = new AuditLogService();

function wantsPermanentRegistryDelete(req) {
  const fromValidated = req.validated?.permanent;
  const fromQuery = req.query?.permanent;
  const candidates = [fromValidated, fromQuery].flat().filter((x) => x !== undefined && x !== '');
  for (const v of candidates) {
    if (v === true || v === 1) return true;
    if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  }
  return false;
}

/** DELETE /api/v1/ai/ml/registry/entries/:id — soft-archive, or hard-delete when `permanent=true` (archived only). */
const deleteArchiveRegistryEntry = asyncHandler(async (req, res) => {
  const id = req.validated?.id || req.params.id;
  const isPermanent = wantsPermanentRegistryDelete(req);
  if (isPermanent) {
    const data = await permanentlyDeleteRegistryEntryByPk(id);
    await audit.log({
      action: 'ml_model_registry.delete_permanent',
      entityType: 'MlModelRegistry',
      entityId: id,
    });
    res.json({ success: true, data });
    return;
  }
  const row = await archiveRegistryEntryByPk(id, req.user?.id || null);
  await audit.log({
    action: 'ml_model_registry.archive',
    entityType: 'MlModelRegistry',
    entityId: id,
  });
  res.json({ success: true, data: row });
});

module.exports = {
  deleteArchiveRegistryEntry,
};
