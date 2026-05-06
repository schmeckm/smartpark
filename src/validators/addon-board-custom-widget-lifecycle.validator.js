'use strict';

const Joi = require('joi');

const uuid = Joi.string().uuid();

/** Path params for `rideId` + `widgetId` (stable id, e.g. `signal_queue_wait_time_min`). */
const rideIdWidgetIdParams = Joi.object({
  rideId: uuid.required(),
  widgetId: Joi.string().trim().min(1).max(200).pattern(/^[a-zA-Z0-9_.-]+$/).required(),
});

const patchCustomWidgetBody = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional(),
  enabled: Joi.boolean().optional(),
})
  .or('title', 'enabled')
  .unknown(false)
  .messages({
    'object.missing': 'Provide at least one of title or enabled',
  });

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: { title?: string, enabled?: boolean } } | { ok: false, message: string }}
 */
function validatePatchCustomWidgetBody(body) {
  const { error, value } = patchCustomWidgetBody.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    const msg = error.details.map((d) => d.message).join('; ') || 'Invalid patch body';
    return { ok: false, message: msg };
  }
  return { ok: true, value };
}

module.exports = {
  rideIdWidgetIdParams,
  patchCustomWidgetBody,
  validatePatchCustomWidgetBody,
};
