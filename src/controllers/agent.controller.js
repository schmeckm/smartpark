'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { AgentRunService } = require('../services/agentic/agent-run.service');
const { AgentProposalService } = require('../services/agentic/agent-proposal.service');

const agentRunService = new AgentRunService();
const agentProposalService = new AgentProposalService();

function assertBodyParkMatchesHeader(req) {
  const parkId = req.validated?.parkId ?? req.body?.parkId;
  if (String(parkId || '') !== String(req.parkContext?.id || '')) {
    throw new AppError('parkId must match X-Park-Id park context', 403, { code: 'PARK_CONTEXT_MISMATCH' });
  }
}

const listRuns = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const { items, total } = await agentRunService.listForPark(parkId, {
    limit: q.limit,
    offset: q.offset,
    skillId: q.skillId,
    status: q.status,
  });
  res.json({ success: true, data: { items, total, limit: q.limit, offset: q.offset } });
});

const getRun = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const detail = await agentRunService.getDetailForPark(req.params.id, parkId);
  if (!detail) throw new AppError('Agent run not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: detail });
});

const createRun = asyncHandler(async (req, res) => {
  assertBodyParkMatchesHeader(req);
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  const detail = await agentRunService.triggerManual({
    skillId: body.skillId,
    parkId,
    userId: req.user?.id ?? null,
    triggerType: body.triggerType,
    crowdEventId: body.crowdEventId ?? null,
    rideId: body.rideId ?? null,
  });
  res.status(201).json({ success: true, data: detail });
});

const preflight = asyncHandler(async (req, res) => {
  assertBodyParkMatchesHeader(req);
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  const data = await agentRunService.preflight({
    parkId,
    skillId: body.skillId,
    sourceRunId: body.sourceRunId ?? null,
  });
  res.json({ success: true, data });
});

const replayRun = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const detail = await agentRunService.replayFromRun({
    parkId,
    sourceRunId: req.params.id,
    userId: req.user?.id ?? null,
  });
  res.status(201).json({ success: true, data: detail });
});

const getApprovalMetrics = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const data = await agentRunService.getApprovalMetrics({
    parkId,
    skillId: q.skillId ?? null,
    sinceDays: q.sinceDays,
  });
  res.json({ success: true, data });
});

const listPendingActions = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const { items, total } = await agentProposalService.listPendingForPark(parkId, {
    limit: q.limit,
    offset: q.offset,
  });
  res.json({ success: true, data: { items, total, limit: q.limit, offset: q.offset } });
});

const approveAction = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await agentProposalService.approve(req.params.id, parkId, req.user);
  res.json({ success: true, data });
});

const rejectAction = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const body = req.validated || {};
  const data = await agentProposalService.reject(req.params.id, parkId, req.user, body.reason ?? null);
  res.json({ success: true, data });
});

module.exports = {
  listRuns,
  getRun,
  createRun,
  preflight,
  replayRun,
  getApprovalMetrics,
  listPendingActions,
  approveAction,
  rejectAction,
};
