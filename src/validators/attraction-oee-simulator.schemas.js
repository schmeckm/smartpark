const Joi = require('joi');
const { SCENARIOS } = require('../services/attraction-oee-simulator.service');

const uuid = Joi.string().uuid();

const attractionOeeStartBody = Joi.object({
  parkSlug: Joi.string().trim().max(128).optional(),
  parkId: uuid.optional(),
  edgeNodeId: Joi.string().trim().max(120).optional().allow('', null),
  publishMs: Joi.number().integer().min(500).max(120000).optional(),
  scenario: Joi.string()
    .valid(...SCENARIOS)
    .optional(),
  randomSeed: Joi.number().integer().min(0).max(0xffffffff).optional(),
  attractions: Joi.alternatives()
    .try(Joi.array().items(Joi.string().trim().max(160)), Joi.string().trim().max(2000))
    .optional(),
  assetIds: Joi.array().items(uuid).max(32).optional(),
});

const attractionOeeScenarioBody = Joi.object({
  name: Joi.string()
    .valid(...SCENARIOS)
    .required(),
});

const attractionOeeCandidatesQuery = Joi.object({
  parkId: uuid.required(),
});

module.exports = {
  attractionOeeStartBody,
  attractionOeeScenarioBody,
  attractionOeeCandidatesQuery,
};
