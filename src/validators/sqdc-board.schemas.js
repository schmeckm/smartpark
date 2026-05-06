const Joi = require('joi');

const uuid = Joi.string().uuid();

/** Merged from `req.params` + `req.query` (validateMerged). */
const parkBoardMerged = Joi.object({
  parkId: uuid.required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
});

const assetBoardMerged = Joi.object({
  parkId: uuid.required(),
  assetId: uuid.required(),
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
});

const sqdcEventBody = Joi.object({
  assetId: uuid.allow(null, '').optional(),
  eventType: Joi.string().valid('SAFETY', 'QUALITY', 'DELIVERY', 'CUSTOMER', 'PEOPLE', 'MAINTENANCE').required(),
  severity: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'CRITICAL').default('MEDIUM'),
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().allow('', null).max(8000).optional(),
  status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'RESOLVED').default('OPEN'),
  source: Joi.string().valid('MANUAL', 'MQTT', 'ADAPTER', 'AI', 'SYSTEM').default('MANUAL'),
  eventTime: Joi.date().iso().optional(),
  metadataJson: Joi.object().unknown(true).optional(),
});

const moodFeedbackBody = Joi.object({
  assetId: uuid.allow(null, '').optional(),
  feedbackDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  moodScore: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().max(2000).allow('', null).optional(),
});

const dailySnapshotBody = Joi.object({
  level: Joi.string().valid('PARK', 'ASSET').required(),
  snapshotDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  assetId: uuid.when('level', {
    is: 'ASSET',
    then: Joi.required(),
    otherwise: Joi.allow(null, '').optional(),
  }),
  safetyScore: Joi.number().min(0).max(100).allow(null).optional(),
  qualityScore: Joi.number().min(0).max(100).allow(null).optional(),
  deliveryScore: Joi.number().min(0).max(100).allow(null).optional(),
  customerScore: Joi.number().min(0).max(100).allow(null).optional(),
  overallScore: Joi.number().min(0).max(100).allow(null).optional(),
  safetyJson: Joi.object().unknown(true).optional(),
  qualityJson: Joi.object().unknown(true).optional(),
  deliveryJson: Joi.object().unknown(true).optional(),
  customerJson: Joi.object().unknown(true).optional(),
  aiRecommendationsJson: Joi.array().items(Joi.object().unknown(true)).optional(),
});

module.exports = { parkBoardMerged, assetBoardMerged, sqdcEventBody, moodFeedbackBody, dailySnapshotBody };
