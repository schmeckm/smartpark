'use strict';

const { AgentRun, AgentStep, AgentAction } = require('../../models');
const { AppError } = require('../../utils/app-error');
const { executeAgentSkill } = require('./runtime/agent-runner');
const { runPreflight } = require('./agent-preflight.service');
const { getApprovalSummaryForPark } = require('./agent-approval-metrics.service');

function serializeStep(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    runId: p.runId,
    stepIndex: p.stepIndex,
    stepType: p.stepType,
    title: p.title,
    detailJson: p.detailJson,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
  };
}

function serializeAction(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    runId: p.runId,
    stepId: p.stepId,
    actionType: p.actionType,
    status: p.status,
    payloadJson: p.payloadJson,
    resultJson: p.resultJson,
    expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
    targetType: p.targetType ?? null,
    targetId: p.targetId ?? null,
    approvedByUserId: p.approvedByUserId ?? null,
    approvedAt: p.approvedAt ? new Date(p.approvedAt).toISOString() : null,
    rejectedReason: p.rejectedReason ?? null,
    outcomeMetric: p.outcomeMetric ?? null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
  };
}

function serializeRunSummary(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    parkId: p.parkId,
    skillId: p.skillId,
    mode: p.mode ?? 'auto',
    triggerType: p.triggerType,
    triggerRef: p.triggerRef ?? null,
    status: p.status,
    startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : null,
    finishedAt: p.finishedAt ? new Date(p.finishedAt).toISOString() : null,
    createdByUserId: p.createdByUserId,
    errorMessage: p.errorMessage,
  };
}

function serializeRunDetail(run, steps, actions) {
  const p = run.get ? run.get({ plain: true }) : run;
  return {
    id: p.id,
    parkId: p.parkId,
    skillId: p.skillId,
    mode: p.mode ?? 'auto',
    triggerType: p.triggerType,
    triggerRef: p.triggerRef ?? null,
    status: p.status,
    startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : null,
    finishedAt: p.finishedAt ? new Date(p.finishedAt).toISOString() : null,
    inputJson: p.inputJson,
    outputSummary: p.outputSummary,
    errorMessage: p.errorMessage,
    metaJson: p.metaJson,
    createdByUserId: p.createdByUserId,
    steps: steps.map(serializeStep),
    actions: actions.map(serializeAction),
  };
}

class AgentRunService {
  async listForPark(parkId, { limit, offset, skillId, status }) {
    const where = { parkId };
    if (skillId) where.skillId = skillId;
    if (status) where.status = status;

    const { rows, count } = await AgentRun.findAndCountAll({
      where,
      order: [['startedAt', 'DESC']],
      limit,
      offset,
    });

    return { items: rows.map(serializeRunSummary), total: count };
  }

  async getDetailForPark(id, parkId) {
    const run = await AgentRun.findOne({ where: { id, parkId } });
    if (!run) return null;

    const steps = await AgentStep.findAll({
      where: { runId: run.id },
      order: [['stepIndex', 'ASC']],
    });
    const actions = await AgentAction.findAll({
      where: { runId: run.id },
      order: [['createdAt', 'ASC']],
    });

    return serializeRunDetail(run, steps, actions);
  }

  async triggerManual({ skillId, parkId, userId, triggerType, crowdEventId, rideId }) {
    const runId = await executeAgentSkill({
      skillId,
      parkId,
      userId,
      triggerType,
      crowdEventId,
      rideId,
      replayOfRunId: null,
    });
    const detail = await this.getDetailForPark(runId, parkId);
    return detail;
  }

  /** Phase C — checklist + optional source-run comparison (simulator hook = stub). */
  async preflight({ parkId, skillId, sourceRunId }) {
    const report = await runPreflight({ parkId, skillId, sourceRunId: sourceRunId || null });
    const approvalMetrics = await getApprovalSummaryForPark(parkId, { skillId, sinceDays: 30 });
    const minRate = parseApprovalGateMin();
    const gateOk =
      approvalMetrics.decided === 0 ||
      (approvalMetrics.approvalRate != null && approvalMetrics.approvalRate >= minRate);
    report.checklist.push({
      id: 'approval_rate_gate',
      ok: gateOk,
      detail:
        approvalMetrics.decided === 0
          ? `No resolved write proposals in last ${approvalMetrics.windowDays}d (skill filter: ${approvalMetrics.skillFilter || 'all'}) — gate skipped.`
          : `Approval rate ${(approvalMetrics.approvalRate * 100).toFixed(1)}% (${approvalMetrics.applied}/${approvalMetrics.decided} applied) vs minimum ${(minRate * 100).toFixed(0)}% (AGENT_APPROVAL_GATE_MIN).`,
    });
    report.ok = report.checklist.every((c) => c.ok);
    return { ...report, approvalMetrics, approvalGateMin: minRate };
  }

  /** Phase C — rolling approval rate for write proposals (same park scope as runs). */
  async getApprovalMetrics({ parkId, skillId, sinceDays }) {
    return getApprovalSummaryForPark(parkId, {
      skillId: skillId || null,
      sinceDays: sinceDays || 30,
    });
  }

  /** Phase C — re-execute skill from a prior run's stored inputs (new `agent_runs` row). */
  async replayFromRun({ parkId, sourceRunId, userId }) {
    const source = await AgentRun.findOne({ where: { id: sourceRunId, parkId } });
    if (!source) {
      throw new AppError('Source agent run not found', 404, { code: 'NOT_FOUND' });
    }
    const plain = source.get({ plain: true });
    const input = plain.inputJson && typeof plain.inputJson === 'object' ? plain.inputJson : {};
    const skillId = String(plain.skillId || input.skillId || '').trim();
    const runId = await executeAgentSkill({
      skillId,
      parkId,
      userId,
      triggerType: 'replay',
      crowdEventId: input.crowdEventId ?? null,
      rideId: input.rideId ?? null,
      replayOfRunId: String(sourceRunId),
    });
    return this.getDetailForPark(runId, parkId);
  }
}

function parseApprovalGateMin() {
  const raw = process.env.AGENT_APPROVAL_GATE_MIN;
  if (raw == null || String(raw).trim() === '') return 0.6;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.6;
  return n;
}

module.exports = { AgentRunService };
