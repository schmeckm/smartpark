'use strict';

const Joi = require('joi');
const { AppError } = require('../utils/app-error');
const { SUPPORTED_DOMAINS } = require('../modules/uns/topic-layout/topic-layout.constants');

const DOMAIN_LIST = [...SUPPORTED_DOMAINS];

const signalEntrySchema = Joi.object({
  enabled: Joi.boolean(),
  mlEligible: Joi.boolean(),
  boardEligible: Joi.boolean(),
  operationsEligible: Joi.boolean(),
}).min(1);

const signalKeySchema = Joi.string()
  .pattern(/^[a-z0-9_]+\.[a-z0-9_]+$/)
  .custom((value, helpers) => {
    const domain = value.slice(0, value.indexOf('.'));
    if (!DOMAIN_LIST.includes(domain)) {
      return helpers.error('any.invalid');
    }
    return value;
  });

const extensionsPatchBodyJoi = Joi.object({
  schemaVersion: Joi.number().integer().min(1),
  domains: Joi.array().items(Joi.string().valid(...DOMAIN_LIST)),
  capabilities: Joi.object({
    hasQueueSignal: Joi.boolean(),
    hasCycleSignal: Joi.boolean(),
    hasEnergyMetering: Joi.boolean(),
    supportsGreenOptimization: Joi.boolean(),
  }),
  signals: Joi.object()
    .pattern(signalKeySchema, Joi.alternatives().try(signalEntrySchema, Joi.valid(null)))
    .unknown(false),
  replaceSignals: Joi.boolean(),
}).min(1);

/**
 * Phase E PATCH body — HTTP 400 on invalid input (per product contract).
 */
function validateExtensionsPatchBody(req, res, next) {
  const { error, value } = extensionsPatchBodyJoi.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return next(
      new AppError('Validation failed', 400, {
        code: 'INVALID_EXTENSIONS_PATCH',
        details: error.details.map((d) => ({
          message: d.message,
          path: d.path.join('.'),
        })),
      })
    );
  }
  if (value.replaceSignals === true && value.signals === undefined) {
    return next(
      new AppError('Validation failed', 400, {
        code: 'INVALID_EXTENSIONS_PATCH',
        details: [{ message: 'replaceSignals requires signals', path: 'signals' }],
      })
    );
  }
  req.validated = value;
  next();
}

module.exports = {
  validateExtensionsPatchBody,
  extensionsPatchBodyJoi,
};
