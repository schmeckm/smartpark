'use strict';

const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate, validateMerged, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const mlPredictionController = require('../../controllers/ml-prediction.controller');
const mlFeatureStoreReadinessController = require('../../controllers/ml-feature-store-readiness.controller');
const mlFeatureStoreSnapshotDebugController = require('../../controllers/ml-feature-store-snapshot-debug.controller');
const {
  predictRideMerged,
  rideIdPathParams,
  trainGlobalWaitBody,
  datasetStatsQuery: mlRideDatasetStatsQuery,
  parkMlSummaryQuery,
  mlFeatureStoreReadinessQuery,
  mlFeatureStoreSnapshotDebugQuery,
} = require('../../validators/ml-wait-predict.validators');
const { requireMlProfileEnabled } = require('../../middleware/ml-profile-enabled.middleware');
const mlMetadataProfileController = require('../../controllers/ml-metadata-profile.controller');
const mlRegistryGovernanceController = require('../../controllers/ml-registry-governance.controller');
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
const { modelDeleteMerged: mlRegistryEntryDeleteMerged } = require('../../validators/ai-studio.validators');

/**
 * ML wait-time prediction — legacy `/ml/*` plus canonical `/ai/ml/*` (Phase B5), feature-store
 * diagnostics, and ML metadata profiles.
 *
 * @param {import('express').Router} v1Router
 */
function registerAiMlRoutes(v1Router) {
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
    v1Router[reg.method](`/ml${reg.path}`, ...reg.handlers);
    v1Router[reg.method](`/ai/ml${reg.path}`, ...reg.handlers);
  }

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
  v1Router.delete(
    '/ai/ml/park-profiles/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(mlMetadataParkProfileIdParams, 'params'),
    mlMetadataProfileController.deleteParkProfileArchive
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
  v1Router.delete(
    '/ai/ml/ride-profiles/:id',
    requirePermission('ai', 'refresh'),
    requireParkContext,
    requireMlProfileEnabled,
    validate(mlMetadataRideProfileIdParams, 'params'),
    mlMetadataProfileController.deleteRideProfileArchive
  );

  v1Router.delete(
    '/ai/ml/registry/entries/:id',
    requirePermission('ai', 'refresh'),
    validateMerged(mlRegistryEntryDeleteMerged),
    mlRegistryGovernanceController.deleteArchiveRegistryEntry
  );
}

module.exports = { registerAiMlRoutes };
