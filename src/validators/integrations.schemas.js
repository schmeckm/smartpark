const Joi = require('joi');
const { DEFAULT_INSTALL_OUTPUT_PROFILES } = require('../modules/integrations/adapter-framework/adapter-output-profile-names');

const providerParamsSchema = Joi.object({
  provider: Joi.string().required(),
});

const providerEntityParamsSchema = Joi.object({
  provider: Joi.string().required(),
  entityId: Joi.string().required(),
});

const canonicalMessageListQuerySchema = Joi.object({
  provider: Joi.string(),
  externalParkId: Joi.string(),
  status: Joi.string().valid('RECEIVED', 'VALIDATED', 'APPLIED', 'FAILED', 'IGNORED'),
  messageType: Joi.string(),
  limit: Joi.number().integer().min(1).max(500).default(100),
  offset: Joi.number().integer().min(0).default(0),
});

const idParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const providerSyncBodySchema = Joi.object({
  destinationId: Joi.string().allow(null, ''),
  parkId: Joi.string().allow(null, ''),
  year: Joi.number().integer().min(2000).max(2100),
  month: Joi.number().integer().min(1).max(12),
});

const providerParksQuerySchema = Joi.object({
  destinationId: Joi.string().allow(null, ''),
});

const patchProviderConfigSchema = Joi.object({
  name: Joi.string(),
  baseUrl: Joi.string().uri({ allowRelative: false }),
  enabled: Joi.boolean(),
  capabilities: Joi.object(),
  authConfig: Joi.object().allow(null),
  rateLimitConfig: Joi.object().allow(null),
  pollingConfig: Joi.object().allow(null),
  mappingConfig: Joi.object().allow(null),
});

const patchSettingsSchema = Joi.object({
  selectedProvider: Joi.object({
    provider: Joi.string().required(),
  }),
  selectedDestination: Joi.object({
    provider: Joi.string().required(),
    externalDestinationId: Joi.string().required(),
    destinationName: Joi.string().allow(null, ''),
  }).allow(null),
  selectedPark: Joi.object({
    provider: Joi.string().required(),
    externalDestinationId: Joi.string().allow(null, ''),
    externalParkId: Joi.string().required(),
    parkName: Joi.string().allow(null, ''),
  }).allow(null),
  dataSourceMode: Joi.object({
    mode: Joi.string().valid('MQTT_UNS', 'THEMEPARKS_ADAPTER', 'HYBRID').required(),
  }),
  autoApplyEnabled: Joi.object({ enabled: Joi.boolean().required() }),
  pollingEnabled: Joi.object({ enabled: Joi.boolean().required() }),
  pollingIntervalSeconds: Joi.object({ seconds: Joi.number().integer().min(30).max(86400).required() }),
  aiForecastFactors: Joi.array().items(
    Joi.object({
      code: Joi.string().required(),
      label: Joi.string().required(),
      enabled: Joi.boolean().required(),
      scope: Joi.string().valid('PARK', 'ENTITY_TYPE', 'ENTITY').required(),
      weight: Joi.number().min(-2).max(2).required(),
      lagMinutes: Joi.number().integer().min(0).max(360).required(),
      value: Joi.number().min(-1).max(1).default(0),
      source: Joi.string().valid('manual', 'derived').default('manual'),
    })
  ),
});

const patchMappingSchema = Joi.object({
  internalEntityType: Joi.string().allow(null, ''),
  internalEntityId: Joi.string().uuid().allow(null, ''),
  mappingStatus: Joi.string().valid('UNMAPPED', 'MAPPED', 'IGNORED', 'NEEDS_REVIEW'),
  confidence: Joi.number().min(0).max(1).allow(null),
  metadata: Joi.object(),
});

const createManualUnsNodeSchema = Joi.object({
  domain: Joi.string().required(),
  assetSlug: Joi.string().allow('', null),
  assetName: Joi.string().allow('', null),
  metric: Joi.string().required(),
  entityType: Joi.string().allow('', null),
});

const unsNodeIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const adapterKeyParamsSchema = Joi.object({
  adapterKey: Joi.string().required(),
});

/** GET /integrations/adapters/pipeline-log */
const adapterPipelineLogQuerySchema = Joi.object({
  adapterKey: Joi.string().trim().max(120).pattern(/^[a-z0-9_-]*$/i).allow(''),
  limit: Joi.number().integer().min(1).max(500).default(200),
});

const outputProfileSchema = Joi.string().valid('uns_json', 'sparkplug_json', 'canonical_historian');

/** API-friendly aliases (e.g. run-local) map to internal encoder keys. */
const outputProfileFlexibleSchema = Joi.string().valid(
  'uns_json',
  'sparkplug_json',
  'canonical_historian',
  'UNS_JSON',
  'SPARKPLUG_JSON',
  'CANONICAL_HISTORIAN'
);

const outputObservationSchema = Joi.object({
  eventType: Joi.string().required(),
  domain: Joi.string().required(),
  assetSlug: Joi.string().required(),
  metric: Joi.string().required(),
  value: Joi.any().required(),
  unit: Joi.string().allow('', null),
  eventTime: Joi.string().isoDate().allow(null, ''),
  quality: Joi.string().allow(null, ''),
  confidence: Joi.number().allow(null),
  source: Joi.string().allow(null, ''),
  provider: Joi.string().allow(null, ''),
  externalParkId: Joi.string().allow(null, ''),
  externalEntityId: Joi.string().allow(null, ''),
  externalDestinationId: Joi.string().allow(null, ''),
  entityType: Joi.string().allow(null, ''),
  externalEntityName: Joi.string().allow(null, ''),
  status: Joi.string().allow(null, ''),
  isOpen: Joi.boolean().allow(null),
  providerMessageId: Joi.string().allow(null, ''),
  canonicalMessageType: Joi.string().valid('WAIT_TIME_UPDATED', 'ENTITY_STATUS_UPDATED').allow(null, ''),
  rawPayload: Joi.object().unknown(true),
}).unknown(true);

function requireContextParkOrGroup(ctx, helpers) {
  const ps = ctx && typeof ctx.parkSlug === 'string' && ctx.parkSlug.trim() !== '';
  const sg = ctx && typeof ctx.sparkplugGroupId === 'string' && ctx.sparkplugGroupId.trim() !== '';
  if (!ps && !sg) {
    return helpers.error('any.custom', {
      message: 'context must include a non-empty parkSlug and/or sparkplugGroupId',
    });
  }
  return ctx;
}

const outputContextSchema = Joi.object({
  parkSlug: Joi.string().allow(''),
  sparkplugGroupId: Joi.string().allow(''),
  provider: Joi.string().allow(null, ''),
  externalParkId: Joi.string().allow(null, ''),
  externalEntityId: Joi.string().allow(null, ''),
  externalDestinationId: Joi.string().allow(null, ''),
  entityType: Joi.string().allow(null, ''),
  source: Joi.string().allow(null, ''),
  edgeNode: Joi.string().allow(null, ''),
})
  .unknown(true)
  .custom(requireContextParkOrGroup);

const outputEncodeBodySchema = Joi.object({
  observation: outputObservationSchema.required(),
  context: outputContextSchema.required(),
  profiles: Joi.array().items(outputProfileSchema),
});

const outputEmitBodySchema = outputEncodeBodySchema.keys({
  emitMqtt: Joi.boolean().default(false),
  ingestCanonical: Joi.boolean().default(false),
  autoApply: Joi.boolean().default(true),
});

const demoRunBodySchema = Joi.object({
  config: Joi.object().unknown(true).default({}),
  context: Joi.object().unknown(true).default({}),
  profiles: Joi.array().items(outputProfileFlexibleSchema),
  emitMqtt: Joi.boolean().default(false),
  ingestCanonical: Joi.boolean().default(false),
  autoApply: Joi.boolean().default(true),
});

const runLocalBodySchema = Joi.object({
  adapterKey: Joi.string().required(),
  mode: Joi.string().valid('poll').default('poll'),
  config: Joi.object().unknown(true).default({}),
  context: Joi.object().unknown(true).required().custom(requireContextParkOrGroup),
  profiles: Joi.array().items(outputProfileFlexibleSchema),
  /** If true, enables both MQTT publish and canonical ingest (unless emitMqtt / ingestCanonical are set). */
  emit: Joi.boolean().default(false),
  /** When present (with or without ingestCanonical), overrides the combined `emit` flag for fine-grained control. */
  emitMqtt: Joi.boolean().optional(),
  ingestCanonical: Joi.boolean().optional(),
  autoApply: Joi.boolean().default(true),
});

const discoverLocalBodySchema = Joi.object({
  adapterKey: Joi.string().required(),
  config: Joi.object().unknown(true).default({}),
  context: Joi.object().unknown(true).default({}),
});

const healthLocalBodySchema = discoverLocalBodySchema;

const adapterPackageAssetQuerySchema = Joi.object({
  path: Joi.string().max(500).required(),
});

const installLocalAdapterBodySchema = Joi.object({
  adapterKey: Joi.string().max(120).required(),
  name: Joi.string().allow('', null).max(200),
  configJson: Joi.object().unknown(true).default({}),
  contextJson: Joi.object().unknown(true).default({ parkSlug: 'europapark' }),
  outputProfiles: Joi.array().items(Joi.string()).default([...DEFAULT_INSTALL_OUTPUT_PROFILES]),
  emitEnabled: Joi.boolean().default(false),
  ingestCanonicalEnabled: Joi.boolean().default(false),
  scheduleCron: Joi.string().allow(null, '').max(200).default(null),
});

const installedAdapterIdParamsSchema = Joi.object({
  id: Joi.string().max(200).required(),
});

/** PATCH installed adapter — merges into YAML install file (not DB metadata.install). */
const patchInstalledAdapterBodySchema = Joi.object({
  configJson: Joi.object().unknown(true),
  contextJson: Joi.object().unknown(true),
  outputProfiles: Joi.array().items(Joi.string()),
  emitEnabled: Joi.boolean(),
  ingestCanonicalEnabled: Joi.boolean(),
  scheduleCron: Joi.string().allow(null, '').max(200),
  enabled: Joi.boolean(),
  status: Joi.string().valid('ACTIVE', 'PAUSED', 'DISABLED').insensitive(),
}).or(
  'configJson',
  'contextJson',
  'outputProfiles',
  'emitEnabled',
  'ingestCanonicalEnabled',
  'scheduleCron',
  'enabled',
  'status'
);

const unsSparkplugSchemaExportQuerySchema = Joi.object({
  source: Joi.string().valid('baseline', 'active').default('baseline'),
});

const unsSparkplugSchemaUploadSchema = Joi.object({
  schemaVersion: Joi.number().integer().valid(1).default(1),
  kind: Joi.string().valid('smartpark.uns.sparkplug_topics').default('smartpark.uns.sparkplug_topics'),
  provider: Joi.string().allow('', null),
  externalParkId: Joi.string().allow('', null),
  parkSlug: Joi.string().allow('', null),
  sparkplug: Joi.object({
    groupId: Joi.string().max(120).allow('', null),
    edgeNodeId: Joi.string().max(120).allow('', null),
  })
    .unknown(false)
    .optional(),
  entries: Joi.array()
    .items(
      Joi.object({
        domain: Joi.string().required(),
        assetSlug: Joi.string().required(),
        metric: Joi.string().required(),
        entityName: Joi.string().allow('', null),
        externalEntityId: Joi.string().allow('', null),
        entityType: Joi.string().allow('', null),
        topicPath: Joi.string().allow('', null),
        sparkplugTopic: Joi.string().allow('', null),
      }).unknown(true)
    )
    .min(1)
    .max(5000)
    .required(),
}).unknown(true);

module.exports = {
  providerParamsSchema,
  providerEntityParamsSchema,
  canonicalMessageListQuerySchema,
  idParamsSchema,
  providerSyncBodySchema,
  providerParksQuerySchema,
  patchProviderConfigSchema,
  patchSettingsSchema,
  patchMappingSchema,
  createManualUnsNodeSchema,
  unsNodeIdParamsSchema,
  adapterKeyParamsSchema,
  adapterPipelineLogQuerySchema,
  outputEncodeBodySchema,
  outputEmitBodySchema,
  demoRunBodySchema,
  runLocalBodySchema,
  discoverLocalBodySchema,
  healthLocalBodySchema,
  outputProfileFlexibleSchema,
  adapterPackageAssetQuerySchema,
  installLocalAdapterBodySchema,
  installedAdapterIdParamsSchema,
  patchInstalledAdapterBodySchema,
  unsSparkplugSchemaExportQuerySchema,
  unsSparkplugSchemaUploadSchema,
};
