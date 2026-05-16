'use strict';

const Joi = require('joi');

const putTomTomTrafficProviderBody = Joi.object({
  enabled: Joi.boolean().required(),
  apiKey: Joi.string().allow('', null).max(4000).optional(),
  displayName: Joi.string().trim().max(200).optional(),
  pollIntervalMinutes: Joi.number().integer().min(1).max(1440).optional(),
  timeoutMs: Joi.number().integer().min(1000).max(120000).optional(),
  baseUrl: Joi.string().uri().max(500).optional(),
});

const testTomTomTrafficProviderBody = Joi.object({
  originLat: Joi.number().min(-90).max(90).optional(),
  originLng: Joi.number().min(-180).max(180).optional(),
  destinationLat: Joi.number().min(-90).max(90).optional(),
  destinationLng: Joi.number().min(-180).max(180).optional(),
}).default({});

module.exports = {
  putTomTomTrafficProviderBody,
  testTomTomTrafficProviderBody,
};
