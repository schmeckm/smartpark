const Joi = require('joi');

const listForecastsQuery = Joi.object({
  horizonMinutes: Joi.number().integer().min(1).max(24 * 60),
  subjectType: Joi.string().valid('PARK', 'ZONE', 'RIDE'),
  targetMetric: Joi.string().valid('CROWD_LEVEL', 'WAIT_TIME', 'STAFF_DEMAND'),
  limit: Joi.number().integer().min(1).max(200).default(100),
});

const recommendationIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const parkForecastParams = Joi.object({
  externalParkId: Joi.string().required(),
});

const parkForecastQuery = Joi.object({
  provider: Joi.string().default('themeparks_wiki'),
  horizon: Joi.number().integer().min(5).max(180).default(60),
  step: Joi.number().integer().min(1).max(30).default(5),
  externalParkId: Joi.string(),
  entityType: Joi.string(),
  limit: Joi.number().integer().min(1).max(500).default(150),
});

const entityForecastParams = Joi.object({
  externalEntityId: Joi.string().required(),
});

const zoneCrowdAccuracyQuery = Joi.object({
  days: Joi.number().integer().min(1).max(90).default(7),
  horizonMinutes: Joi.number().valid(15, 60, 180).default(60),
  limitForecasts: Joi.number().integer().min(50).max(800).optional(),
});

const rideTimeseriesMerged = Joi.object({
  assetId: Joi.string().uuid().required(),
  from: Joi.date().iso().required(),
  to: Joi.date().iso().required(),
  includeContext: Joi.boolean().truthy('true', '1').falsy('false', '0').default(true),
});

const rideCurrentQuery = Joi.object({
  hours: Joi.number().integer().min(1).max(168).default(24),
});

const upsertParkCalendarBody = Joi.object({
  contextDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  isPublicHoliday: Joi.boolean().default(false),
  isSchoolBreak: Joi.boolean().default(false),
  holidayName: Joi.string().trim().max(200).allow(null, ''),
  regionCode: Joi.string().trim().max(32).allow(null, ''),
  source: Joi.string().trim().max(64).default('manual'),
  extra: Joi.object().default({}),
});

const trainingDatasetQuery = Joi.object({
  target: Joi.string()
    .valid('queue_time_15m', 'queue_time_60m', 'queue_time_120m')
    .default('queue_time_15m'),
  limit: Joi.number().integer().min(1).max(2000).default(400),
});

const pipelineRunsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(25),
});

module.exports = {
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
};
