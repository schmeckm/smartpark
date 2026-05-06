const { Router } = require('express');
const Joi = require('joi');
const { validate } = require('../../middleware/validate.middleware');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const mqttController = require('../../controllers/mqtt.controller');
const mqttInboundController = require('../../controllers/mqtt-inbound.controller');

const router = Router();

router.get('/status', requirePermission('mqtt', 'read'), mqttController.status);

router.get(
  '/capability-guard/status',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  mqttController.capabilityGuardStatus
);

const inboundQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
  topicPrefix: Joi.string().max(500).optional(),
  spyClassification: Joi.string().max(40).optional(),
  capabilityDecision: Joi.string().valid('ALLOW', 'WARN', 'BLOCK', 'SKIP').optional(),
}).unknown(false);

const inboundUnknownQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
  topicPrefix: Joi.string().max(500).optional(),
}).unknown(false);

router.get(
  '/inbound',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(inboundQuery, 'query'),
  mqttInboundController.listInbound
);
router.get(
  '/inbound/unknown',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(inboundUnknownQuery, 'query'),
  mqttInboundController.listInboundUnknown
);

module.exports = { mqttRouter: router };
