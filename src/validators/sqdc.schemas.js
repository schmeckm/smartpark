const Joi = require('joi');

const uuid = Joi.string().uuid();

const boardQuery = Joi.object({
  businessDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  assetId: uuid.allow(null, '').optional(),
});

const historyQuery = Joi.object({
  assetId: uuid.required(),
  days: Joi.number().integer().min(1).max(90).default(14),
});

const moodBody = Joi.object({
  businessDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  assetId: uuid.allow(null, '').optional(),
  mood: Joi.string().valid('great', 'good', 'neutral', 'low', 'bad').required(),
});

const safetyBody = Joi.object({
  assetId: uuid.allow(null, '').optional(),
  kind: Joi.string().valid('near_miss', 'accident').required(),
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().allow('', null).max(5000).optional(),
  occurredAt: Joi.date().iso().optional(),
});

const snapshotBody = Joi.object({
  assetId: uuid.required(),
  businessDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  deliveryOee5m: Joi.number().min(0).max(1).allow(null).optional(),
  customerGuestCount: Joi.number().integer().min(0).max(999999).allow(null).optional(),
  leadTechnicianName: Joi.string().trim().max(200).allow('', null).optional(),
  notes: Joi.string().trim().max(8000).allow('', null).optional(),
});

module.exports = { boardQuery, historyQuery, moodBody, safetyBody, snapshotBody };
