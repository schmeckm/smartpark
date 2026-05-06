const Joi = require('joi');

const uuid = Joi.string().uuid();

const parkIdParams = Joi.object({
  parkId: uuid.required(),
});

const parkZoneParams = Joi.object({
  parkId: uuid.required(),
  zoneId: uuid.required(),
});

const parkRideParams = Joi.object({
  parkId: uuid.required(),
  rideId: uuid.required(),
});

const ridesRegistryFirstQuery = Joi.object({
  parkId: uuid.required(),
}).unknown(false);

const rideAssetIdOnlyParams = Joi.object({
  id: uuid.required(),
}).unknown(false);

module.exports = {
  parkIdParams,
  parkZoneParams,
  parkRideParams,
  ridesRegistryFirstQuery,
  rideAssetIdOnlyParams,
};
