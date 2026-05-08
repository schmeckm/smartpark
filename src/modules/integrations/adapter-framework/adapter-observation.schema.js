const Joi = require('joi');

/**
 * Normalized observation returned by adapter `poll()`.
 * Core validates, then routes via {@link OutputRouterService}.
 * Contract minimum: eventType, domain, metric, eventTime, source (plus value + assetSlug for UNS routing).
 * Extra keys from adapters are stripped; optional keys get defaults.
 */
const adapterObservationSchema = Joi.object({
  eventType: Joi.string().required(),
  domain: Joi.string().required(),
  assetSlug: Joi.string().required(),
  metric: Joi.string().required(),
  value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).allow(null).required(),
  unit: Joi.string().allow(null, '').default(null),
  eventTime: Joi.string().isoDate().required(),
  quality: Joi.string().allow(null, '').default(null),
  confidence: Joi.number().min(0).max(1).allow(null).default(null),
  source: Joi.string().required(),
  provider: Joi.string().allow(null, '').default(null),
  externalParkId: Joi.string().allow(null, '').default(null),
  externalEntityId: Joi.string().allow(null, '').default(null),
  rawPayload: Joi.object().unknown(true).default({}),
  metadata: Joi.object().unknown(true).default({}),
}).unknown(true);

module.exports = {
  adapterObservationSchema,
};
