const { Router } = require('express');
const multer = require('multer');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const ctrl = require('./master-data.controller');
const rideSignalCtrl = require('../../controllers/ride-signal-capability.controller');
const registrySignalDepCtrl = require('../../controllers/registry-signal-deprecation.controller');
const registryPreviewCtrl = require('../../controllers/registry-preview.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});
const {
  entityTypeParam,
  entityIdParam,
  listMasterDataQuery,
  patchMasterBody,
  importMasterBody,
  createManualAssetBody,
  assetIdOnly,
  patchEnrichmentBody,
  templatesListQuery,
  templateIdParam,
  applyTemplateBody,
  rideAssetIdParam,
  putRideSignalCapabilitiesBody,
  postRegistrySignalDeprecateBody,
  postRegistrySignalReactivateBody,
} = require('./master-data.validators');

const masterDataRouter = Router();

masterDataRouter.get(
  '/rides/:id/signal-capabilities',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.getRideSignalCapabilities
);
masterDataRouter.put(
  '/rides/:id/signal-capabilities',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  validate(putRideSignalCapabilitiesBody),
  rideSignalCtrl.putRideSignalCapabilities
);
masterDataRouter.post(
  '/rides/:id/prepare-uns-topics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postPrepareUnsTopics
);
masterDataRouter.post(
  '/rides/:id/prepare-sparkplug-metrics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postPrepareSparkplugMetrics
);
masterDataRouter.get(
  '/rides/:id/topic-activation-status',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.getRideTopicActivationStatus
);
masterDataRouter.get(
  '/rides/:id/preview-registry-output',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  registryPreviewCtrl.getPreviewRegistryOutput
);
masterDataRouter.get(
  '/rides/:id/compare-registry-vs-legacy',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  registryPreviewCtrl.getCompareRegistryVsLegacy
);
masterDataRouter.post(
  '/rides/:id/activate-prepared-uns-topics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postActivatePreparedUnsTopics
);
masterDataRouter.post(
  '/rides/:id/deactivate-prepared-uns-topics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postDeactivatePreparedUnsTopics
);
masterDataRouter.post(
  '/rides/:id/activate-prepared-sparkplug-metrics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postActivatePreparedSparkplugMetrics
);
masterDataRouter.post(
  '/rides/:id/deactivate-prepared-sparkplug-metrics',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  rideSignalCtrl.postDeactivatePreparedSparkplugMetrics
);

masterDataRouter.get(
  '/rides/:id/registry-signal-deprecations',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  registrySignalDepCtrl.getRegistrySignalDeprecations
);
masterDataRouter.get(
  '/rides/:id/registry-signal-deprecations/health',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideAssetIdParam, 'params'),
  registrySignalDepCtrl.getRegistrySignalDeprecationHealthCtrl
);
masterDataRouter.post(
  '/rides/:id/registry-signal-deprecations/deprecate',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  validate(postRegistrySignalDeprecateBody),
  registrySignalDepCtrl.postRegistrySignalDeprecate
);
masterDataRouter.post(
  '/rides/:id/registry-signal-deprecations/reactivate',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideAssetIdParam, 'params'),
  validate(postRegistrySignalReactivateBody),
  registrySignalDepCtrl.postRegistrySignalReactivate
);

masterDataRouter.get(
  '/templates',
  requirePermission('rides', 'read'),
  validate(templatesListQuery, 'query'),
  ctrl.listTemplates
);
masterDataRouter.get(
  '/templates/:id',
  requirePermission('rides', 'read'),
  validate(templateIdParam, 'params'),
  ctrl.getTemplate
);

masterDataRouter.get(
  '/assets/:assetId/enrichment',
  requirePermission('rides', 'read'),
  validate(assetIdOnly, 'params'),
  ctrl.getEnrichment
);
masterDataRouter.patch(
  '/assets/:assetId/enrichment',
  requirePermission('rides', 'update'),
  validate(assetIdOnly, 'params'),
  validate(patchEnrichmentBody),
  ctrl.patchEnrichment
);

masterDataRouter.get(
  '/assets/:assetId',
  requirePermission('rides', 'read'),
  validate(assetIdOnly, 'params'),
  ctrl.getAssetOne
);

masterDataRouter.get(
  '/:entityType/export/xlsx',
  requirePermission('rides', 'read'),
  validate(entityTypeParam, 'params'),
  validate(listMasterDataQuery, 'query'),
  ctrl.exportXlsx
);

masterDataRouter.get(
  '/:entityType/export',
  requirePermission('rides', 'read'),
  validate(entityTypeParam, 'params'),
  validate(listMasterDataQuery, 'query'),
  ctrl.exportBundle
);

masterDataRouter.post(
  '/:entityType/import/xlsx',
  requirePermission('rides', 'update'),
  validate(entityTypeParam, 'params'),
  upload.single('file'),
  ctrl.importXlsx
);

masterDataRouter.post(
  '/:entityType/import',
  requirePermission('rides', 'update'),
  validate(entityTypeParam, 'params'),
  validate(importMasterBody),
  ctrl.importBundle
);

masterDataRouter.get(
  '/:entityType',
  requirePermission('rides', 'read'),
  validate(entityTypeParam, 'params'),
  validate(listMasterDataQuery, 'query'),
  ctrl.list
);

masterDataRouter.post(
  '/:entityType',
  requirePermission('rides', 'update'),
  validate(entityTypeParam, 'params'),
  validate(createManualAssetBody),
  ctrl.createOne
);

masterDataRouter.post(
  '/:entityType/:id/apply-template',
  requirePermission('rides', 'update'),
  validate(entityIdParam, 'params'),
  validate(applyTemplateBody),
  ctrl.applyTemplate
);

masterDataRouter.get(
  '/:entityType/:id',
  requirePermission('rides', 'read'),
  validate(entityIdParam, 'params'),
  ctrl.getOne
);

masterDataRouter.patch(
  '/:entityType/:id',
  requirePermission('rides', 'update'),
  validate(entityIdParam, 'params'),
  validate(patchMasterBody),
  ctrl.patchOne
);

masterDataRouter.delete(
  '/:entityType/:id',
  requirePermission('rides', 'update'),
  validate(entityIdParam, 'params'),
  ctrl.removeOne
);

module.exports = { masterDataRouter };
