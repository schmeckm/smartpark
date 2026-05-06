const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const controller = require('../../controllers/integrations.controller');
const {
  canonicalMessageListQuerySchema,
  providerParamsSchema,
  providerEntityParamsSchema,
  idParamsSchema,
  providerSyncBodySchema,
  providerParksQuerySchema,
  patchProviderConfigSchema,
  patchSettingsSchema,
  patchMappingSchema,
  createManualUnsNodeSchema,
  unsNodeIdParamsSchema,
  unsSparkplugSchemaExportQuerySchema,
  unsSparkplugSchemaUploadSchema,
  adapterKeyParamsSchema,
  adapterPipelineLogQuerySchema,
  outputEncodeBodySchema,
  outputEmitBodySchema,
  demoRunBodySchema,
  runLocalBodySchema,
  discoverLocalBodySchema,
  healthLocalBodySchema,
  installLocalAdapterBodySchema,
  installedAdapterIdParamsSchema,
  patchInstalledAdapterBodySchema,
} = require('../../validators/integrations.schemas');

const router = Router();

router.get('/feature-flags', requirePermission('integrations', 'read'), controller.getFeatureFlags);

router.get('/providers', requirePermission('integrations', 'read'), controller.listProviders);
router.get(
  '/providers/:provider/config',
  requirePermission('integrations', 'read'),
  validate(providerParamsSchema, 'params'),
  controller.getProviderConfig
);
router.patch(
  '/providers/:provider/config',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(patchProviderConfigSchema),
  controller.patchProviderConfig
);

/** Static `/adapters/*` paths must be registered before `/:provider/*` so they are never captured as a provider slug. */
router.post(
  '/adapters/demo/run',
  requirePermission('integrations', 'manage'),
  validate(demoRunBodySchema),
  controller.runDemoAdapter
);
router.post(
  '/adapters/run-local',
  requirePermission('integrations', 'manage'),
  validate(runLocalBodySchema),
  controller.runLocalAdapter
);
router.post(
  '/adapters/discover-local',
  requirePermission('integrations', 'read'),
  validate(discoverLocalBodySchema),
  controller.discoverLocalAdapter
);
router.post(
  '/adapters/health-local',
  requirePermission('integrations', 'read'),
  validate(healthLocalBodySchema),
  controller.healthLocalAdapter
);
router.post(
  '/adapters/install-local',
  requirePermission('integrations', 'manage'),
  validate(installLocalAdapterBodySchema),
  controller.installLocalAdapter
);
router.get('/adapters/packages', requirePermission('integrations', 'read'), controller.listAdapterPackages);
router.get(
  '/adapters/pipeline-log',
  requirePermission('integrations', 'read'),
  validate(adapterPipelineLogQuerySchema, 'query'),
  controller.getAdapterPipelineLog
);
router.post('/adapters/packages/reload', requirePermission('integrations', 'manage'), controller.reloadAdapterPackages);
router.post(
  '/adapters/packages/:adapterKey/health',
  requirePermission('integrations', 'read'),
  validate(adapterKeyParamsSchema, 'params'),
  controller.healthAdapterPackage
);
router.get(
  '/adapters/:adapterKey/inventory',
  requirePermission('integrations', 'read'),
  validate(adapterKeyParamsSchema, 'params'),
  controller.getAdapterInventory
);

router.get(
  '/:provider/destinations',
  requirePermission('integrations', 'read'),
  validate(providerParamsSchema, 'params'),
  controller.listProviderDestinations
);
router.get(
  '/:provider/parks',
  requirePermission('integrations', 'read'),
  validate(providerParamsSchema, 'params'),
  validate(providerParksQuerySchema, 'query'),
  controller.listProviderParks
);
router.get(
  '/:provider/entity/:entityId',
  requirePermission('integrations', 'read'),
  validate(providerEntityParamsSchema, 'params'),
  controller.getProviderEntity
);
router.get(
  '/:provider/entity/:entityId/children',
  requirePermission('integrations', 'read'),
  validate(providerEntityParamsSchema, 'params'),
  controller.listProviderEntityChildren
);
router.get(
  '/:provider/entity/:entityId/live',
  requirePermission('integrations', 'read'),
  validate(providerEntityParamsSchema, 'params'),
  controller.getProviderEntityLive
);
router.get(
  '/:provider/entity/:entityId/schedule',
  requirePermission('integrations', 'read'),
  validate(providerEntityParamsSchema, 'params'),
  controller.getProviderEntitySchedule
);

router.post(
  '/:provider/sync/destinations',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncDestinations
);
router.post(
  '/:provider/sync/parks',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncParks
);
router.post(
  '/:provider/sync/entities',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncEntities
);
router.post(
  '/:provider/sync/live',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncLive
);
router.post(
  '/:provider/sync/calendar',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncCalendar
);
router.post(
  '/:provider/sync/all-parks',
  requirePermission('integrations', 'manage'),
  validate(providerParamsSchema, 'params'),
  validate(providerSyncBodySchema),
  controller.syncAllParksInDestination
);

router.get(
  '/canonical/messages',
  requirePermission('integrations', 'read'),
  validate(canonicalMessageListQuerySchema, 'query'),
  controller.listCanonicalMessages
);
router.get(
  '/canonical/messages/:id',
  requirePermission('integrations', 'read'),
  validate(idParamsSchema, 'params'),
  controller.getCanonicalMessage
);
router.post(
  '/canonical/messages/:id/reprocess',
  requirePermission('integrations', 'manage'),
  validate(idParamsSchema, 'params'),
  controller.reprocessCanonicalMessage
);

router.get('/mappings', requirePermission('integrations', 'read'), controller.listMappings);
router.patch(
  '/mappings/:id',
  requirePermission('integrations', 'manage'),
  validate(idParamsSchema, 'params'),
  validate(patchMappingSchema),
  controller.patchMapping
);

router.get('/settings', requirePermission('integrations', 'read'), controller.getSettings);
router.patch(
  '/settings',
  requirePermission('integrations', 'manage'),
  validate(patchSettingsSchema),
  controller.patchSettings
);

router.get('/uns/suggestions', requirePermission('integrations', 'read'), controller.getUnsSuggestions);
router.get('/uns/manual', requirePermission('integrations', 'read'), controller.listManualUnsNodes);
router.post(
  '/uns/manual',
  requirePermission('integrations', 'manage'),
  validate(createManualUnsNodeSchema),
  controller.createManualUnsNode
);
router.delete(
  '/uns/manual/:id',
  requirePermission('integrations', 'manage'),
  validate(unsNodeIdParamsSchema, 'params'),
  controller.deleteManualUnsNode
);

router.get(
  '/uns/sparkplug-schema',
  requirePermission('integrations', 'read'),
  validate(unsSparkplugSchemaExportQuerySchema, 'query'),
  controller.getUnsSparkplugSchema
);
router.put(
  '/uns/sparkplug-schema',
  requirePermission('integrations', 'manage'),
  validate(unsSparkplugSchemaUploadSchema),
  controller.putUnsSparkplugSchema
);
router.delete(
  '/uns/sparkplug-schema',
  requirePermission('integrations', 'manage'),
  controller.deleteUnsSparkplugSchema
);

router.post(
  '/uns/materialize-nodes',
  requirePermission('integrations', 'manage'),
  controller.materializeUnsNodes
);

router.get('/installed-adapters', requirePermission('integrations', 'read'), controller.listInstalledAdapters);
/** Static path before `/:id` so `install-local` is never captured as an id segment. */
router.post(
  '/installed-adapters/install-local',
  requirePermission('integrations', 'manage'),
  validate(installLocalAdapterBodySchema),
  controller.installLocalAdapter
);
router.get(
  '/installed-adapters/:id',
  requirePermission('integrations', 'read'),
  validate(installedAdapterIdParamsSchema, 'params'),
  controller.getInstalledAdapter
);
router.patch(
  '/installed-adapters/:id',
  requirePermission('integrations', 'manage'),
  validate(installedAdapterIdParamsSchema, 'params'),
  validate(patchInstalledAdapterBodySchema),
  controller.patchInstalledAdapter
);
router.delete(
  '/installed-adapters/:id',
  requirePermission('integrations', 'manage'),
  validate(installedAdapterIdParamsSchema, 'params'),
  controller.deleteInstalledAdapter
);

router.post(
  '/output/encode',
  requirePermission('integrations', 'read'),
  validate(outputEncodeBodySchema),
  controller.encodeAdapterOutput
);
router.post(
  '/output/emit',
  requirePermission('integrations', 'manage'),
  validate(outputEmitBodySchema),
  controller.emitAdapterOutput
);

module.exports = { integrationsRouter: router };
