'use strict';

const { Op, fn, col, where: sqlWhere, literal } = require('sequelize');
const { IntegrationFlowRun, IntegrationFlowRunStep, IntegrationFlowDefinition } = require('../../../models');
const { AppError } = require('../../../utils/app-error');

const RETRY_STATUS_VALUES = new Set([
  'not_applicable',
  'pending_retry',
  'retry_succeeded',
  'retry_failed',
  'retry_exhausted',
]);

/**
 * @param {object} q
 * @param {string} [q.flowId]
 * @param {string} [q.retryStatus]
 * @param {string} [q.nodeType]
 * @param {'yes'|'no'|'all'} [q.acknowledged]
 * @param {string|Date} [q.from]
 * @param {string|Date} [q.to]
 * @param {number} [q.limit]
 * @param {number} [q.offset]
 */
async function listFailureInbox(q) {
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
  const offset = Math.max(0, Number(q.offset ?? 0));

  /** @type {import('sequelize').WhereOptions} */
  const where = { status: 'failed' };

  if (q.flowId) where.flowId = String(q.flowId);

  if (q.retryStatus) {
    const rs = String(q.retryStatus);
    if (!RETRY_STATUS_VALUES.has(rs)) {
      throw new AppError('Invalid retryStatus filter', 422, { code: 'INVALID_QUERY' });
    }
    where.retryStatus = rs;
  }

  const ack = q.acknowledged != null ? String(q.acknowledged) : 'all';
  if (ack === 'yes') {
    where.acknowledgedAt = { [Op.ne]: null };
  } else if (ack === 'no') {
    where.acknowledgedAt = null;
  } else if (ack !== 'all') {
    throw new AppError('Invalid acknowledged filter', 422, { code: 'INVALID_QUERY' });
  }

  if (q.from != null || q.to != null) {
    const from = q.from != null ? new Date(q.from) : null;
    const to = q.to != null ? new Date(q.to) : null;
    if (from && Number.isNaN(from.getTime())) {
      throw new AppError('Invalid from date', 422, { code: 'INVALID_QUERY' });
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new AppError('Invalid to date', 422, { code: 'INVALID_QUERY' });
    }
    const coalesced = fn('COALESCE', col('IntegrationFlowRun.finished_at'), col('IntegrationFlowRun.started_at'));
    if (from && to) {
      where[Op.and] = [...(Array.isArray(where[Op.and]) ? where[Op.and] : []), sqlWhere(coalesced, { [Op.between]: [from, to] })];
    } else if (from) {
      where[Op.and] = [...(Array.isArray(where[Op.and]) ? where[Op.and] : []), sqlWhere(coalesced, { [Op.gte]: from })];
    } else if (to) {
      where[Op.and] = [...(Array.isArray(where[Op.and]) ? where[Op.and] : []), sqlWhere(coalesced, { [Op.lte]: to })];
    }
  }

  let runIdsFromNodeType = null;
  if (q.nodeType) {
    const nt = String(q.nodeType).slice(0, 80);
    const sequelize = IntegrationFlowRun.sequelize;
    const esc = sequelize.escape(nt);
    where.id = {
      [Op.in]: literal(`(SELECT run_id FROM integration_flow_run_steps WHERE status = 'failed' AND node_type = ${esc})`),
    };
  }

  const { rows: runs, count: total } = await IntegrationFlowRun.findAndCountAll({
    where,
    include: [
      {
        model: IntegrationFlowDefinition,
        as: 'flow',
        attributes: ['id', 'name', 'maxRetryAttempts', 'retryEnabled'],
        required: false,
      },
    ],
    limit,
    offset,
    order: [
      ['finishedAt', 'DESC'],
      ['startedAt', 'DESC'],
    ],
  });

  const runIds = runs.map((r) => r.id);
  const failedStepByRun = await loadFirstFailedStepPerRun(runIds);

  const items = runs.map((r) => {
    const plain = r.toJSON ? r.toJSON() : r;
    const flow = plain.flow || {};
    const step = failedStepByRun.get(plain.id) || {};
    return {
      runId: plain.id,
      flowId: plain.flowId,
      flowName: flow.name != null ? String(flow.name) : null,
      status: plain.status,
      retryStatus: plain.retryStatus ?? null,
      retryAttempt: plain.retryAttempt != null ? Number(plain.retryAttempt) : 0,
      maxRetryAttempts: flow.maxRetryAttempts != null ? Number(flow.maxRetryAttempts) : 0,
      retryEnabled: flow.retryEnabled === true,
      nextRetryAt: plain.nextRetryAt != null ? plain.nextRetryAt : null,
      startedAt: plain.startedAt ?? null,
      finishedAt: plain.finishedAt ?? null,
      durationMs: plain.durationMs != null ? Number(plain.durationMs) : null,
      errorMessage: plain.errorMessage ?? null,
      failedNodeId: step.nodeId != null ? String(step.nodeId) : null,
      failedNodeType: step.nodeType != null ? String(step.nodeType) : null,
      failedStepErrorMessage: step.errorMessage != null ? String(step.errorMessage) : null,
      acknowledgedAt: plain.acknowledgedAt ?? null,
      acknowledgedBy: plain.acknowledgedBy ?? null,
      acknowledgementNote: plain.acknowledgementNote ?? null,
    };
  });

  return { items, total, limit, offset };
}

/**
 * @param {string[]} runIds
 * @returns {Promise<Map<string, { nodeId: string, nodeType: string, errorMessage: string|null }>>}
 */
async function loadFirstFailedStepPerRun(runIds) {
  const map = new Map();
  if (!runIds.length) return map;

  const steps = await IntegrationFlowRunStep.findAll({
    where: { runId: { [Op.in]: runIds }, status: 'failed' },
    order: [
      ['startedAt', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });
  for (const s of steps) {
    const p = s.toJSON ? s.toJSON() : s;
    if (!map.has(p.runId)) {
      map.set(p.runId, {
        nodeId: p.nodeId,
        nodeType: p.nodeType,
        errorMessage: p.errorMessage,
      });
    }
  }
  return map;
}

/**
 * @param {string} runId
 * @param {{ note?: string|null, userId?: string|null, email?: string|null, auditLogService?: { log: Function } }} ctx
 */
async function acknowledgeFailedRun(runId, ctx = {}) {
  const row = await IntegrationFlowRun.findByPk(runId);
  if (!row) throw new AppError('Run not found', 404, { code: 'NOT_FOUND' });
  if (row.status !== 'failed') {
    throw new AppError('Only failed runs can be acknowledged', 422, { code: 'ACK_NOT_ALLOWED' });
  }

  const note = ctx.note != null && String(ctx.note).trim() !== '' ? String(ctx.note).trim().slice(0, 1000) : null;
  const actor = ctx.email || (ctx.userId ? String(ctx.userId) : null) || 'system';

  await row.update({
    acknowledgedAt: new Date(),
    acknowledgedBy: actor,
    acknowledgementNote: note,
  });

  try {
    await ctx.auditLogService?.log({
      action: 'integration_flow.failure_acknowledged',
      entityType: 'IntegrationFlowRun',
      entityId: row.id,
      newValue: { flowId: row.flowId, note },
      userId: ctx.userId ?? null,
    });
  } catch {
    /* non-fatal */
  }

  const after = await IntegrationFlowRun.findByPk(runId, {
    include: [{ model: IntegrationFlowDefinition, as: 'flow', attributes: ['id', 'name', 'maxRetryAttempts', 'retryEnabled'], required: false }],
  });
  const plain = after.toJSON ? after.toJSON() : after;
  const flow = plain.flow || {};
  const failedStepByRun = await loadFirstFailedStepPerRun([runId]);
  const step = failedStepByRun.get(runId) || {};
  return {
    runId: plain.id,
    flowId: plain.flowId,
    flowName: flow.name != null ? String(flow.name) : null,
    status: plain.status,
    retryStatus: plain.retryStatus ?? null,
    retryAttempt: plain.retryAttempt != null ? Number(plain.retryAttempt) : 0,
    maxRetryAttempts: flow.maxRetryAttempts != null ? Number(flow.maxRetryAttempts) : 0,
    retryEnabled: flow.retryEnabled === true,
    nextRetryAt: plain.nextRetryAt ?? null,
    startedAt: plain.startedAt ?? null,
    finishedAt: plain.finishedAt ?? null,
    durationMs: plain.durationMs != null ? Number(plain.durationMs) : null,
    errorMessage: plain.errorMessage ?? null,
    failedNodeId: step.nodeId != null ? String(step.nodeId) : null,
    failedNodeType: step.nodeType != null ? String(step.nodeType) : null,
    failedStepErrorMessage: step.errorMessage != null ? String(step.errorMessage) : null,
    acknowledgedAt: plain.acknowledgedAt ?? null,
    acknowledgedBy: plain.acknowledgedBy ?? null,
    acknowledgementNote: plain.acknowledgementNote ?? null,
  };
}

class IntegrationFlowFailureInboxService {
  /**
   * @param {{ auditLogService?: import('../../../services/audit-log.service').AuditLogService }} [deps]
   */
  constructor(deps = {}) {
    this.auditLogService = deps.auditLogService || null;
  }

  list(filters) {
    return listFailureInbox(filters);
  }

  acknowledge(runId, opts) {
    return acknowledgeFailedRun(runId, { ...opts, auditLogService: this.auditLogService });
  }
}

module.exports = {
  IntegrationFlowFailureInboxService,
  listFailureInbox,
  acknowledgeFailedRun,
  RETRY_STATUS_VALUES,
};
