const Joi = require('joi');

const predictRideMerged = Joi.object({
  rideId: Joi.string().uuid().required(),
  horizon: Joi.string()
    .pattern(/^[\d,\s]+$/)
    .optional()
    .default('15,30,60'),
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

module.exports = {
  predictRideMerged,
  rideIdPathParams,
  trainGlobalWaitBody,
  datasetStatsQuery,
  parkMlSummaryQuery,
};
