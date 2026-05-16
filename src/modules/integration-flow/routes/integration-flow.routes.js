'use strict';

const { Router } = require('express');
const env = require('../../../config/env');
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { validate, validateMerged, validateMergedParamsBody } = require('../../../middleware/validate.middleware');
const controller = require('../controllers/integration-flow.controller');
const {
  integrationFlowCreateBody,
  integrationFlowFromTemplateBody,
  integrationFlowPatchMerged,
  integrationFlowScheduleRecalculateMerged,
  integrationFlowFailuresQueryMerged,
  integrationFlowAcknowledgeMerged,
  idParamsSchema,
  runIdParamsSchema,
  integrationFlowRunMerged,
  listFlowsQuerySchema,
} = require('../../../validators/integration-flow.schemas');

const router = Router();

function integrationFlowEngineGate(_req, res, next) {
  if (!env.integrationFlowEngineEnabled) {
    return res.status(404).json({ success: false, message: 'Not found', code: 'NOT_FOUND' });
  }
  next();
}

router.use(integrationFlowEngineGate);

router.get(
  '/failures',
  requirePermission('integrations', 'read'),
  validateMerged(integrationFlowFailuresQueryMerged),
  controller.listFailures
);

router.get(
  '/runs/:runId',
  requirePermission('integrations', 'read'),
  validateMerged(runIdParamsSchema),
  controller.getRun
);

router.post(
  '/runs/:runId/retry',
  requirePermission('integrations', 'manage'),
  validateMerged(runIdParamsSchema),
  controller.manualRetryRun
);

router.post(
  '/runs/:runId/acknowledge',
  requirePermission('integrations', 'manage'),
  validateMergedParamsBody(integrationFlowAcknowledgeMerged),
  controller.acknowledgeFailureRun
);

router.get('/', requirePermission('integrations', 'read'), validateMerged(listFlowsQuerySchema), controller.listFlows);

router.get('/templates', requirePermission('integrations', 'read'), controller.listTemplates);

router.post(
  '/from-template',
  requirePermission('integrations', 'manage'),
  validate(integrationFlowFromTemplateBody),
  controller.createFromTemplate
);

router.post(
  '/',
  requirePermission('integrations', 'manage'),
  validate(integrationFlowCreateBody),
  controller.createFlow
);

router.get('/:id', requirePermission('integrations', 'read'), validate(idParamsSchema, 'params'), controller.getFlow);

router.patch(
  '/:id',
  requirePermission('integrations', 'manage'),
  validateMergedParamsBody(integrationFlowPatchMerged),
  controller.patchFlow
);

router.post(
  '/:id/schedule/recalculate',
  requirePermission('integrations', 'manage'),
  validateMerged(integrationFlowScheduleRecalculateMerged),
  controller.recalculateFlowSchedule
);

router.delete('/:id', requirePermission('integrations', 'manage'), validate(idParamsSchema, 'params'), controller.deleteFlow);

router.post(
  '/:id/validate',
  requirePermission('integrations', 'read'),
  validate(idParamsSchema, 'params'),
  controller.validateFlow
);

router.post(
  '/:id/run',
  requirePermission('integrations', 'manage'),
  validateMergedParamsBody(integrationFlowRunMerged),
  controller.runFlow
);

router.get('/:id/runs', requirePermission('integrations', 'read'), validate(idParamsSchema, 'params'), controller.listRuns);

module.exports = { integrationFlowRouter: router };
