const Joi = require('joi');

const predictRideMerged = Joi.object({
  rideId: Joi.string().uuid().required(),
  horizon: Joi.string()
    .pattern(/^[\d,\s]+$/)
    .optional()
    .default('15,30,60'),
  explain: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('1', '0', 'true', 'false', 'TRUE', 'FALSE'))
    .optional(),
});

const rideIdPathParams = Joi.object({
  rideId: Joi.string().uuid().required(),
});

const trainGlobalWaitBody = Joi.object({
  rowLimit: Joi.number().integer().min(200).max(50000).optional(),
});

const datasetStatsQuery = Joi.object({
  rideId: Joi.string().uuid().optional(),
  from: Joi.string().optional(),
  to: Joi.string().optional(),
  rowLimit: Joi.number().integer().min(100).max(50000).optional(),
});

const parkMlSummaryQuery = Joi.object({
  zoneId: Joi.string().uuid().optional(),
  criticalAtMinutes: Joi.number().min(15).max(180).optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).max(500).optional(),
});

const mlPredictionTracesQuery = Joi.object({
  rideId: Joi.string().uuid().optional(),
  modelName: Joi.string().max(160).optional(),
  targetName: Joi.string().max(160).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),
});

const predictionTraceIdParams = Joi.object({
  predictionId: Joi.string().uuid().required(),
});

const mlForecastAccuracyQuery = Joi.object({
  rideId: Joi.string().uuid().optional(),
  modelName: Joi.string().max(160).optional(),
  targetName: Joi.string().max(160).optional(),
  horizonMinutes: Joi.number().integer().min(0).max(24 * 60).optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),
  comparableOnly: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('true', 'false', '1', '0'), Joi.number().valid(0, 1))
    .optional(),
});

const mlForecastAccuracyLogIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const mlFeatureStoreReadinessQuery = Joi.object({
  rideId: Joi.string().uuid().optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
});

const mlFeatureStoreSnapshotDebugQuery = Joi.object({
  rideId: Joi.string().uuid().required(),
  windowHours: Joi.number().integer().min(1).max(72).optional(),
});

module.exports = {
  predictRideMerged,
  rideIdPathParams,
  trainGlobalWaitBody,
  datasetStatsQuery,
  parkMlSummaryQuery,
  mlPredictionTracesQuery,
  predictionTraceIdParams,
  mlForecastAccuracyQuery,
  mlForecastAccuracyLogIdParams,
  mlFeatureStoreReadinessQuery,
  mlFeatureStoreSnapshotDebugQuery,
};
