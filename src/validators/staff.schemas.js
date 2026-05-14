const Joi = require('joi');

const roles = ['FOOD_SERVICE', 'RIDE_OPERATOR', 'CLEANING', 'SECURITY', 'GUEST_SERVICE'];

const staffImportItemSchema = Joi.object({
  id: Joi.string().uuid().optional(),
  employeeNumber: Joi.string().trim().max(64).allow(null, '').optional(),
  firstName: Joi.string().trim().required().max(80),
  lastName: Joi.string().trim().required().max(80),
  role: Joi.string()
    .valid(...roles)
    .required(),
  currentZoneId: Joi.string().uuid().allow(null).optional(),
  currentRideId: Joi.string().uuid().allow(null).optional(),
  supervisorId: Joi.string().uuid().allow(null).optional(),
  available: Joi.boolean().optional(),
  skillLevel: Joi.number().integer().min(1).max(5).optional(),
}).unknown(true);

const staffImportBody = Joi.object({
  schemaVersion: Joi.number().integer().optional(),
  items: Joi.array().items(staffImportItemSchema).required(),
});

const createStaffSchema = Joi.object({
  firstName: Joi.string().trim().required().max(80),
  lastName: Joi.string().trim().required().max(80),
  employeeNumber: Joi.string().trim().max(64).allow(null, '').optional(),
  role: Joi.string().valid(...roles).required(),
  currentZoneId: Joi.string().uuid().allow(null).optional(),
  currentRideId: Joi.string().uuid().allow(null).optional(),
  supervisorId: Joi.string().uuid().allow(null).optional(),
  available: Joi.boolean().optional(),
  skillLevel: Joi.number().integer().min(1).max(5).optional(),
});

const updateStaffSchema = Joi.object({
  firstName: Joi.string().trim().max(80).optional(),
  lastName: Joi.string().trim().max(80).optional(),
  employeeNumber: Joi.string().trim().max(64).allow(null, '').optional(),
  role: Joi.string().valid(...roles).optional(),
  currentZoneId: Joi.string().uuid().allow(null).optional(),
  currentRideId: Joi.string().uuid().allow(null).optional(),
  supervisorId: Joi.string().uuid().allow(null).optional(),
  available: Joi.boolean().optional(),
  skillLevel: Joi.number().integer().min(1).max(5).optional(),
}).min(1);

module.exports = { createStaffSchema, updateStaffSchema, staffImportBody, roles };
