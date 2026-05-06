const Joi = require('joi');

const uuid = Joi.string().uuid();

const parkBody = Joi.object({
  code: Joi.string().trim().max(64).required(),
  name: Joi.string().trim().max(200).required(),
  timezone: Joi.string().trim().max(64).allow(null, ''),
  activeFlag: Joi.boolean().optional(),
  futureHints: Joi.object().optional(),
});

const zoneBody = Joi.object({
  code: Joi.string().trim().max(64).required(),
  name: Joi.string().trim().max(200).required(),
  sortOrder: Joi.number().integer().min(0).optional(),
  legacyZoneId: uuid.allow(null),
});

const templateBody = Joi.object({
  rideTypeId: uuid.required(),
  code: Joi.string().trim().max(64).required(),
  displayName: Joi.string().trim().max(160).required(),
  defaultProfile: Joi.object().optional(),
  isSystem: Joi.boolean().optional(),
});

const rideCreateBody = Joi.object({
  parkId: uuid.required(),
  parkZoneId: uuid.required(),
  rideTypeId: uuid.required(),
  internalRideId: uuid.allow(null),
  externalId: Joi.string().trim().max(255).allow(null, ''),
  name: Joi.string().trim().max(200).required(),
  shortName: Joi.string().trim().max(80).allow(null, ''),
  description: Joi.string().allow(null, ''),
  manufacturer: Joi.string().trim().max(160).allow(null, ''),
  model: Joi.string().trim().max(120).allow(null, ''),
  buildYear: Joi.number().integer().min(1800).max(2100).allow(null),
  commissioningDate: Joi.date().allow(null),
  lifecycleStatus: Joi.string().trim().max(32).optional(),
  activeFlag: Joi.boolean().optional(),
  profile: Joi.object().optional(),
});

const rideUpdateBody = Joi.object({
  parkId: uuid.optional(),
  parkZoneId: uuid.optional(),
  rideTypeId: uuid.optional(),
  internalRideId: uuid.allow(null),
  externalId: Joi.string().trim().max(255).allow(null, ''),
  name: Joi.string().trim().max(200).optional(),
  shortName: Joi.string().trim().max(80).allow(null, ''),
  description: Joi.string().allow(null, ''),
  manufacturer: Joi.string().trim().max(160).allow(null, ''),
  model: Joi.string().trim().max(120).allow(null, ''),
  buildYear: Joi.number().integer().min(1800).max(2100).allow(null),
  commissioningDate: Joi.date().allow(null),
  lifecycleStatus: Joi.string().trim().max(32).optional(),
  activeFlag: Joi.boolean().optional(),
  lifecycleReason: Joi.string().allow(null, ''),
  operations: Joi.object().optional(),
  capacity: Joi.object().optional(),
  staffing: Joi.object().optional(),
  safety: Joi.object().optional(),
  guestRules: Joi.object().optional(),
  integration: Joi.object().optional(),
  kpi: Joi.object().optional(),
  kpiTargets: Joi.object().optional(),
}).min(1);

const cloneFromTemplateBody = Joi.object({
  parkZoneId: uuid.required(),
  name: Joi.string().trim().max(200).required(),
  externalId: Joi.string().trim().max(255).allow(null, ''),
  shortName: Joi.string().trim().max(80).allow(null, ''),
  description: Joi.string().allow(null, ''),
});

const assignZoneBody = Joi.object({
  parkZoneId: uuid.required(),
});

const activeBody = Joi.object({
  activeFlag: Joi.boolean().required(),
});

const parkIdParams = Joi.object({
  parkId: uuid.required(),
});

const idParams = Joi.object({
  id: uuid.required(),
});

const cloneTemplateParams = Joi.object({
  templateId: uuid.required(),
});

const rideTemplateUpdateBody = Joi.object({
  displayName: Joi.string().trim().max(160).optional(),
  defaultProfile: Joi.object().optional(),
  isSystem: Joi.boolean().optional(),
  rideTypeId: uuid.optional(),
  code: Joi.string().trim().max(64).optional(),
}).min(1);

module.exports = {
  parkBody,
  zoneBody,
  templateBody,
  rideTemplateUpdateBody,
  rideCreateBody,
  rideUpdateBody,
  cloneFromTemplateBody,
  assignZoneBody,
  activeBody,
  parkIdParams,
  idParams,
  cloneTemplateParams,
};
