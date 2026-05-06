const Joi = require('joi');
const { guestCountsSchema } = require('./visit-plan.schemas');

const actualYearParams = Joi.object({
  actualYear: Joi.number().integer().min(2000).max(2100).required(),
});

const putVisitActualBody = Joi.object({
  guestCounts: guestCountsSchema,
});

/** Params `actualYear` + body for PUT */
const putVisitActualMerged = Joi.object({
  actualYear: Joi.number().integer().min(2000).max(2100).required(),
  guestCounts: guestCountsSchema,
});

module.exports = {
  actualYearParams,
  putVisitActualBody,
  putVisitActualMerged,
};
