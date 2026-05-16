'use strict';

const Joi = require('joi');
const { AppError } = require('../utils/app-error');

const ALLOWED_SCHEDULE_INTERVAL_SECONDS = Object.freeze([60, 300, 900, 1800, 3600]);
const ALLOWED_MAX_RETRY_ATTEMPTS = Object.freeze([0, 1, 2, 3]);
const ALLOWED_RETRY_DELAY_SECONDS = Object.freeze([60, 300, 900]);

const flowJsonSchema = Joi.object({
  nodes: Joi.array().items(Joi.object()).required(),
  edges: Joi.array().items(Joi.object()).required(),
}).unknown(false);

const retryOnNodeTypesSchema = Joi.array().items(Joi.string().min(1).max(128)).max(64).allow(null);

/**
 * @param {{ enabled: boolean, scheduleEnabled: boolean, scheduleIntervalSeconds: number|null }} s
 */
function validateIntegrationFlowScheduleState(s) {
  const schedOn = s.scheduleEnabled === true;
  const effEnabled = s.enabled === true;
  if (schedOn) {
    if (!effEnabled) {
      throw new AppError('scheduleEnabled requires enabled flow', 422, { code: 'INVALID_SCHEDULE' });
    }
    const iv = s.scheduleIntervalSeconds;
    if (iv == null || !ALLOWED_SCHEDULE_INTERVAL_SECONDS.includes(Number(iv))) {
      throw new AppError('scheduleEnabled requires a valid scheduleIntervalSeconds', 422, { code: 'INVALID_SCHEDULE' });
    }
  }
  if (
    s.scheduleIntervalSeconds != null &&
    !ALLOWED_SCHEDULE_INTERVAL_SECONDS.includes(Number(s.scheduleIntervalSeconds))
  ) {
    throw new AppError('Invalid scheduleIntervalSeconds', 422, { code: 'INVALID_SCHEDULE' });
  }
}

/**
 * @param {{ enabled: boolean, retryEnabled: boolean, maxRetryAttempts: number, retryDelaySeconds: number|null, retryOnNodeTypes: unknown }} s
 */
function validateIntegrationFlowRetryState(s) {
  const re = s.retryEnabled === true;
  const effEnabled = s.enabled === true;
  const max = Number(s.maxRetryAttempts ?? 0);
  const delay = s.retryDelaySeconds == null ? null : Number(s.retryDelaySeconds);
  const filter = s.retryOnNodeTypes;

  if (re) {
    if (!effEnabled) {
      throw new AppError('retryEnabled requires enabled flow', 422, { code: 'INVALID_RETRY' });
    }
    if (![1, 2, 3].includes(max)) {
      throw new AppError('retryEnabled requires maxRetryAttempts between 1 and 3', 422, { code: 'INVALID_RETRY' });
    }
    if (delay == null || !ALLOWED_RETRY_DELAY_SECONDS.includes(delay)) {
      throw new AppError('retryEnabled requires a valid retryDelaySeconds', 422, { code: 'INVALID_RETRY' });
    }
  } else {
    if (max !== 0) {
      throw new AppError('maxRetryAttempts must be 0 when retry is disabled', 422, { code: 'INVALID_RETRY' });
    }
    if (delay != null) {
      throw new AppError('retryDelaySeconds must be null when retry is disabled', 422, { code: 'INVALID_RETRY' });
    }
    if (filter != null && Array.isArray(filter) && filter.length > 0) {
      throw new AppError('retryOnNodeTypes must be null or empty when retry is disabled', 422, {
        code: 'INVALID_RETRY',
      });
    }
  }
  if (!re && max !== 0 && ![0, 1, 2, 3].includes(max)) {
    throw new AppError('Invalid maxRetryAttempts', 422, { code: 'INVALID_RETRY' });
  }
  if (!re && delay != null && !ALLOWED_RETRY_DELAY_SECONDS.includes(delay)) {
    throw new AppError('Invalid retryDelaySeconds', 422, { code: 'INVALID_RETRY' });
  }
}

const integrationFlowCreateBody = Joi.object({
  parkId: Joi.string().uuid().allow(null),
  name: Joi.string().min(1).max(255).required(),
  description: Joi.string().allow('', null),
  enabled: Joi.boolean().default(false),
  triggerType: Joi.string().max(64).default('MANUAL'),
  flowJson: flowJsonSchema.required(),
  scheduleEnabled: Joi.boolean().default(false),
  scheduleIntervalSeconds: Joi.number()
    .integer()
    .valid(...ALLOWED_SCHEDULE_INTERVAL_SECONDS)
    .allow(null),
  retryEnabled: Joi.boolean().default(false),
  maxRetryAttempts: Joi.number().integer().valid(...ALLOWED_MAX_RETRY_ATTEMPTS).default(0),
  retryDelaySeconds: Joi.number().integer().valid(...ALLOWED_RETRY_DELAY_SECONDS).allow(null),
  retryOnNodeTypes: retryOnNodeTypesSchema,
});

const integrationFlowPatchBody = Joi.object({
  parkId: Joi.string().uuid().allow(null),
  name: Joi.string().min(1).max(255),
  description: Joi.string().allow('', null),
  enabled: Joi.boolean(),
  triggerType: Joi.string().max(64),
  flowJson: flowJsonSchema,
  scheduleEnabled: Joi.boolean(),
  scheduleIntervalSeconds: Joi.number()
    .integer()
    .valid(...ALLOWED_SCHEDULE_INTERVAL_SECONDS)
    .allow(null),
  retryEnabled: Joi.boolean(),
  maxRetryAttempts: Joi.number().integer().valid(...ALLOWED_MAX_RETRY_ATTEMPTS),
  retryDelaySeconds: Joi.number().integer().valid(...ALLOWED_RETRY_DELAY_SECONDS).allow(null),
  retryOnNodeTypes: retryOnNodeTypesSchema,
}).min(1);

const integrationFlowPatchMerged = Joi.object({
  id: Joi.string().uuid().required(),
  parkId: Joi.string().uuid().allow(null),
  name: Joi.string().min(1).max(255),
  description: Joi.string().allow('', null),
  enabled: Joi.boolean(),
  triggerType: Joi.string().max(64),
  flowJson: flowJsonSchema,
  scheduleEnabled: Joi.boolean(),
  scheduleIntervalSeconds: Joi.number()
    .integer()
    .valid(...ALLOWED_SCHEDULE_INTERVAL_SECONDS)
    .allow(null),
  retryEnabled: Joi.boolean(),
  maxRetryAttempts: Joi.number().integer().valid(...ALLOWED_MAX_RETRY_ATTEMPTS),
  retryDelaySeconds: Joi.number().integer().valid(...ALLOWED_RETRY_DELAY_SECONDS).allow(null),
  retryOnNodeTypes: retryOnNodeTypesSchema,
}).or(
  'parkId',
  'name',
  'description',
  'enabled',
  'triggerType',
  'flowJson',
  'scheduleEnabled',
  'scheduleIntervalSeconds',
  'retryEnabled',
  'maxRetryAttempts',
  'retryDelaySeconds',
  'retryOnNodeTypes'
);

const idParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const runIdParamsSchema = Joi.object({
  runId: Joi.string().uuid().required(),
});

const integrationFlowRunMerged = Joi.object({
  id: Joi.string().uuid().required(),
  input: Joi.object().default({}),
});

const listFlowsQuerySchema = Joi.object({
  parkId: Joi.string().uuid(),
  limit: Joi.number().integer().min(1).max(200),
  offset: Joi.number().integer().min(0),
});

const integrationFlowScheduleRecalculateMerged = Joi.object({
  id: Joi.string().uuid().required(),
});

const integrationFlowFailuresQueryMerged = Joi.object({
  flowId: Joi.string().uuid(),
  retryStatus: Joi.string().valid(
    'not_applicable',
    'pending_retry',
    'retry_succeeded',
    'retry_failed',
    'retry_exhausted'
  ),
  nodeType: Joi.string().min(1).max(80),
  acknowledged: Joi.string().valid('yes', 'no', 'all'),
  from: Joi.string().max(64).allow('', null),
  to: Joi.string().max(64).allow('', null),
  limit: Joi.number().integer().min(1).max(200),
  offset: Joi.number().integer().min(0),
});

const integrationFlowAcknowledgeMerged = Joi.object({
  runId: Joi.string().uuid().required(),
  note: Joi.string().max(1000).allow('', null),
});

/** configOverrides.nodes — per-node partial config; keys validated in template service. */
const integrationFlowFromTemplateBody = Joi.object({
  templateKey: Joi.string().min(1).max(128).required(),
  name: Joi.string().min(1).max(255).required(),
  parkId: Joi.string().uuid().allow(null),
  description: Joi.string().allow('', null),
  enabled: Joi.boolean().default(false),
  configOverrides: Joi.object({
    nodes: Joi.object().pattern(Joi.string().max(128), Joi.object().unknown(true)).default({}),
  }).default({}),
});

module.exports = {
  ALLOWED_SCHEDULE_INTERVAL_SECONDS,
  ALLOWED_MAX_RETRY_ATTEMPTS,
  ALLOWED_RETRY_DELAY_SECONDS,
  flowJsonSchema,
  integrationFlowCreateBody,
  integrationFlowFromTemplateBody,
  integrationFlowPatchBody,
  integrationFlowPatchMerged,
  integrationFlowScheduleRecalculateMerged,
  integrationFlowFailuresQueryMerged,
  integrationFlowAcknowledgeMerged,
  validateIntegrationFlowScheduleState,
  validateIntegrationFlowRetryState,
  idParamsSchema,
  runIdParamsSchema,
  integrationFlowRunMerged,
  listFlowsQuerySchema,
};
