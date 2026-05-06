const Joi = require('joi');

const entityTypeParam = Joi.object({
  entityType: Joi.string()
    .valid('parks', 'rides', 'attractions', 'shows', 'restaurants', 'shops', 'zones')
    .required(),
});

const entityIdParam = Joi.object({
  entityType: Joi.string()
    .valid('parks', 'rides', 'attractions', 'shows', 'restaurants', 'shops', 'zones')
    .required(),
  /** UUID, slug, or external entity id (resolved server-side). */
  id: Joi.string().trim().min(1).max(200).required(),
});

const listMasterDataQuery = Joi.object({
  search: Joi.string().trim().max(200).allow('').optional(),
  sortBy: Joi.string().trim().max(32).optional(),
  sortDir: Joi.string().valid('asc', 'desc').optional(),
  page: Joi.number().integer().min(0).optional(),
  pageSize: Joi.number().integer().min(1).max(200).optional(),
  /** UUID, slug, or external entity id (resolved to park UUID for filtering). */
  parkId: Joi.string().trim().max(200).allow('').optional(),
  assetType: Joi.string().trim().max(32).optional(),
  status: Joi.string().trim().max(32).optional(),
  provider: Joi.string().trim().max(40).optional(),
  enrichmentStatus: Joi.string().valid('BASIC', 'ENRICHED', 'LOCKED', 'basic', 'enriched', 'locked').optional(),
  profileCompleteness: Joi.string().valid('COMPLETE', 'INCOMPLETE', 'complete', 'incomplete').optional(),
  templateId: Joi.string().uuid().optional(),
  zoneId: Joi.string().uuid().optional(),
});

const patchMasterBody = Joi.object({
  name: Joi.string().max(200).optional(),
  slug: Joi.string().max(160).optional(),
  timezone: Joi.string().max(64).allow(null).optional(),
  active: Joi.boolean().optional(),
  templateId: Joi.string().uuid().allow(null).optional(),
  masterProfile: Joi.object().unknown(true).optional(),
  asset: Joi.object().unknown(true).optional(),
  rideMaster: Joi.object().unknown(true).optional(),
  showMaster: Joi.object().unknown(true).optional(),
  restaurantMaster: Joi.object().unknown(true).optional(),
  shopMaster: Joi.object().unknown(true).optional(),
  targets: Joi.object().unknown(true).optional(),
  enrichment: Joi.object().unknown(true).optional(),
  sortOrder: Joi.number().integer().optional(),
}).min(1);

const importMasterBody = Joi.object({
  schemaVersion: Joi.number().integer().valid(1).optional(),
  entityType: Joi.string()
    .valid('parks', 'rides', 'attractions', 'shows', 'restaurants', 'shops', 'zones')
    .optional(),
  items: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().trim().min(1).max(200).required(),
        patch: patchMasterBody.required(),
      })
    )
    .min(1)
    .max(2000)
    .required(),
});

const createManualAssetBody = Joi.object({
  parkId: Joi.string().trim().min(1).max(200).required(),
  name: Joi.string().trim().min(1).max(240).required(),
  slug: Joi.string().trim().max(160).optional(),
  asset: Joi.object({ status: Joi.string().max(32).optional() }).optional(),
});

const assetIdOnly = Joi.object({
  assetId: Joi.string().trim().min(1).max(200).required(),
});

const patchEnrichmentBody = Joi.object({
  enrichment: Joi.object().unknown(true).optional(),
  locks: Joi.object().pattern(Joi.string(), Joi.array().items(Joi.string())).optional(),
}).min(1);

const templatesListQuery = Joi.object({
  entityType: Joi.string().trim().max(32).allow('').optional(),
});

const templateIdParam = Joi.object({
  id: Joi.string().uuid().required(),
});

const applyTemplateBody = Joi.object({
  templateId: Joi.string().uuid().required(),
  mode: Joi.string().valid('fill_empty', 'override').optional(),
});

const rideAssetIdParam = Joi.object({
  id: Joi.string().uuid().required(),
});

const RIDE_SIGNAL_SOURCES = [
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
];

const rideSignalCapabilityItem = Joi.object({
  signalCatalogId: Joi.string().uuid().required(),
  signalSource: Joi.string().valid(...RIDE_SIGNAL_SOURCES).required(),
  valueType: Joi.string().trim().max(64).optional(),
});

const putRideSignalCapabilitiesBody = Joi.object({
  capabilities: Joi.array().items(rideSignalCapabilityItem).min(1).max(500).required(),
}).unknown(false);

const registrySignalDeprecationSignalKey = Joi.string().trim().min(1).max(128).required();

const postRegistrySignalDeprecateBody = Joi.object({
  signalKey: registrySignalDeprecationSignalKey,
  registryAuthoritative: Joi.boolean().optional(),
  disableLegacyFallback: Joi.boolean().optional(),
  legacyPublishDisabled: Joi.boolean().optional(),
})
  .or('registryAuthoritative', 'disableLegacyFallback', 'legacyPublishDisabled')
  .unknown(false);

const postRegistrySignalReactivateBody = Joi.object({
  signalKey: registrySignalDeprecationSignalKey,
}).unknown(false);

module.exports = {
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
};
