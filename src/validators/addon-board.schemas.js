const Joi = require('joi');

const uuid = Joi.string().uuid();

const zoneIdParams = Joi.object({
  zoneId: uuid.required(),
});

const rideIdParams = Joi.object({
  rideId: uuid.required(),
});

const boardIdParams = Joi.object({
  boardId: Joi.string().max(120).required(),
});

const layoutQuery = Joi.object({
  boardId: Joi.string().max(120).optional(),
});

module.exports = { zoneIdParams, rideIdParams, boardIdParams, layoutQuery };
