'use strict';

const Joi = require('joi');

const uuid = Joi.string().uuid();

const trafficSnapshotPollBody = Joi.object({
  parkId: uuid.optional(),
}).default({});

const trafficLatestQuery = Joi.object({
  parkId: uuid.required(),
});

module.exports = {
  trafficSnapshotPollBody,
  trafficLatestQuery,
};
