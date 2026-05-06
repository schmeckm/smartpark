const Joi = require('joi');

/** Params (`settingKey`) + body (`value`). */
const patchPlatformSettingMergedSchema = Joi.object({
  settingKey: Joi.string().max(120).required(),
  value: Joi.alternatives().try(Joi.boolean(), Joi.number(), Joi.string().trim().min(1)).required(),
});

module.exports = { patchPlatformSettingMergedSchema };
