'use strict';

const { asyncHandler } = require('../../../utils/async-handler');
const { AuditLogService } = require('../../../services/audit-log.service');
const { IntegrationFlowService } = require('../services/integration-flow.service');
const { IntegrationFlowRunner } = require('../runtime/integration-flow-runner');
const { IntegrationFlowFailureInboxService } = require('../services/integration-flow-failure-inbox.service');
const integrationFlowTemplateService = require('../services/integration-flow-template.service');
const integrationNodeRegistry = require('../services/integration-node-registry.service');

const auditLogService = new AuditLogService();
const flowService = new IntegrationFlowService({ auditLogService });
const flowRunner = new IntegrationFlowRunner({ auditLogService });
const failureInboxService = new IntegrationFlowFailureInboxService({ auditLogService });

const listFlows = asyncHandler(async (req, res) => {
  const parkId = req.validated?.parkId ? String(req.validated.parkId) : null;
  const limit = req.validated?.limit != null ? Number(req.validated.limit) : 100;
  const offset = req.validated?.offset != null ? Number(req.validated.offset) : 0;
  const data = await flowService.list({ parkId, limit, offset });
  res.json({ success: true, data });
});

const getFlow = asyncHandler(async (req, res) => {
  const data = await flowService.getById(req.validated.id);
  res.json({ success: true, data });
});

const createFlow = asyncHandler(async (req, res) => {
  const body = req.validated;
  const data = await flowService.create(body, { userId: req.user?.id ?? null, email: req.user?.email ?? null });
  res.status(201).json({ success: true, data });
});

const patchFlow = asyncHandler(async (req, res) => {
  const { id, ...body } = req.validated;
  const data = await flowService.update(id, body, {
    userId: req.user?.id ?? null,
    email: req.user?.email ?? null,
  });
  res.json({ success: true, data });
});

const recalculateFlowSchedule = asyncHandler(async (req, res) => {
  const { id } = req.validated;
  const data = await flowService.recalculateSchedule(id, {
    userId: req.user?.id ?? null,
    email: req.user?.email ?? null,
  });
  res.json({ success: true, data });
});

const manualRetryRun = asyncHandler(async (req, res) => {
  const { runId } = req.validated;
  const data = await flowRunner.runManualRetryFromFailedRun(runId, {
    userId: req.user?.id ?? null,
    email: req.user?.email ?? null,
  });
  res.json({ success: true, data });
});

const deleteFlow = asyncHandler(async (req, res) => {
  await flowService.deleteById(req.validated.id, { userId: req.user?.id ?? null });
  res.status(204).send();
});

const validateFlow = asyncHandler(async (req, res) => {
  const data = await flowService.validateStored(req.validated.id);
  res.json({ success: true, data });
});

const runFlow = asyncHandler(async (req, res) => {
  const { id, input } = req.validated;
  const summary = await flowRunner.runByFlowId(id, input, { userId: req.user?.id ?? null });
  res.json({ success: true, data: summary });
});

const listRuns = asyncHandler(async (req, res) => {
  const data = await flowService.listRuns(req.validated.id, {
    limit: Math.min(200, Number(req.query.limit) || 50),
    offset: Number(req.query.offset) || 0,
  });
  res.json({ success: true, data });
});

const getRun = asyncHandler(async (req, res) => {
  const data = await flowService.getRunById(req.validated.runId);
  res.json({ success: true, data });
});

const listFailures = asyncHandler(async (req, res) => {
  const v = req.validated || {};
  const data = await failureInboxService.list({
    flowId: v.flowId,
    retryStatus: v.retryStatus,
    nodeType: v.nodeType,
    acknowledged: v.acknowledged,
    from: v.from || undefined,
    to: v.to || undefined,
    limit: v.limit,
    offset: v.offset,
  });
  res.json({ success: true, data });
});

const acknowledgeFailureRun = asyncHandler(async (req, res) => {
  const { runId, note } = req.validated;
  const data = await failureInboxService.acknowledge(runId, {
    note: note ?? null,
    userId: req.user?.id ?? null,
    email: req.user?.email ?? null,
  });
  res.json({ success: true, data });
});

const listNodes = asyncHandler(async (_req, res) => {
  await integrationNodeRegistry.ensureSynced();
  const data = await integrationNodeRegistry.listEnabledMetadata();
  res.json({ success: true, data });
});

const listTemplates = asyncHandler(async (_req, res) => {
  const data = integrationFlowTemplateService.listTemplates();
  res.json({ success: true, data });
});

const createFromTemplate = asyncHandler(async (req, res) => {
  const body = req.validated;
  const flowJson = await integrationFlowTemplateService.buildFlowJsonForCreate(
    body.templateKey,
    body.configOverrides
  );
  const data = await flowService.create(
    {
      name: body.name,
      parkId: body.parkId ?? null,
      description: body.description ?? null,
      enabled: body.enabled === true,
      triggerType: 'MANUAL',
      flowJson,
    },
    { userId: req.user?.id ?? null, email: req.user?.email ?? null }
  );
  res.status(201).json({ success: true, data });
});

module.exports = {
  listFlows,
  getFlow,
  createFlow,
  createFromTemplate,
  patchFlow,
  recalculateFlowSchedule,
  manualRetryRun,
  deleteFlow,
  validateFlow,
  runFlow,
  listRuns,
  getRun,
  listFailures,
  acknowledgeFailureRun,
  listNodes,
  listTemplates,
};
