const Joi = require('joi');

const eventTypes = ['CROWD_SPIKE', 'CROWD_DROP', 'RIDE_CLOSURE', 'WEATHER_IMPACT'];

const createEventSchema = Joi.object({
  zoneId: Joi.string().uuid().required(),
  eventType: Joi.string().valid(...eventTypes).required(),
  crowdLevel: Joi.number().integer().min(0).required(),
  severity: Joi.number().integer().min(1).max(5).optional(),
  source: Joi.string().trim().max(120).optional(),
  syncZone: Joi.boolean().optional(),
  weatherCondition: Joi.string().trim().max(80).optional(),
});

module.exports = { createEventSchema };
