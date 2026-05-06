'use strict';

const { Router } = require('express');
const Joi = require('joi');
const { validate } = require('../../middleware/validate.middleware');
const { requirePermission } = require('../../middleware/rbac.middleware');
const controller = require('../../controllers/uns-registry.controller');

const router = Router();

const registryListQuery = Joi.object({
  parkId: Joi.string().uuid().allow('', null),
  entityKind: Joi.string().max(64).allow('', null),
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
}).unknown(false);

const topicsListQuery = Joi.object({
  parkId: Joi.string().uuid().allow('', null),
  limit: Joi.number().integer().min(1).max(200).optional(),
  offset: Joi.number().integer().min(0).optional(),
}).unknown(false);

router.get('/mirror/summary', requirePermission('integrations', 'read'), controller.getMirrorSummary);
router.get(
  '/entities',
  requirePermission('integrations', 'read'),
  validate(registryListQuery, 'query'),
  controller.listEntities
);
router.get(
  '/topics',
  requirePermission('integrations', 'read'),
  validate(topicsListQuery, 'query'),
  controller.listTopics
);

module.exports = { unsRegistryRouter: router };
