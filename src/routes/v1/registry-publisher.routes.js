'use strict';

const { Router } = require('express');
const Joi = require('joi');
const { validate } = require('../../middleware/validate.middleware');
const { requireAnyPermission } = require('../../middleware/rbac.middleware');
const ctrl = require('../../controllers/registry-publisher.controller');

const router = Router();

const uuid = Joi.string().uuid({ version: 'uuidv4' });

const rideIdParams = Joi.object({
  id: uuid.required(),
}).unknown(false);

const eventsQuery = Joi.object({
  rideAssetId: uuid.optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
}).unknown(false);

router.get(
  '/status',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  ctrl.getStatus
);

router.get(
  '/health',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  ctrl.getHealth
);

router.get(
  '/events',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(eventsQuery, 'query'),
  ctrl.listEvents
);

router.post(
  '/rides/:id/dry-run',
  requireAnyPermission(['integrations', 'read'], ['rides', 'read']),
  validate(rideIdParams, 'params'),
  ctrl.postDryRun
);

router.post(
  '/rides/:id/publish-once',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideIdParams, 'params'),
  ctrl.postPublishOnce
);

router.post(
  '/rides/:id/disable-pilot',
  requireAnyPermission(['integrations', 'manage'], ['rides', 'update']),
  validate(rideIdParams, 'params'),
  ctrl.postDisablePilot
);

module.exports = { registryPublisherRouter: router };
