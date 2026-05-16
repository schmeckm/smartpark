const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const { validate, validateMerged, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const {
  listForecastsQuery,
  recommendationIdParams,
  parkForecastParams,
  parkForecastQuery,
  entityForecastParams,
  zoneCrowdAccuracyQuery,
  rideTimeseriesMerged,
  rideCurrentQuery,
  upsertParkCalendarBody,
  trainingDatasetQuery,
  pipelineRunsQuery,
} = require('../../validators/ai.validators');
const aiController = require('../../controllers/ai.controller');
const mlAiController = require('../../controllers/ml-ai.controller');
const aiStudioController = require('../../controllers/ai-studio.controller');
const {
  globalFactorBody,
  patchGlobalFactorMerged,
  idParams,
  parkIdParams,
  patchParkFactorsMerged,
  mlProfilesQuery,
  mlProfileBody,
  patchMlProfileMerged,
  putAssetMlProfileMerged,
  patchAssetMlOverridesMerged,
  assetIdParams,
  featureDataQualityQuery,
  parkSnapshotsPurgeBody,
  parkSnapshotsBulkDeleteBody,
} = require('../../validators/ml-ai.validators');
const {
  trainBody,
  datasetStatsQuery,
  listModelsQuery,
  predictBody,
  runtimeResolutionBody,
  modelIdParams,
  modelDeleteMerged,
  activateMerged,
  featureDraftQuery,
  featureDraftPutBody,
  validateFeaturesBody,
  batchTrainBody,
  batchApplyBody,
} = require('../../validators/ai-studio.validators');
const { registerAiMlRoutes } = require('./ai-ml.routes');
const { registerAiPredictionTraceRoutes } = require('./ai-prediction-traces.routes');
const { registerAiForecastAccuracyRoutes } = require('./ai-forecast-accuracy.routes');

/**
 * Register authenticated AI routes on the v1 router (full paths under /ai/…).
 * @param {import('express').Router} v1Router
 */
function registerProtectedAiRoutes(v1Router) {
  v1Router.get('/ai/pipeline-health', requirePermission('ai', 'read'), aiController.getPipelineHealth);
  v1Router.get(
    '/ai/pipeline-runs',
    requirePermission('ai', 'read'),
    validate(pipelineRunsQuery, 'query'),
    aiController.listPipelineRuns
  );
  v1Router.get(
    '/ai/forecasts',
    requirePermission('ai', 'read'),
    validate(listForecastsQuery, 'query'),
    aiController.listForecasts
  );
  v1Router.get('/ai/insights/summary', requirePermission('ai', 'read'), aiController.insightsSummary);

  v1Router.get('/ai/studio/catalog', requirePermission('ai', 'read'), aiStudioController.getCatalog);
  v1Router.get(
    '/ai/studio/dataset-stats',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(datasetStatsQuery),
    aiStudioController.getDatasetStats
  );
  v1Router.get(
    '/ai/studio/models',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(listModelsQuery),
    aiStudioController.listModels
  );
  /** Static paths must be registered before `/ai/studio/models/:id` or Express treats e.g. `batch-train-status` as a UUID param (422). */
  v1Router.get(
    '/ai/studio/models/batch-train-status',
    requirePermission('ai', 'read'),
    requireParkContext,
    aiStudioController.getBatchTrainStatus
  );
  v1Router.post(
    '/ai/studio/models/batch-train-rides',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(batchTrainBody),
    aiStudioController.postBatchTrainRides
  );
  v1Router.post(
    '/ai/studio/models/batch-apply',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(batchApplyBody),
    aiStudioController.postBatchApply
  );
  v1Router.get(
    '/ai/studio/models/:id',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(modelIdParams, 'params'),
    aiStudioController.getOneModel
  );
  v1Router.post(
    '/ai/studio/models/train',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(trainBody),
    aiStudioController.postTrain
  );
  v1Router.post(
    '/ai/studio/models/validate-features',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(validateFeaturesBody),
    aiStudioController.postValidateFeatures
  );
  v1Router.patch(
    '/ai/studio/models/:id/activate',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMergedParamsBody(activateMerged),
    aiStudioController.patchActivate
  );
  v1Router.delete(
    '/ai/studio/models/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMerged(modelDeleteMerged),
    aiStudioController.deleteArchiveModel
  );
  v1Router.post(
    '/ai/studio/models/:id/restore',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(modelIdParams, 'params'),
    aiStudioController.postRestoreModel
  );
  v1Router.post(
    '/ai/studio/predict',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictBody),
    aiStudioController.postPredict
  );
  v1Router.post(
    '/ai/studio/runtime-resolution',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(runtimeResolutionBody),
    aiStudioController.postRuntimeResolution
  );
  v1Router.get(
    '/ai/studio/feature-drafts',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(featureDraftQuery),
    aiStudioController.getFeatureDraft
  );
  v1Router.put(
    '/ai/studio/feature-drafts',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(featureDraftPutBody),
    aiStudioController.putFeatureDraft
  );
  v1Router.get(
    '/ai/forecast-accuracy/zone-crowd',
    requirePermission('ai', 'read'),
    validate(zoneCrowdAccuracyQuery, 'query'),
    aiController.zoneCrowdForecastAccuracy
  );
  v1Router.get(
    '/ai/timeseries/rides-current',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(rideCurrentQuery, 'query'),
    aiController.rideCurrentWaits
  );
  v1Router.get(
    '/ai/training-dataset',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(trainingDatasetQuery, 'query'),
    aiController.trainingDataset
  );
  v1Router.get(
    '/ai/timeseries/rides/:assetId',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(rideTimeseriesMerged),
    aiController.rideWaitTimeseries
  );
  v1Router.post(
    '/ai/timeseries/calendar',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(upsertParkCalendarBody),
    aiController.upsertParkCalendarContext
  );
  v1Router.get(
    '/ai/parks/:externalParkId/forecast/summary',
    requirePermission('ai', 'read'),
    validate(parkForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.parkForecastSummary
  );
  v1Router.get(
    '/ai/parks/:externalParkId/forecast/series',
    requirePermission('ai', 'read'),
    validate(parkForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.parkForecastSeries
  );
  v1Router.get(
    '/ai/parks/:externalParkId/forecast/explanation',
    requirePermission('ai', 'read'),
    validate(parkForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.parkForecastExplanation
  );
  v1Router.get(
    '/ai/entities/:externalEntityId/forecast/summary',
    requirePermission('ai', 'read'),
    validate(entityForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.entityForecastSummary
  );
  v1Router.get(
    '/ai/entities/:externalEntityId/forecast/explanation',
    requirePermission('ai', 'read'),
    validate(entityForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.entityForecastExplanation
  );
  v1Router.get(
    '/ai/parks/:externalParkId/entities/forecast/summary',
    requirePermission('ai', 'read'),
    validate(parkForecastParams, 'params'),
    validate(parkForecastQuery, 'query'),
    aiController.parkEntityForecastSummaries
  );
  v1Router.get('/ai/factors/config', requirePermission('ai', 'read'), aiController.getFactorConfigs);

  v1Router.get('/ai/global-factors', requirePermission('ai', 'read'), mlAiController.listGlobalFactors);
  v1Router.post(
    '/ai/global-factors',
    requirePermission('ai', 'refresh'),
    validate(globalFactorBody),
    mlAiController.postGlobalFactor
  );
  v1Router.patch(
    '/ai/global-factors/:id',
    requirePermission('ai', 'refresh'),
    validateMergedParamsBody(patchGlobalFactorMerged),
    mlAiController.patchGlobalFactor
  );
  v1Router.delete(
    '/ai/global-factors/:id',
    requirePermission('ai', 'refresh'),
    validateMerged(idParams),
    mlAiController.deleteGlobalFactor
  );

  v1Router.get(
    '/ai/parks/:parkId/factors',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(parkIdParams),
    mlAiController.listParkFactors
  );
  v1Router.patch(
    '/ai/parks/:parkId/factors',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMergedParamsBody(patchParkFactorsMerged),
    mlAiController.patchParkFactors
  );

  v1Router.get(
    '/ai/ml-profiles',
    requirePermission('ai', 'read'),
    validateMerged(mlProfilesQuery),
    mlAiController.listMlProfiles
  );
  v1Router.post(
    '/ai/ml-profiles',
    requirePermission('ai', 'refresh'),
    validate(mlProfileBody),
    mlAiController.postMlProfile
  );
  v1Router.patch(
    '/ai/ml-profiles/:id',
    requirePermission('ai', 'refresh'),
    validateMergedParamsBody(patchMlProfileMerged),
    mlAiController.patchMlProfile
  );
  v1Router.delete(
    '/ai/ml-profiles/:id',
    requirePermission('ai', 'refresh'),
    validateMerged(idParams),
    mlAiController.deleteMlProfile
  );

  v1Router.put(
    '/ai/assets/:assetId/ml-profile',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMergedParamsBody(putAssetMlProfileMerged),
    mlAiController.putAssetMlProfile
  );
  v1Router.patch(
    '/ai/assets/:assetId/ml-overrides',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMergedParamsBody(patchAssetMlOverridesMerged),
    mlAiController.patchAssetMlOverrides
  );
  v1Router.get(
    '/ai/assets/:assetId/effective-ml-config',
    requirePermission('ai', 'read'),
    requireParkContext,
    validateMerged(assetIdParams),
    mlAiController.getEffectiveMlConfig
  );
  v1Router.get(
    '/ai/feature-store/monitor',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlAiController.getFeatureStoreMonitor
  );
  v1Router.get(
    '/ai/feature-data-quality',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(featureDataQualityQuery, 'query'),
    mlAiController.getFeatureDataQuality
  );
  v1Router.post(
    '/ai/feature-store/park-snapshots/purge',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(parkSnapshotsPurgeBody),
    mlAiController.purgeParkFeatureSnapshots
  );
  v1Router.post(
    '/ai/feature-store/park-snapshots/bulk-delete',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(parkSnapshotsBulkDeleteBody),
    mlAiController.bulkDeleteParkFeatureSnapshots
  );
  v1Router.delete(
    '/ai/feature-store/park-snapshots/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validate(idParams, 'params'),
    mlAiController.deleteParkFeatureSnapshot
  );

  v1Router.get('/ai/recommendations/scored', requirePermission('ai', 'read'), aiController.listScoredRecommendations);
  v1Router.get(
    '/ai/recommendations/scoring-summary',
    requirePermission('ai', 'read'),
    aiController.recommendationScoringSummary
  );
  v1Router.post(
    '/ai/recommendations/score',
    requireAnyPermission(['ai', 'refresh'], ['recommendations', 'update']),
    aiController.postScoreAllRecommendations
  );
  v1Router.post(
    '/ai/recommendations/:id/score',
    requireAnyPermission(['ai', 'refresh'], ['recommendations', 'update']),
    validate(recommendationIdParams, 'params'),
    aiController.postScoreOneRecommendation
  );
  v1Router.get(
    '/ai/recommendations/:id/explanation',
    requirePermission('ai', 'read'),
    validate(recommendationIdParams, 'params'),
    aiController.getRecommendationExplanation
  );

  registerAiMlRoutes(v1Router);
  registerAiPredictionTraceRoutes(v1Router);
  registerAiForecastAccuracyRoutes(v1Router);
}

module.exports = { registerProtectedAiRoutes, aiController };
