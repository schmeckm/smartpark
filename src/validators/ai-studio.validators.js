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

const featureStoreTrainingOptions = Joi.object({
  ridgeLambda: Joi.number().min(1e-12).max(1).optional(),
  randomForest: Joi.object({
    nTrees: Joi.number().integer().min(8).max(256).optional(),
    maxDepth: Joi.number().integer().min(2).max(24).optional(),
    minLeaf: Joi.number().integer().min(2).max(200).optional(),
    maxSplitCandidates: Joi.number().integer().min(4).max(80).optional(),
  })
    .optional()
    .unknown(false),
  gradientBoosting: Joi.object({
    rounds: Joi.number().integer().min(8).max(400).optional(),
    shrinkage: Joi.number().min(0.01).max(0.5).optional(),
    treeDepth: Joi.number().integer().min(1).max(12).optional(),
    minLeaf: Joi.number().integer().min(2).max(200).optional(),
    maxSplitCandidates: Joi.number().integer().min(4).max(80).optional(),
  })
    .optional()
    .unknown(false),
  neuralNetwork: Joi.object({
    hidden: Joi.number().integer().min(8).max(128).optional(),
    epochs: Joi.number().integer().min(50).max(2000).optional(),
    lr: Joi.number().min(0.001).max(0.5).optional(),
  })
    .optional()
    .unknown(false),
})
  .optional()
  .unknown(false);

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
  features: Joi.when('dataset', {
    is: 'FEATURE_STORE',
    then: Joi.array()
      .items(Joi.string().valid(...FEATURE_STORE_TRAIN_FEATURES))
      .min(1)
      .required(),
    otherwise: Joi.array()
      .items(Joi.string().valid(...STUDIO_FEATURES))
      .min(1)
      .required(),
  }),
  strategy: Joi.string().valid('AUTO', 'MANUAL').default('MANUAL'),
  algorithm: Joi.string()
    .valid(...MANUAL_ALGORITHMS)
    .allow(null, '')
    .optional(),
  featureStoreTrainingOptions: Joi.when('dataset', {
    is: 'FEATURE_STORE',
    then: featureStoreTrainingOptions.optional(),
    otherwise: featureStoreTrainingOptions.forbidden(),
  }),
  /** Batch training only: stored on FEATURE_STORE model_payload for batch-apply activation. */
  batchTrainId: Joi.when('dataset', {
    is: 'FEATURE_STORE',
    then: Joi.string().uuid().optional(),
    otherwise: Joi.forbidden(),
  }),
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
        return helpers.error('any.invalid', { message: 'FEATURE_STORE requires wait_time_plus_15' });
      }
      if (v.strategy === 'MANUAL' && (!v.algorithm || v.algorithm === '')) {
        return helpers.error('any.invalid', { message: 'algorithm required for MANUAL strategy (FEATURE_STORE)' });
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
  entityId: Joi.alternatives().try(uuid, Joi.string().allow('')).optional(),
  dataset: Joi.string().valid('FEATURE_STORE', 'SANDBOX').optional(),
})
  .unknown(false)
  .messages({ 'object.unknown': 'Unknown query parameter' });

const listModelsQuery = Joi.object({
  entityType: Joi.string().valid(...ENTITY_TYPES).optional(),
  targetVariable: Joi.string().max(64).optional(),
  modelScope: Joi.string().valid('entity', 'category', 'park').optional(),
  activeOnly: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
  includeArchived: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
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

/** POST /ai/studio/runtime-resolution — same scope rules as predict; no feature payload. */
const runtimeResolutionBody = Joi.object({
  entityType,
  entityId: uuid.allow(null).optional(),
  targetVariable: Joi.string().max(64).required(),
}).custom((v, helpers) => {
  const allowed = TARGETS_BY_ENTITY[v.entityType];
  if (!allowed || !allowed.includes(v.targetVariable)) {
    return helpers.error('any.invalid', { message: 'targetVariable not valid for entityType' });
  }
  return v;
});

const modelIdParams = Joi.object({
  id: uuid.required(),
});

/** DELETE /ai/studio/models/:id — optional `permanent=true` removes DB row after governance archive. */
const modelDeleteMerged = Joi.object({
  id: uuid.required(),
  permanent: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
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

const validateFeaturesBody = Joi.object({
  entityType: Joi.string().valid('RIDE').required(),
  entityId: uuid.required(),
  features: Joi.array()
    .items(Joi.string().valid(...FEATURE_STORE_TRAIN_FEATURES))
    .max(FEATURE_STORE_TRAIN_FEATURES.length)
    .optional(),
}).unknown(false);

const batchTrainBody = Joi.object({
  strategy: Joi.string().valid('AUTO', 'MANUAL').default('AUTO'),
  algorithm: Joi.string()
    .valid(...MANUAL_ALGORITHMS)
    .allow(null, '')
    .optional(),
  features: Joi.array()
    .items(Joi.string().valid(...FEATURE_STORE_TRAIN_FEATURES))
    .min(1)
    .max(FEATURE_STORE_TRAIN_FEATURES.length)
    .optional(),
  featureStoreTrainingOptions: featureStoreTrainingOptions.optional(),
})
  .unknown(false)
  .custom((v, helpers) => {
    if (v.strategy === 'MANUAL' && (!v.algorithm || v.algorithm === '')) {
      return helpers.error('any.invalid', { message: 'algorithm required for MANUAL batch strategy' });
    }
    return v;
  });

const batchApplyBody = Joi.object({
  batchId: uuid.required(),
}).unknown(false);

module.exports = {
  trainBody,
  datasetStatsQuery,
  listModelsQuery,
  predictBody,
  runtimeResolutionBody,
  modelIdParams,
  modelDeleteMerged,
  activateBody,
  activateMerged,
  featureDraftQuery,
  featureDraftPutBody,
  validateFeaturesBody,
  batchTrainBody,
  batchApplyBody,
};
