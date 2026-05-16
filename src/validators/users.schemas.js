const Joi = require('joi');
const { isValidIanaTimeZone } = require('../utils/iana-timezone.util');
const { ASSIGNABLE_ROLE_CODES } = require('../constants/role-codes');

const SUPPORTED_LANGS = ['en', 'de', 'fr', 'es'];
const DATE_FORMATS = ['DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'];
const TIME_FORMATS = ['24h', '12h'];
const LOCALES = ['de-DE', 'en-US', 'fr-FR', 'es-ES'];

const parkMapFreqThresholdsSchema = Joi.object({
  veryHighMin: Joi.number().integer().min(1).max(50000).required(),
  mediumMin: Joi.number().integer().min(1).max(50000).required(),
  lowMin: Joi.number().integer().min(1).max(50000).required(),
})
  .custom((v, helpers) => {
    if (!(v.veryHighMin > v.mediumMin && v.mediumMin > v.lowMin)) {
      return helpers.error('custom.order');
    }
    return v;
  })
  .messages({
    'custom.order':
      'parkMapFreqThresholds must satisfy veryHighMin > mediumMin > lowMin (guests per hour, theoretical capacity)',
  });

const uiPreferencesPatchSchema = Joi.object({
  parkMapFreqThresholds: parkMapFreqThresholdsSchema.optional(),
})
  .min(1)
  .messages({ 'object.min': 'uiPreferences must include at least one nested key' });

const patchMyUserSettingsSchema = Joi.object({
  languageCode: Joi.string().valid(...SUPPORTED_LANGS).optional(),
  displayName: Joi.string().allow(null, '').max(255).optional(),
  timezone: Joi.string()
    .max(64)
    .allow(null, '')
    .custom((v, helpers) => {
      if (v === null || v === undefined || v === '') return v;
      if (!isValidIanaTimeZone(v)) return helpers.error('any.invalid');
      return String(v).trim();
    })
    .optional()
    .messages({ 'any.invalid': 'timezone must be a valid IANA time zone name' }),
  dateFormat: Joi.string().valid(...DATE_FORMATS).optional(),
  timeFormat: Joi.string().valid(...TIME_FORMATS).optional(),
  locale: Joi.string().valid(...LOCALES).allow(null, '').optional(),
  uiPreferences: uiPreferencesPatchSchema.optional(),
})
  .min(1)
  .messages({ 'object.min': 'at least one setting field is required' });

const adminRoleCodeSchema = Joi.string()
  .valid(...ASSIGNABLE_ROLE_CODES)
  .messages({ 'any.only': 'roleCode must be a valid RBAC role code' });

const createAdminUserSchema = Joi.object({
  firstName: Joi.string().trim().required().max(80),
  lastName: Joi.string().trim().required().max(80),
  email: Joi.string().trim().email().required().max(255),
  password: Joi.string().required().min(8).max(128),
  roleCode: adminRoleCodeSchema.required(),
  active: Joi.boolean().optional(),
});

const updateAdminUserSchema = Joi.object({
  id: Joi.string().uuid().required(),
  firstName: Joi.string().trim().max(80).optional(),
  lastName: Joi.string().trim().max(80).optional(),
  email: Joi.string().trim().email().max(255).optional(),
  password: Joi.string().min(8).max(128).optional(),
  roleCode: adminRoleCodeSchema.optional(),
  active: Joi.boolean().optional(),
}).min(2);

const deleteAdminUserParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  patchMyUserSettingsSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  deleteAdminUserParamsSchema,
  SUPPORTED_LANGS,
  DATE_FORMATS,
  TIME_FORMATS,
  SUPPORTED_LOCALES: LOCALES,
};
