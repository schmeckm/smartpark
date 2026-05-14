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
  modelIdParams,
  activateMerged,
  featureDraftQuery,
  featureDraftPutBody,
} = require('../../validators/ai-studio.validators');
const mlPredictionController = require('../../controllers/ml-prediction.controller');
const mlPredictionTraceController = require('../../controllers/ml-prediction-trace.controller');
const mlForecastAccuracyController = require('../../controllers/ml-forecast-accuracy.controller');
const mlFeatureStoreReadinessController = require('../../controllers/ml-feature-store-readiness.controller');
const mlFeatureStoreSnapshotDebugController = require('../../controllers/ml-feature-store-snapshot-debug.controller');
const {
  predictRideMerged,
  rideIdPathParams,
  trainGlobalWaitBody,
  datasetStatsQuery: mlRideDatasetStatsQuery,
  parkMlSummaryQuery,
  mlPredictionTracesQuery,
  predictionTraceIdParams,
  mlForecastAccuracyQuery,
  mlForecastAccuracyLogIdParams,
  mlFeatureStoreReadinessQuery,
  mlFeatureStoreSnapshotDebugQuery,
} = require('../../validators/ml-wait-predict.validators');
const { requireMlProfileEnabled } = require('../../middleware/ml-profile-enabled.middleware');
const mlMetadataProfileController = require('../../controllers/ml-metadata-profile.controller');
const {
  parkListQuery,
  rideListQuery,
  parkIdParams: mlMetadataParkProfileIdParams,
  rideIdParams: mlMetadataRideProfileIdParams,
  parkProfileBody,
  parkProfilePutMerged,
  rideProfileBody,
  rideProfilePutMerged,
} = require('../../validators/ml-metadata-profile.validators');

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
  v1Router.patch(
    '/ai/studio/models/:id/activate',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    validateMergedParamsBody(activateMerged),
    aiStudioController.patchActivate
  );
  v1Router.post(
    '/ai/studio/predict',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictBody),
    aiStudioController.postPredict
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

  /**
   * ML wait-time prediction surface — historical mount under `/ml/*` is kept
   * for backwards compatibility (admin-dashboard still calls `/ml/predict/...`)
   * and a parallel canonical mount under `/ai/ml/*` was added in Phase B5
   * because every other AI endpoint lives under `/ai/*`. Both registrations
   * share the same handlers, middleware, validators, and RBAC; the only
   * difference is the path. The `/ml/*` paths are marked `deprecated: true`
   * in OpenAPI with migration descriptions pointing at `/ai/ml/*`.
   *
   * Removal of `/ml/*` is a future major-version action; until then both
   * surfaces stay live.
   */
  const mlSurfaceRegistrations = [
    {
      method: 'get',
      path: '/predict/rides/:rideId',
      handlers: [
        requirePermission('ai', 'read'),
        requireParkContext,
        validateMerged(predictRideMerged),
        mlPredictionController.getPredictRide,
      ],
    },
    {
      method: 'get',
      path: '/predict/park-summary',
      handlers: [
        requirePermission('ai', 'read'),
        requireParkContext,
        validate(parkMlSummaryQuery, 'query'),
        mlPredictionController.getParkMlSummary,
      ],
    },
    {
      method: 'get',
      path: '/dataset/rides',
      handlers: [
        requirePermission('ai', 'read'),
        requireParkContext,
        validate(mlRideDatasetStatsQuery, 'query'),
        mlPredictionController.getRideDatasetStats,
      ],
    },
    {
      method: 'post',
      path: '/train/wait-time/global',
      handlers: [
        requirePermission('ai', 'refresh'),
        requireParkContext,
        validate(trainGlobalWaitBody),
        mlPredictionController.postTrainGlobalWait,
      ],
    },
    {
      method: 'post',
      path: '/train/wait-time/rides/:rideId',
      handlers: [
        requirePermission('ai', 'refresh'),
        requireParkContext,
        validate(rideIdPathParams, 'params'),
        mlPredictionController.postTrainRideWait,
      ],
    },
  ];

  for (const reg of mlSurfaceRegistrations) {
    // Legacy `/ml/...` mount (deprecated, see OpenAPI).
    v1Router[reg.method](`/ml${reg.path}`, ...reg.handlers);
    // Canonical `/ai/ml/...` mount (Phase B5).
    v1Router[reg.method](`/ai/ml${reg.path}`, ...reg.handlers);
  }

  v1Router.get(
    '/ai/ml/prediction-traces',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlPredictionTracesQuery, 'query'),
    mlPredictionTraceController.getMlPredictionTraces
  );
  v1Router.get(
    '/ai/ml/prediction-traces/filter-options',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlPredictionTraceController.getMlPredictionTraceFilterOptions
  );
  v1Router.get(
    '/ai/ml/prediction-traces/:predictionId/coefficients',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictionTraceIdParams, 'params'),
    mlPredictionTraceController.getMlPredictionTraceCoefficients
  );
  v1Router.get(
    '/ai/ml/prediction-traces/:predictionId',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictionTraceIdParams, 'params'),
    mlPredictionTraceController.getMlPredictionTraceById
  );

  v1Router.get(
    '/ai/ml/forecast-accuracy/kpis',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyQuery, 'query'),
    mlForecastAccuracyController.getMlForecastAccuracyKpis
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/model-win-rates',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlForecastAccuracyController.getMlModelWinRateStats
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/retro-lookback',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlForecastAccuracyController.getMlRetroLookback
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/:id',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyLogIdParams, 'params'),
    mlForecastAccuracyController.getMlForecastAccuracyById
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyQuery, 'query'),
    mlForecastAccuracyController.getMlForecastAccuracyLogs
  );

  v1Router.get(
    '/ai/ml/feature-store-readiness',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlFeatureStoreReadinessQuery, 'query'),
    mlFeatureStoreReadinessController.getMlFeatureStoreReadiness
  );

  v1Router.get(
    '/ai/ml/feature-store-snapshot-debug',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlFeatureStoreSnapshotDebugQuery, 'query'),
    mlFeatureStoreSnapshotDebugController.getMlFeatureStoreSnapshotDebug
  );

  /* Phase 3 — ML metadata profiles (ML_PROFILE_ENABLED) */
  v1Router.get(
    '/ai/ml/park-profiles',
    requirePermission('ai', 'read'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(parkListQuery, 'query'),
    mlMetadataProfileController.getParkProfiles
  );
  v1Router.get(
    '/ai/ml/park-profiles/:id',
    requirePermission('ai', 'read'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(mlMetadataParkProfileIdParams, 'params'),
    mlMetadataProfileController.getParkProfileOne
  );
  v1Router.post(
    '/ai/ml/park-profiles',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(parkProfileBody, 'body'),
    mlMetadataProfileController.postParkProfile
  );
  v1Router.put(
    '/ai/ml/park-profiles/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validateMergedParamsBody(parkProfilePutMerged),
    mlMetadataProfileController.putParkProfile
  );

  v1Router.get(
    '/ai/ml/ride-profiles',
    requirePermission('ai', 'read'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(rideListQuery, 'query'),
    mlMetadataProfileController.getRideProfiles
  );
  v1Router.get(
    '/ai/ml/ride-profiles/:id',
    requirePermission('ai', 'read'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(mlMetadataRideProfileIdParams, 'params'),
    mlMetadataProfileController.getRideProfileOne
  );
  v1Router.post(
    '/ai/ml/ride-profiles',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(rideProfileBody, 'body'),
    mlMetadataProfileController.postRideProfile
  );
  v1Router.put(
    '/ai/ml/ride-profiles/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validateMergedParamsBody(rideProfilePutMerged),
    mlMetadataProfileController.putRideProfile
  );
}

module.exports = { registerProtectedAiRoutes, aiController };
