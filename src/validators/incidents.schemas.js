const Joi = require('joi');

const INCIDENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const listIncidentsQuery = Joi.object({
  status: Joi.string().valid(...INCIDENT_STATUSES).optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
  linkedEntityType: Joi.string().trim().max(40).allow('', null).optional(),
  linkedEntityId: Joi.string().trim().max(64).allow('', null).optional(),
  createdFrom: Joi.date().iso().optional(),
  createdTo: Joi.date().iso().optional(),
}).custom((v, helpers) => {
  const t = v.linkedEntityType != null && String(v.linkedEntityType).trim() !== '';
  const id = v.linkedEntityId != null && String(v.linkedEntityId).trim() !== '';
  if (t !== id) {
    return helpers.error('any.invalid', {
      message: 'linkedEntityType and linkedEntityId must both be set or both omitted',
    });
  }
  return v;
});

const incidentIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const createIncidentBody = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().allow('', null).max(20000).optional(),
  severity: Joi.string().valid(...INCIDENT_SEVERITIES).default('MEDIUM'),
  status: Joi.string().valid(...INCIDENT_STATUSES).default('OPEN'),
  ownerUserId: Joi.string().uuid().allow(null).optional(),
  linkedEntityType: Joi.string().trim().max(40).allow(null, '').optional(),
  linkedEntityId: Joi.string().trim().max(64).allow(null, '').optional(),
  slaDueAt: Joi.date().iso().allow(null).optional(),
});

const patchIncidentBody = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional(),
  description: Joi.string().trim().allow('', null).max(20000).optional(),
  severity: Joi.string().valid(...INCIDENT_SEVERITIES).optional(),
  status: Joi.string().valid(...INCIDENT_STATUSES).optional(),
  ownerUserId: Joi.string().uuid().allow(null).optional(),
  linkedEntityType: Joi.string().trim().max(40).allow(null, '').optional(),
  linkedEntityId: Joi.string().trim().max(64).allow(null, '').optional(),
  slaDueAt: Joi.date().iso().allow(null).optional(),
}).min(1);

module.exports = {
  listIncidentsQuery,
  incidentIdParams,
  createIncidentBody,
  patchIncidentBody,
  INCIDENT_STATUSES,
  INCIDENT_SEVERITIES,
};
