const Joi = require('joi');
const {
  ENTITY_TYPES,
  STUDIO_FEATURES,
  TARGETS_BY_ENTITY,
  MANUAL_ALGORITHMS,
} = require('../services/ai-studio.service');
const { FEATURE_STORE_TRAIN_FEATURES } = require('../services/ai-studio-dataset.service');

const uuid = Joi.string().uuid();
const entityType = Joi.string()
  .valid(...ENTITY_TYPES)
  .required();
const featureList = Joi.array()
  .items(Joi.string().valid(...STUDIO_FEATURES))
  .min(1)
  .required();

const trainBody = Joi.object({
  dataset: Joi.string().valid('FEATURE_STORE', 'SANDBOX').default('SANDBOX'),
  horizonMinutes: Joi.when('dataset', {
    is: 'FEATURE_STORE',
    then: Joi.number().integer().valid(15).default(15),
    otherwise: Joi.number().integer().optional(),
  }),
  entityType,
  entityId: Joi.when('dataset', {
    is: 'FEATURE_STORE',
    then: uuid.required(),
    otherwise: uuid.allow(null).optional(),
  }),
  targetVariable: Joi.string().max(64).required(),
  features: featureList,
  strategy: Joi.string().valid('AUTO', 'MANUAL').default('MANUAL'),
  algorithm: Joi.string()
    .valid(...MANUAL_ALGORITHMS)
    .allow(null, '')
    .optional(),
})
  .custom((v, helpers) => {
    const allowed = TARGETS_BY_ENTITY[v.entityType];
    if (!allowed || !allowed.includes(v.targetVariable)) {
      return helpers.error('any.invalid', { message: 'targetVariable not valid for entityType' });
    }

    if (v.dataset === 'FEATURE_STORE') {
      if (v.entityType !== 'RIDE') {
        return helpers.error('any.invalid', { message: 'FEATURE_STORE requires entityType RIDE' });
      }
      if (v.targetVariable !== 'wait_time_plus_15') {
        return helpers.error('any.invalid', { message: 'FEATURE_STORE Phase 1 requires wait_time_plus_15' });
      }
      for (const f of v.features) {
        if (!FEATURE_STORE_TRAIN_FEATURES.includes(f)) {
          return helpers.error('any.invalid', {
            message: `FEATURE_STORE invalid feature "${f}". Allowed: ${FEATURE_STORE_TRAIN_FEATURES.join(', ')}`,
          });
        }
      }
      return v;
    }

    if (v.strategy === 'MANUAL' && (!v.algorithm || v.algorithm === '')) {
      return helpers.error('any.invalid', { message: 'algorithm required for MANUAL strategy (SANDBOX)' });
    }
    return v;
  });

const datasetStatsQuery = Joi.object({
  entityType: entityType.required(),
  entityId: uuid.allow('').optional(),
  dataset: Joi.string().valid('FEATURE_STORE', 'SANDBOX').optional(),
});

const listModelsQuery = Joi.object({
  entityType: Joi.string().valid(...ENTITY_TYPES).optional(),
  targetVariable: Joi.string().max(64).optional(),
  modelScope: Joi.string().valid('entity', 'category', 'park').optional(),
  activeOnly: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),
});

const predictBody = Joi.object({
  entityType,
  entityId: uuid.allow(null).optional(),
  targetVariable: Joi.string().max(64).required(),
  featureSource: Joi.string().valid('manual', 'latest_snapshot').default('manual'),
  features: Joi.object().pattern(Joi.string(), Joi.number()).default({}),
}).custom((v, helpers) => {
  const allowed = TARGETS_BY_ENTITY[v.entityType];
  if (!allowed || !allowed.includes(v.targetVariable)) {
    return helpers.error('any.invalid', { message: 'targetVariable not valid for entityType' });
  }
  if (v.featureSource === 'latest_snapshot') {
    if (v.entityType !== 'RIDE') {
      return helpers.error('any.invalid', { message: 'latest_snapshot supports RIDE only (Phase 1)' });
    }
    if (!v.entityId || String(v.entityId).trim() === '') {
      return helpers.error('any.invalid', { message: 'entityId required for latest_snapshot' });
    }
  }
  return v;
});

const modelIdParams = Joi.object({
  id: uuid.required(),
});

const activateBody = Joi.object({
  activeFlag: Joi.boolean().required(),
});

const activateMerged = Joi.object({
  id: uuid.required(),
  activeFlag: Joi.boolean().required(),
});

const mlStudioEntityType = Joi.string().valid('ride', 'park_asset').required();

const featureDraftQuery = Joi.object({
  entityType: mlStudioEntityType,
  entityId: uuid.required(),
  datasetScope: Joi.string().valid('single_asset').default('single_asset'),
});

const featureDraftPutBody = Joi.object({
  entityType: mlStudioEntityType,
  entityId: uuid.required(),
  datasetScope: Joi.string().valid('single_asset').default('single_asset'),
  selectedSignalKeys: Joi.array()
    .items(Joi.string().trim().min(1).max(160))
    .max(200)
    .default([]),
});

module.exports = {
  trainBody,
  datasetStatsQuery,
  listModelsQuery,
  predictBody,
  modelIdParams,
  activateBody,
  activateMerged,
  featureDraftQuery,
  featureDraftPutBody,
};
