const Joi = require('joi');

const CELL_KEY_RE = /^.+::\d{4}-\d{2}-\d{2}$/;

const guestCountsSchema = Joi.object()
  .pattern(Joi.string().max(160), Joi.number().integer().min(0).max(1_000_000_000))
  .required()
  .custom((obj, helpers) => {
    const o = obj || {};
    const keys = Object.keys(o);
    if (keys.length > 150_000) {
      return helpers.error('any.invalid', { message: 'guestCounts exceeds maximum keys' });
    }
    for (const k of keys) {
      if (!CELL_KEY_RE.test(k)) {
        return helpers.error('any.invalid', { message: `invalid guestCounts key: ${k}` });
      }
    }
    return o;
  });

const visitPlanPayloadSchema = Joi.object({
  schemaVersion: Joi.number().integer().valid(2).required(),
  hotels: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().trim().min(1).max(120).required(),
        name: Joi.string().trim().min(1).max(200).required(),
      })
    )
    .max(80)
    .required(),
  guestCounts: guestCountsSchema,
}).required();

const listVisitPlansQuery = Joi.object({
  year: Joi.number().integer().min(2000).max(2100).required(),
});

const visitPlanIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const createVisitPlanBody = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  planYear: Joi.number().integer().min(2000).max(2100).required(),
  payload: visitPlanPayloadSchema.optional(),
});

const patchVisitPlanBody = Joi.object({
  name: Joi.string().trim().min(1).max(200).optional(),
  payload: visitPlanPayloadSchema.optional(),
})
  .or('name', 'payload')
  .messages({
    'object.missing': 'at least one of name, payload is required',
  });

const visitPlanForecastBody = Joi.object({
  method: Joi.string().valid('prior_year_actuals').default('prior_year_actuals'),
  sourceYear: Joi.number().integer().min(2000).max(2100).required(),
  scale: Joi.number().min(0).max(1000).default(1),
  emptyOnly: Joi.boolean().default(true),
});

/** Params `id` + JSON body for POST …/:id/forecast */
const visitPlanForecastMerged = Joi.object({
  id: Joi.string().uuid().required(),
  method: Joi.string().valid('prior_year_actuals').default('prior_year_actuals'),
  sourceYear: Joi.number().integer().min(2000).max(2100).required(),
  scale: Joi.number().min(0).max(1000).default(1),
  emptyOnly: Joi.boolean().default(true),
});

module.exports = {
  listVisitPlansQuery,
  visitPlanIdParams,
  createVisitPlanBody,
  patchVisitPlanBody,
  visitPlanPayloadSchema,
  guestCountsSchema,
  visitPlanForecastBody,
  visitPlanForecastMerged,
};
