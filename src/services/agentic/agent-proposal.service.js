'use strict';

const { Op } = require('sequelize');
const { AgentAction, AgentRun, Forecast } = require('../../models');
const { AppError } = require('../../utils/app-error');
const { getToolRegistry } = require('./runtime/tool-registry');
const { AuditLogService } = require('../audit-log.service');
const AUDIT = require('../../constants/audit-actions');

const auditLogService = new AuditLogService();

function serializeRunBrief(runRow) {
  const r = runRow?.get ? runRow.get({ plain: true }) : runRow;
  if (!r) return null;
  return {
    id: r.id,
    skillId: r.skillId,
    mode: r.mode,
    status: r.status,
    startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
  };
}

function serializePendingAction(row) {
  const a = row.get({ plain: true });
  return {
    id: a.id,
    runId: a.runId,
    stepId: a.stepId,
    actionType: a.actionType,
    status: a.status,
    payloadJson: a.payloadJson,
    outcomeMetric: a.outcomeMetric ?? null,
    expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
    createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
    run: serializeRunBrief(row.run),
  };
}

function serializeActionResult(row) {
  const a = row.get({ plain: true });
  return {
    id: a.id,
    runId: a.runId,
    stepId: a.stepId,
    actionType: a.actionType,
    status: a.status,
    payloadJson: a.payloadJson,
    resultJson: a.resultJson,
    outcomeMetric: a.outcomeMetric ?? null,
    expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null,
    approvedByUserId: a.approvedByUserId,
    approvedAt: a.approvedAt ? new Date(a.approvedAt).toISOString() : null,
    rejectedReason: a.rejectedReason,
    updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
  };
}

/**
 * Phase C stub — snapshot PARK-scope forecasts at resolution time for later vs-actual comparison.
 * @param {string} parkId
 * @param {{ skillId?: string|null }} runPlain
 */
async function buildForecastVsActualOutcomeStub(parkId, runPlain) {
  const base = {
    version: 1,
    bridge: 'forecast_vs_actual_stub_v1',
    recordedAt: new Date().toISOString(),
    agentRunSkillId: runPlain?.skillId != null ? String(runPlain.skillId) : null,
    actualMetricsNote:
      'Persisted actuals comparison not wired in this stub — use forecast sample + post-hoc KPI jobs when available.',
  };

  try {
    const now = new Date();
    const baseWhere = {
      [Op.and]: [
        { subjectType: 'PARK' },
        { [Op.or]: [{ subjectId: parkId }, { subjectId: null }] },
        { [Op.or]: [{ expiresAt: { [Op.gt]: now } }, { expiresAt: null }] },
      ],
    };

    const parkForecastRowCount = await Forecast.count({ where: baseWhere });

    const sampleRows = await Forecast.findAll({
      where: baseWhere,
      order: [['producedAt', 'DESC']],
      limit: 5,
      attributes: [
        'id',
        'targetMetric',
        'horizonMinutes',
        'predictedValue',
        'confidence',
        'producedAt',
        'expiresAt',
      ],
    });

    const sampleForecasts = sampleRows.map((r) => {
      const p = r.get({ plain: true });
      return {
        id: p.id,
        targetMetric: p.targetMetric,
        horizonMinutes: p.horizonMinutes,
        predictedValue: p.predictedValue != null ? Number(p.predictedValue) : null,
        confidence: p.confidence != null ? Number(p.confidence) : null,
        producedAt: p.producedAt ? new Date(p.producedAt).toISOString() : null,
        expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
      };
    });

    return { ...base, parkForecastRowCount, sampleForecasts };
  } catch (err) {
    return {
      ...base,
      parkForecastRowCount: null,
      sampleForecasts: [],
      forecastSnapshotError: err instanceof Error ? err.message : String(err),
    };
  }
}

function truncateReason(reason, max = 400) {
  const s = reason == null ? '' : String(reason).trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

class AgentProposalService {
  async listPendingForPark(parkId, { limit = 50, offset = 0 } = {}) {
    const { rows, count } = await AgentAction.findAndCountAll({
      where: { status: 'proposed' },
      include: [
        {
          model: AgentRun,
          as: 'run',
          where: { parkId },
          required: true,
          attributes: ['id', 'skillId', 'mode', 'status', 'startedAt'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return { items: rows.map(serializePendingAction), total: count };
  }

  async approve(actionId, parkId, user) {
    const action = await AgentAction.findOne({
      where: { id: actionId },
      include: [{ model: AgentRun, as: 'run', required: true }],
    });

    if (!action || String(action.run.parkId) !== String(parkId)) {
      throw new AppError('Agent action not found', 404, { code: 'NOT_FOUND' });
    }
    if (action.status !== 'proposed') {
      throw new AppError('Action is not awaiting approval', 422, { code: 'AGENT_ACTION_NOT_PROPOSED' });
    }
    if (action.expiresAt && new Date(action.expiresAt) < new Date()) {
      await action.update({ status: 'expired' });
      throw new AppError('Proposal expired', 410, { code: 'AGENT_ACTION_EXPIRED' });
    }

    const toolRegistry = getToolRegistry();
    let result;
    try {
      result = await toolRegistry.execute(
        action.actionType,
        {
          parkId,
          applyApproved: true,
          actingUser: user,
          runId: action.runId,
        },
        action.payloadJson || {}
      );
    } catch (err) {
      const runPlain = action.run?.get ? action.run.get({ plain: true }) : action.run;
      const outcomeStub = await buildForecastVsActualOutcomeStub(parkId, runPlain || {});
      await action.update({
        status: 'failed',
        resultJson: { error: err instanceof Error ? err.message : String(err) },
        outcomeMetric: {
          ...outcomeStub,
          resolution: 'apply_failed',
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }

    const runPlain = action.run?.get ? action.run.get({ plain: true }) : action.run;
    const outcomeMetric = await buildForecastVsActualOutcomeStub(parkId, runPlain || {});

    await action.update({
      status: 'applied',
      resultJson: result !== undefined && result !== null && typeof result === 'object' ? result : { value: result },
      approvedByUserId: user.id,
      approvedAt: new Date(),
      outcomeMetric: {
        ...outcomeMetric,
        resolution: 'applied',
      },
    });

    await auditLogService.log({
      action: AUDIT.AGENT_ACTION_APPROVED,
      entityType: 'agent_action',
      entityId: action.id,
      newValue: { actionType: action.actionType, runId: action.runId },
      userId: user.id,
    });

    await action.reload();
    return serializeActionResult(action);
  }

  async reject(actionId, parkId, user, reason = null) {
    const action = await AgentAction.findOne({
      where: { id: actionId },
      include: [{ model: AgentRun, as: 'run', required: true }],
    });

    if (!action || String(action.run.parkId) !== String(parkId)) {
      throw new AppError('Agent action not found', 404, { code: 'NOT_FOUND' });
    }
    if (action.status !== 'proposed') {
      throw new AppError('Action is not awaiting approval', 422, { code: 'AGENT_ACTION_NOT_PROPOSED' });
    }

    const runPlain = action.run?.get ? action.run.get({ plain: true }) : action.run;
    const forecastStub = await buildForecastVsActualOutcomeStub(parkId, runPlain || {});

    await action.update({
      status: 'rejected',
      rejectedReason: reason || null,
      approvedByUserId: user.id,
      approvedAt: new Date(),
      outcomeMetric: {
        ...forecastStub,
        resolution: 'rejected',
        reasonSnippet: truncateReason(reason),
      },
    });

    await auditLogService.log({
      action: AUDIT.AGENT_ACTION_REJECTED,
      entityType: 'agent_action',
      entityId: action.id,
      newValue: { actionType: action.actionType, reason: reason || null },
      userId: user.id,
    });

    await action.reload();
    return serializeActionResult(action);
  }
}

module.exports = { AgentProposalService };
