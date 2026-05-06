const Joi = require('joi');

const zoneStatuses = ['ACTIVE', 'LIMITED', 'CLOSED', 'EVACUATION'];

const createZoneSchema = Joi.object({
  name: Joi.string().trim().required().max(160),
  type: Joi.string().trim().required().max(80),
  currentCrowdLevel: Joi.number().integer().min(0).optional(),
  forecastCrowdLevel: Joi.number().integer().min(0).optional(),
  maxCapacity: Joi.number().integer().positive().required(),
  status: Joi.string().valid(...zoneStatuses).optional(),
  adjacentZoneIds: Joi.array().items(Joi.string().uuid()).optional().default([]),
});

const updateZoneSchema = Joi.object({
  name: Joi.string().trim().max(160).optional(),
  type: Joi.string().trim().max(80).optional(),
  currentCrowdLevel: Joi.number().integer().min(0).optional(),
  forecastCrowdLevel: Joi.number().integer().min(0).optional(),
  maxCapacity: Joi.number().integer().positive().optional(),
  status: Joi.string().valid(...zoneStatuses).optional(),
  adjacentZoneIds: Joi.array().items(Joi.string().uuid()).optional(),
}).min(1);

module.exports = { createZoneSchema, updateZoneSchema };
