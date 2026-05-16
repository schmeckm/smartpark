'use strict';

const Joi = require('joi');

const jsonObject = Joi.alternatives().try(Joi.object(), Joi.valid(null));

const enabledQuery = Joi.alternatives().try(
  Joi.boolean(),
  Joi.string().valid('true', 'false', '1', '0')
);

const parkListQuery = Joi.object({
  profileName: Joi.string().max(255),
  enabled: enabledQuery,
  includeArchived: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
});

const rideListQuery = Joi.object({
  profileName: Joi.string().max(255),
  rideId: Joi.string().uuid(),
  enabled: enabledQuery,
  includeArchived: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('true', 'false')).optional(),
});

const parkIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const rideIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const parkProfileBody = Joi.object({
  profileName: Joi.string().min(1).max(255).required(),
  profileVersion: Joi.string().max(64),
  enabled: Joi.boolean(),
  crowdProfileJson: jsonObject,
  weatherProfileJson: jsonObject,
  calendarProfileJson: jsonObject,
  seasonalityProfileJson: jsonObject,
  eventProfileJson: jsonObject,
  visitorMixProfileJson: jsonObject,
  featureWeightsJson: jsonObject,
  notes: Joi.string().allow('', null).max(20000),
});

const parkProfilePutBody = parkProfileBody.fork(['profileName'], (s) => s.optional());

const parkProfilePutMerged = parkProfilePutBody.keys({
  id: Joi.string().uuid().required(),
});

const rideProfileBody = Joi.object({
  rideId: Joi.string().uuid().required(),
  profileName: Joi.string().min(1).max(255).required(),
  profileVersion: Joi.string().max(64),
  enabled: Joi.boolean(),
  rideType: Joi.string().max(128).allow('', null),
  capacityProfileJson: jsonObject,
  popularityProfileJson: jsonObject,
  queueBehaviorProfileJson: jsonObject,
  weatherSensitivityJson: jsonObject,
  downtimeSensitivityJson: jsonObject,
  staffingDependencyJson: jsonObject,
  throughputProfileJson: jsonObject,
  featureWeightsJson: jsonObject,
  notes: Joi.string().allow('', null).max(20000),
});

const rideProfilePutBody = rideProfileBody.fork(['rideId', 'profileName'], (s) => s.optional());

const rideProfilePutMerged = rideProfilePutBody.keys({
  id: Joi.string().uuid().required(),
});

module.exports = {
  parkListQuery,
  rideListQuery,
  parkIdParams,
  rideIdParams,
  parkProfileBody,
  parkProfilePutBody,
  parkProfilePutMerged,
  rideProfileBody,
  rideProfilePutBody,
  rideProfilePutMerged,
};
