'use strict';

const Joi = require('joi');

const uuid = Joi.string().uuid();

const widgetSourceDraftBody = Joi.object({
  sourceType: Joi.string().valid('SIGNAL_METADATA').required(),
  entityType: Joi.string().valid('park_asset').required(),
  entityId: uuid.required(),
  signalKey: Joi.string()
    .pattern(/^[a-z0-9_]+\.[a-z0-9_]+$/)
    .max(200)
    .required(),
}).unknown(false);

/**
 * @param {unknown} body
 * @param {string} rideIdFromParams
 * @returns {{ ok: true, value: { sourceType: string, entityType: string, entityId: string, signalKey: string } } | { ok: false, message: string }}
 */
function validateWidgetSourceDraftBody(body, rideIdFromParams) {
  const { error, value } = widgetSourceDraftBody.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) {
    return { ok: false, message: error.details.map((d) => d.message).join('; ') };
  }
  if (String(value.entityId) !== String(rideIdFromParams)) {
    return { ok: false, message: 'entityId must match path rideId' };
  }
  return { ok: true, value };
}

module.exports = {
  widgetSourceDraftBody,
  validateWidgetSourceDraftBody,
};
