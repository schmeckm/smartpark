'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate } = require('../../middleware/validate.middleware');
const {
  listAgentRunsQuery,
  agentRunIdParams,
  createAgentRunBody,
  agentPreflightBody,
  agentApprovalMetricsQuery,
  listPendingActionsQuery,
  agentActionIdParams,
  rejectAgentActionBody,
} = require('../../validators/agent.schemas');
const agentController = require('../../controllers/agent.controller');

const router = Router();

router.use(requireParkContext);

router.get(
  '/actions',
  requirePermission('agent', 'review'),
  validate(listPendingActionsQuery, 'query'),
  agentController.listPendingActions
);

router.post(
  '/actions/:id/approve',
  requirePermission('agent', 'approve'),
  validate(agentActionIdParams, 'params'),
  agentController.approveAction
);

router.post(
  '/actions/:id/reject',
  requirePermission('agent', 'review'),
  validate(agentActionIdParams, 'params'),
  validate(rejectAgentActionBody),
  agentController.rejectAction
);

router.get('/runs', requirePermission('agent', 'read'), validate(listAgentRunsQuery, 'query'), agentController.listRuns);

router.get(
  '/approval-metrics',
  requirePermission('agent', 'read'),
  validate(agentApprovalMetricsQuery, 'query'),
  agentController.getApprovalMetrics
);

router.post(
  '/preflight',
  requirePermission('agent', 'run'),
  validate(agentPreflightBody),
  agentController.preflight
);

router.post(
  '/runs/:id/replay',
  requirePermission('agent', 'run'),
  validate(agentRunIdParams, 'params'),
  agentController.replayRun
);

router.get(
  '/runs/:id',
  requirePermission('agent', 'read'),
  validate(agentRunIdParams, 'params'),
  agentController.getRun
);

router.post('/runs', requirePermission('agent', 'run'), validate(createAgentRunBody), agentController.createRun);

module.exports = { agentRouter: router };
