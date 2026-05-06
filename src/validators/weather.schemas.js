const Joi = require('joi');

const createWeatherObservationSchema = Joi.object({
  condition: Joi.string().trim().required().max(64),
  temperatureC: Joi.number().allow(null).optional(),
  rainMm: Joi.number().min(0).allow(null).optional(),
  windKmh: Joi.number().min(0).allow(null).optional(),
  source: Joi.string().trim().max(120).optional(),
  parkId: Joi.string().trim().max(120).optional().allow(''),
  internalParkId: Joi.string().uuid().optional().allow(null),
  observedAt: Joi.date().iso().optional(),
  timestamp: Joi.date().iso().optional(),
});

module.exports = { createWeatherObservationSchema };
