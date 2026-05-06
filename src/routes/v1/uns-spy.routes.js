'use strict';

const { Router } = require('express');
const Joi = require('joi');
const { validate, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const unsSpyController = require('../../controllers/uns-spy.controller');

const router = Router();

const eventsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
  classification: Joi.string().max(40).optional(),
  topicPrefix: Joi.string().max(500).optional(),
  eventSource: Joi.string().valid('mqtt', 'adapter', 'all').optional(),
}).unknown(false);

const proposalsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
  status: Joi.string().max(40).optional(),
}).unknown(false);

const approveParamsBody = Joi.object({
  id: Joi.string().uuid().required(),
  createEntity: Joi.boolean().optional(),
  mapToExistingEntityId: Joi.string().uuid().required(),
  applyTemplateKey: Joi.string().max(80).allow('', null).optional(),
  createMapping: Joi.boolean().optional(),
}).unknown(false);

const eventIdParams = Joi.object({
  id: Joi.string().uuid().required(),
}).unknown(false);

router.get(
  '/events',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(eventsQuery, 'query'),
  unsSpyController.listEvents
);
router.get(
  '/proposals',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(proposalsQuery, 'query'),
  unsSpyController.listProposals
);

router.post(
  '/events/:id/approve',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validateMergedParamsBody(approveParamsBody),
  unsSpyController.approveEvent
);
router.post(
  '/events/:id/reject',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(eventIdParams, 'params'),
  unsSpyController.rejectEvent
);
router.post(
  '/events/:id/ignore',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(eventIdParams, 'params'),
  unsSpyController.ignoreEvent
);

module.exports = { unsSpyRouter: router };
