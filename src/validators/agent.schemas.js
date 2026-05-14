'use strict';

const Joi = require('joi');

/** Keep in sync with {@link ../services/agentic/runtime/agent-runner} `SUPPORTED_SKILLS`. */
const AGENT_SKILL_IDS = [
  'daily_executive_brief',
  'crowd_spike_triage',
  'mapping_assistant',
  'weather_pivot',
  'ride_down_response',
];

const listAgentRunsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
  skillId: Joi.string().trim().max(64).optional(),
  status: Joi.string().trim().max(24).optional(),
});

const agentRunIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const createAgentRunBody = Joi.object({
  skillId: Joi.string().valid(...AGENT_SKILL_IDS).required(),
  parkId: Joi.string().uuid().required(),
  triggerType: Joi.string().trim().max(32).default('manual'),
  crowdEventId: Joi.string().uuid().allow(null).optional(),
  rideId: Joi.string().uuid().allow(null).optional(),
});

const listPendingActionsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const agentActionIdParams = Joi.object({
  id: Joi.string().uuid().required(),
});

const rejectAgentActionBody = Joi.object({
  reason: Joi.string().trim().allow('', null).max(2000).optional(),
});

const agentPreflightBody = Joi.object({
  skillId: Joi.string().valid(...AGENT_SKILL_IDS).required(),
  sourceRunId: Joi.string().uuid().allow(null).optional(),
});

const agentApprovalMetricsQuery = Joi.object({
  skillId: Joi.string().valid(...AGENT_SKILL_IDS).optional(),
  sinceDays: Joi.number().integer().min(1).max(365).default(30),
});

module.exports = {
  AGENT_SKILL_IDS,
  listAgentRunsQuery,
  agentRunIdParams,
  createAgentRunBody,
  agentPreflightBody,
  agentApprovalMetricsQuery,
  listPendingActionsQuery,
  agentActionIdParams,
  rejectAgentActionBody,
};
