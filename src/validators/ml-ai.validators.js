const Joi = require('joi');

const uuid = Joi.string().uuid().required();

const globalFactorBody = Joi.object({
  factorCode: Joi.string().max(80).required(),
  factorName: Joi.string().max(200).required(),
  factorGroup: Joi.string().max(80).allow(null, ''),
  description: Joi.string().allow(null, ''),
  activeFlag: Joi.boolean().default(true),
  weight: Joi.number().default(1),
  lagMinutes: Joi.number().integer().min(0).default(0),
  defaultValue: Joi.number().allow(null),
  currentValue: Joi.number().allow(null),
  sourceType: Joi.string().valid('MANUAL', 'API', 'DERIVED', 'CALCULATED').default('MANUAL'),
  adapterKey: Joi.string().max(120).allow(null, ''),
  mqttTopic: Joi.string().max(500).allow(null, ''),
  unit: Joi.string().max(40).allow(null, ''),
  validFrom: Joi.string().allow(null, ''),
  validTo: Joi.string().allow(null, ''),
  notes: Joi.string().allow(null, ''),
});

const globalFactorPatch = Joi.object({
  factorName: Joi.string().max(200),
  factorGroup: Joi.string().max(80).allow(null, ''),
  description: Joi.string().allow(null, ''),
  activeFlag: Joi.boolean(),
  weight: Joi.number(),
  lagMinutes: Joi.number().integer().min(0),
  defaultValue: Joi.number().allow(null),
  currentValue: Joi.number().allow(null),
  sourceType: Joi.string().valid('MANUAL', 'API', 'DERIVED', 'CALCULATED'),
  adapterKey: Joi.string().max(120).allow(null, ''),
  mqttTopic: Joi.string().max(500).allow(null, ''),
  unit: Joi.string().max(40).allow(null, ''),
  validFrom: Joi.string().allow(null, ''),
  validTo: Joi.string().allow(null, ''),
  notes: Joi.string().allow(null, ''),
}).min(1);

const parkFactorsPatchBody = Joi.object({
  factors: Joi.array()
    .items(
      Joi.object({
        factorCode: Joi.string().max(80).required(),
        weightOverride: Joi.number().allow(null),
        currentValue: Joi.number().allow(null),
        activeFlag: Joi.boolean(),
        notes: Joi.string().allow(null, ''),
        sourceType: Joi.string().max(24),
      })
    )
    .required(),
});

const score01 = Joi.number().min(0).max(1).allow(null);

const mlProfileBody = Joi.object({
  profileCode: Joi.string().max(80).trim().uppercase().pattern(/^[A-Z0-9_]+$/).required(),
  profileName: Joi.string().max(200).trim().required(),
  entityType: Joi.string().max(32).trim().required(),
  category: Joi.string().max(80).allow(null, ''),
  activeFlag: Joi.boolean().default(true),
  weatherSensitive: Joi.boolean().default(false),
  rainSensitive: Joi.boolean().default(false),
  windSensitive: Joi.boolean().default(false),
  heatSensitive: Joi.boolean().default(false),
  weatherSensitivityScore: score01,
  rainImpactScore: score01,
  windImpactScore: score01,
  heatImpactScore: score01,
  queueElasticityScore: score01,
  capacityElasticityScore: score01,
  staffDependencyScore: score01,
  downtimeRiskScore: score01,
  maintenanceCriticality: score01,
  targetThroughputFactor: Joi.number().min(0).max(1.5).allow(null),
  maxQueueTargetMin: Joi.number().integer().min(0).allow(null),
  availabilityTargetPercent: Joi.number().min(0).max(100).allow(null),
  modelType: Joi.string().max(40).default('BASELINE'),
  featureSetCode: Joi.string().max(64).default('DEFAULT_V1'),
  downtimeImpactLevel: Joi.string().max(40).allow(null, ''),
  notes: Joi.string().max(20000).allow(null, ''),
});

const mlProfilePatch = Joi.object({
  profileName: Joi.string().max(200).trim(),
  entityType: Joi.string().max(32).trim(),
  category: Joi.string().max(80).allow(null, ''),
  activeFlag: Joi.boolean(),
  weatherSensitive: Joi.boolean(),
  rainSensitive: Joi.boolean(),
  windSensitive: Joi.boolean(),
  heatSensitive: Joi.boolean(),
  weatherSensitivityScore: score01,
  rainImpactScore: score01,
  windImpactScore: score01,
  heatImpactScore: score01,
  queueElasticityScore: score01,
  capacityElasticityScore: score01,
  staffDependencyScore: score01,
  downtimeRiskScore: score01,
  maintenanceCriticality: score01,
  targetThroughputFactor: Joi.number().min(0).max(1.5).allow(null),
  maxQueueTargetMin: Joi.number().integer().min(0).allow(null),
  availabilityTargetPercent: Joi.number().min(0).max(100).allow(null),
  modelType: Joi.string().max(40),
  featureSetCode: Joi.string().max(64),
  downtimeImpactLevel: Joi.string().max(40).allow(null, ''),
  notes: Joi.string().max(20000).allow(null, ''),
}).min(1);

const assetMlProfilePut = Joi.object({
  profileId: uuid,
});

const assetMlOverridesPatch = Joi.object({
  ops: Joi.array()
    .items(
      Joi.object({
        overrideKey: Joi.string().max(120).required(),
        overrideValueJson: Joi.object().required(),
        overrideReason: Joi.string().allow(null, ''),
        activeFlag: Joi.boolean().default(true),
      })
    )
    .required(),
});

const mlProfilesQuery = Joi.object({
  entityType: Joi.string().max(32),
  activeFlag: Joi.boolean().truthy('true', '1').falsy('false', '0'),
  search: Joi.string().max(120).allow(''),
});

/** GET /ai/feature-data-quality — park-scoped dashboard (X-Park-Id). */
const featureDataQualityQuery = Joi.object({
  from: Joi.string().max(64).allow('', null),
  to: Joi.string().max(64).allow('', null),
  entityType: Joi.string().valid('RIDE', 'SHOW', 'RESTAURANT', 'SHOP', '').allow(null),
  completenessMax: Joi.number().min(0).max(1).allow(null),
  missingFeature: Joi.string().valid('weather', 'calendar', 'traffic', 'staffing', '').allow(null, ''),
  confidenceMax: Joi.number().min(0).max(1).allow(null),
  provider: Joi.string().max(64).allow('', null),
  summariesLimit: Joi.number().integer().min(10).max(300).allow(null),
});

/** POST /ai/feature-store/park-snapshots/purge — delete park_feature_snapshots_5m rows in [from, to] for active park. */
const parkSnapshotsPurgeBody = Joi.object({
  from: Joi.string().max(64).required(),
  to: Joi.string().max(64).required(),
});

/** POST /ai/feature-store/park-snapshots/bulk-delete — delete many rows by id (same park scope as dashboard). */
const parkSnapshotsBulkDeleteBody = Joi.object({
  ids: Joi.array().items(Joi.string().uuid()).min(1).max(200).required(),
});

const idParams = Joi.object({ id: uuid });
const parkIdParams = Joi.object({ parkId: uuid });
const assetIdParams = Joi.object({ assetId: uuid });

const patchGlobalFactorMerged = Joi.object({ id: uuid }).concat(globalFactorPatch);
const patchMlProfileMerged = Joi.object({ id: uuid }).concat(mlProfilePatch);
const putAssetMlProfileMerged = Joi.object({ assetId: uuid, profileId: uuid });
const patchAssetMlOverridesMerged = Joi.object({ assetId: uuid }).concat(assetMlOverridesPatch);
const patchParkFactorsMerged = Joi.object({ parkId: uuid }).concat(parkFactorsPatchBody);

module.exports = {
  uuid,
  globalFactorBody,
  globalFactorPatch,
  parkFactorsPatchBody,
  mlProfileBody,
  mlProfilePatch,
  assetMlProfilePut,
  assetMlOverridesPatch,
  mlProfilesQuery,
  featureDataQualityQuery,
  parkSnapshotsPurgeBody,
  parkSnapshotsBulkDeleteBody,
  idParams,
  parkIdParams,
  assetIdParams,
  patchGlobalFactorMerged,
  patchMlProfileMerged,
  putAssetMlProfileMerged,
  patchAssetMlOverridesMerged,
  patchParkFactorsMerged,
};
