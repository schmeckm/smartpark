const Joi = require('joi');

const rideStatuses = ['OPEN', 'CLOSED', 'MAINTENANCE'];

const createRideSchema = Joi.object({
  name: Joi.string().trim().required().max(160),
  zoneId: Joi.string().uuid().required(),
  status: Joi.string().valid(...rideStatuses).optional(),
  waitTime: Joi.number().integer().min(0).optional(),
  capacityPerHour: Joi.number().integer().min(0).optional(),
  criticality: Joi.number().integer().min(1).max(5).optional(),
});

const updateRideSchema = Joi.object({
  name: Joi.string().trim().max(160).optional(),
  zoneId: Joi.string().uuid().optional(),
  status: Joi.string().valid(...rideStatuses).optional(),
  waitTime: Joi.number().integer().min(0).optional(),
  capacityPerHour: Joi.number().integer().min(0).optional(),
  criticality: Joi.number().integer().min(1).max(5).optional(),
}).min(1);

module.exports = { createRideSchema, updateRideSchema };
