'use strict';

const { Router } = require('express');
const env = require('../../../config/env');
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { validate, validateMergedParamsBody } = require('../../../middleware/validate.middleware');
const controller = require('../controllers/widget-runtime.controller');
const {
  idParamsSchema,
  widgetInstanceCreateBody,
  widgetInstancePatchMerged,
  listInstancesQuerySchema,
} = require('../../../validators/widget-runtime.schemas');

const router = Router();

function widgetRuntimeGate(_req, res, next) {
  if (!env.widgetRuntimeEnabled) {
    return res.status(404).json({ success: false, message: 'Not found', code: 'NOT_FOUND' });
  }
  next();
}

router.use(widgetRuntimeGate);

router.get('/widgets', requirePermission('integrations', 'read'), controller.listWidgets);
router.get('/data-sources', requirePermission('integrations', 'read'), controller.listDataSources);

router.get(
  '/instances',
  requirePermission('integrations', 'read'),
  validate(listInstancesQuerySchema, 'query'),
  controller.listInstances
);

router.get(
  '/instances/:id',
  requirePermission('integrations', 'read'),
  validate(idParamsSchema, 'params'),
  controller.getInstance
);

router.get(
  '/instances/:id/data',
  requirePermission('integrations', 'read'),
  validate(idParamsSchema, 'params'),
  controller.getInstanceData
);

router.post(
  '/instances',
  requirePermission('integrations', 'manage'),
  validate(widgetInstanceCreateBody),
  controller.createInstance
);

router.patch(
  '/instances/:id',
  requirePermission('integrations', 'manage'),
  validateMergedParamsBody(widgetInstancePatchMerged),
  controller.patchInstance
);

router.delete(
  '/instances/:id',
  requirePermission('integrations', 'manage'),
  validate(idParamsSchema, 'params'),
  controller.deleteInstance
);

router.post(
  '/instances/:id/validate',
  requirePermission('integrations', 'read'),
  validate(idParamsSchema, 'params'),
  controller.validateInstance
);

module.exports = { widgetRuntimeRouter: router };
