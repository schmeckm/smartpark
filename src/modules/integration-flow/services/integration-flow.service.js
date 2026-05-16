'use strict';

const { IntegrationFlowDefinition, IntegrationFlowRun, IntegrationFlowRunStep } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const { validateIntegrationFlowScheduleState, validateIntegrationFlowRetryState } = require('../../../validators/integration-flow.schemas');
const { validateFlowJson } = require('./integration-flow-validation.service');

function computeNextRunAt(intervalSec) {
  return new Date(Date.now() + Number(intervalSec) * 1000);
}

async function validateRetryNodeTypesList(types) {
  if (!types || !Array.isArray(types) || !types.length) return;
  const integrationNodeRegistry = require('./integration-node-registry.service');
  await integrationNodeRegistry.ensureSynced();
  for (const t of types) {
    const ok = await integrationNodeRegistry.assertNodeTypeEnabled(String(t));
    if (!ok.ok) {
      throw new AppError(`Invalid retry_on_node_types entry: ${t}`, 422, { code: 'INVALID_RETRY_FILTER' });
    }
  }
}
class IntegrationFlowService {
  /**
   * @param {{ auditLogService?: import('../../../services/audit-log.service').AuditLogService }} [deps]
   */
  constructor(deps = {}) {
    this.auditLogService = deps.auditLogService || null;
  }

  async list({ parkId = null, limit = 100, offset = 0 } = {}) {
    const where = {};
    if (parkId) where.parkId = parkId;
    const rows = await IntegrationFlowDefinition.findAll({
      where,
      limit,
      offset,
      order: [['updatedAt', 'DESC']],
    });
    return rows.map((r) => (r.toJSON ? r.toJSON() : r));
  }

  async getById(id) {
    const row = await IntegrationFlowDefinition.findByPk(id);
    if (!row) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    return row.toJSON ? row.toJSON() : row;
  }

  async create(body, { userId = null, email = null } = {}) {
    const validation = await validateFlowJson(body.flowJson);
    if (!validation.valid) {
      throw new AppError('Invalid flow_json', 422, { code: 'FLOW_INVALID', details: validation.errors });
    }
    validateIntegrationFlowScheduleState({
      enabled: body.enabled === true,
      scheduleEnabled: body.scheduleEnabled === true,
      scheduleIntervalSeconds: body.scheduleIntervalSeconds ?? null,
    });
    const retryEnabled = body.retryEnabled === true;
    const maxRetryAttempts = retryEnabled ? Number(body.maxRetryAttempts) : 0;
    const retryDelaySeconds = retryEnabled ? body.retryDelaySeconds ?? null : null;
    const retryOnNodeTypes =
      retryEnabled && Array.isArray(body.retryOnNodeTypes) && body.retryOnNodeTypes.length ? body.retryOnNodeTypes : null;
    validateIntegrationFlowRetryState({
      enabled: body.enabled === true,
      retryEnabled,
      maxRetryAttempts,
      retryDelaySeconds,
      retryOnNodeTypes: retryEnabled ? retryOnNodeTypes : body.retryOnNodeTypes ?? null,
    });
    await validateRetryNodeTypesList(retryOnNodeTypes);
    const scheduleEnabled = body.scheduleEnabled === true;
    const interval = scheduleEnabled ? Number(body.scheduleIntervalSeconds) : null;
    const actor = email || (userId ? String(userId) : null);
    const row = await IntegrationFlowDefinition.create({
      parkId: body.parkId ?? null,
      name: body.name,
      description: body.description ?? null,
      enabled: body.enabled === true,
      triggerType: body.triggerType || 'MANUAL',
      flowJson: body.flowJson,
      scheduleEnabled,
      scheduleIntervalSeconds: scheduleEnabled ? interval : null,
      nextScheduledRunAt: scheduleEnabled && interval ? computeNextRunAt(interval) : null,
      lastScheduledRunAt: null,
      scheduleLockUntil: null,
      retryEnabled,
      maxRetryAttempts,
      retryDelaySeconds: retryEnabled ? Number(retryDelaySeconds) : null,
      retryOnNodeTypes: retryOnNodeTypes,
      createdBy: actor,
      updatedBy: actor,
    });
    try {
      await this.auditLogService?.log({
        action: 'integration_flow.created',
        entityType: 'IntegrationFlowDefinition',
        entityId: row.id,
        newValue: { name: row.name },
        userId,
      });
      if (scheduleEnabled) {
        await this.auditLogService?.log({
          action: 'integration_flow.schedule_enabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          newValue: { scheduleIntervalSeconds: interval },
          userId,
        });
      }
      if (retryEnabled) {
        await this.auditLogService?.log({
          action: 'integration_flow.retry_config_enabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          newValue: { maxRetryAttempts, retryDelaySeconds },
          userId,
        });
      }
    } catch {
      /* */
    }
    return row.toJSON ? row.toJSON() : row;
  }

  async update(id, body, { userId = null, email = null } = {}) {
    const row = await IntegrationFlowDefinition.findByPk(id);
    if (!row) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    const before = row.toJSON ? row.toJSON() : row;
    if (body.flowJson != null) {
      const validation = await validateFlowJson(body.flowJson);
      if (!validation.valid) {
        throw new AppError('Invalid flow_json', 422, { code: 'FLOW_INVALID', details: validation.errors });
      }
    }

    let nextEnabled = before.enabled === true;
    if (body.enabled !== undefined) nextEnabled = body.enabled === true;
    let nextSched = before.scheduleEnabled === true;
    if (body.scheduleEnabled !== undefined) nextSched = body.scheduleEnabled === true;
    let nextIv = before.scheduleIntervalSeconds != null ? Number(before.scheduleIntervalSeconds) : null;
    if (body.scheduleIntervalSeconds !== undefined) nextIv = body.scheduleIntervalSeconds;

    if (!nextEnabled) {
      nextSched = false;
      nextIv = null;
    }

    validateIntegrationFlowScheduleState({
      enabled: nextEnabled,
      scheduleEnabled: nextSched,
      scheduleIntervalSeconds: nextIv,
    });

    let nextRe = before.retryEnabled === true;
    if (body.retryEnabled !== undefined) nextRe = body.retryEnabled === true;
    let nextMax = Number(before.maxRetryAttempts || 0);
    if (body.maxRetryAttempts !== undefined) nextMax = Number(body.maxRetryAttempts);
    let nextRd = before.retryDelaySeconds != null ? Number(before.retryDelaySeconds) : null;
    if (body.retryDelaySeconds !== undefined) nextRd = body.retryDelaySeconds;
    let nextTypes = before.retryOnNodeTypes;
    if (body.retryOnNodeTypes !== undefined) nextTypes = body.retryOnNodeTypes;

    if (!nextEnabled) {
      nextRe = false;
      nextMax = 0;
      nextRd = null;
      nextTypes = null;
    }

    validateIntegrationFlowRetryState({
      enabled: nextEnabled,
      retryEnabled: nextRe,
      maxRetryAttempts: nextMax,
      retryDelaySeconds: nextRd,
      retryOnNodeTypes: nextRe ? nextTypes : null,
    });
    await validateRetryNodeTypesList(
      nextRe && Array.isArray(nextTypes) && nextTypes.length ? nextTypes.map((x) => String(x)) : null
    );

    const actor = email || (userId ? String(userId) : null);
    const patch = {};
    if (body.name != null) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.enabled !== undefined) patch.enabled = nextEnabled;
    if (body.triggerType != null) patch.triggerType = body.triggerType;
    if (body.flowJson != null) patch.flowJson = body.flowJson;
    if (body.parkId !== undefined) patch.parkId = body.parkId || null;
    patch.scheduleEnabled = nextSched;
    patch.scheduleIntervalSeconds = nextSched ? nextIv : null;
    patch.retryEnabled = nextRe;
    patch.maxRetryAttempts = nextRe ? nextMax : 0;
    patch.retryDelaySeconds = nextRe ? nextRd : null;
    patch.retryOnNodeTypes = nextRe && Array.isArray(nextTypes) && nextTypes.length ? nextTypes : null;
    patch.updatedBy = actor;

    if (!nextSched) {
      patch.nextScheduledRunAt = null;
      patch.scheduleLockUntil = null;
    } else {
      const intervalNum = Number(nextIv);
      const schedTurnedOn = before.scheduleEnabled !== true && nextSched;
      const intervalChanged =
        before.scheduleIntervalSeconds == null || Number(before.scheduleIntervalSeconds) !== intervalNum;
      if (schedTurnedOn || (nextSched && body.scheduleIntervalSeconds !== undefined && intervalChanged)) {
        patch.nextScheduledRunAt = computeNextRunAt(intervalNum);
      }
    }

    await row.update(patch);
    const after = row.toJSON ? row.toJSON() : row;

    try {
      await this.auditLogService?.log({
        action: 'integration_flow.updated',
        entityType: 'IntegrationFlowDefinition',
        entityId: row.id,
        oldValue: { name: before.name, enabled: before.enabled },
        newValue: { name: after.name, enabled: after.enabled },
        userId,
      });
      if (before.scheduleEnabled !== true && after.scheduleEnabled === true) {
        await this.auditLogService?.log({
          action: 'integration_flow.schedule_enabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          newValue: { scheduleIntervalSeconds: after.scheduleIntervalSeconds },
          userId,
        });
      } else if (before.scheduleEnabled === true && after.scheduleEnabled !== true) {
        await this.auditLogService?.log({
          action: 'integration_flow.schedule_disabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          oldValue: { scheduleIntervalSeconds: before.scheduleIntervalSeconds },
          userId,
        });
      } else if (
        after.scheduleEnabled === true &&
        Number(before.scheduleIntervalSeconds || 0) !== Number(after.scheduleIntervalSeconds || 0)
      ) {
        await this.auditLogService?.log({
          action: 'integration_flow.schedule_interval_changed',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          oldValue: { scheduleIntervalSeconds: before.scheduleIntervalSeconds },
          newValue: { scheduleIntervalSeconds: after.scheduleIntervalSeconds },
          userId,
        });
      }
      if (before.retryEnabled !== true && after.retryEnabled === true) {
        await this.auditLogService?.log({
          action: 'integration_flow.retry_config_enabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          newValue: { maxRetryAttempts: after.maxRetryAttempts, retryDelaySeconds: after.retryDelaySeconds },
          userId,
        });
      } else if (before.retryEnabled === true && after.retryEnabled !== true) {
        await this.auditLogService?.log({
          action: 'integration_flow.retry_config_disabled',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          userId,
        });
      } else if (
        after.retryEnabled === true &&
        (Number(before.maxRetryAttempts || 0) !== Number(after.maxRetryAttempts || 0) ||
          Number(before.retryDelaySeconds || 0) !== Number(after.retryDelaySeconds || 0) ||
          JSON.stringify(before.retryOnNodeTypes || null) !== JSON.stringify(after.retryOnNodeTypes || null))
      ) {
        await this.auditLogService?.log({
          action: 'integration_flow.retry_config_changed',
          entityType: 'IntegrationFlowDefinition',
          entityId: row.id,
          oldValue: {
            maxRetryAttempts: before.maxRetryAttempts,
            retryDelaySeconds: before.retryDelaySeconds,
            retryOnNodeTypes: before.retryOnNodeTypes,
          },
          newValue: {
            maxRetryAttempts: after.maxRetryAttempts,
            retryDelaySeconds: after.retryDelaySeconds,
            retryOnNodeTypes: after.retryOnNodeTypes,
          },
          userId,
        });
      }
    } catch {
      /* */
    }
    return after;
  }

  /**
   * Reset next_scheduled_run_at from “now” (requires active schedule).
   * @param {string} id
   * @param {{ userId?: string|null, email?: string|null }} [actor]
   */
  async recalculateSchedule(id, { userId = null, email = null } = {}) {
    const row = await IntegrationFlowDefinition.findByPk(id);
    if (!row) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    const plain = row.toJSON ? row.toJSON() : row;
    validateIntegrationFlowScheduleState({
      enabled: plain.enabled === true,
      scheduleEnabled: plain.scheduleEnabled === true,
      scheduleIntervalSeconds: plain.scheduleIntervalSeconds ?? null,
    });
    const interval = Number(plain.scheduleIntervalSeconds);
    const nextAt = computeNextRunAt(interval);
    const act = email || (userId ? String(userId) : null);
    await row.update({
      nextScheduledRunAt: nextAt,
      scheduleLockUntil: null,
      updatedBy: act,
    });
    const next = row.toJSON ? row.toJSON() : row;
    try {
      await this.auditLogService?.log({
        action: 'integration_flow.schedule_recalculated',
        entityType: 'IntegrationFlowDefinition',
        entityId: row.id,
        newValue: { nextScheduledRunAt: nextAt.toISOString(), scheduleIntervalSeconds: interval },
        userId,
      });
    } catch {
      /* */
    }
    return next;
  }

  async deleteById(id, { userId = null } = {}) {
    const row = await IntegrationFlowDefinition.findByPk(id);
    if (!row) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    await row.destroy();
    try {
      await this.auditLogService?.log({
        action: 'integration_flow.deleted',
        entityType: 'IntegrationFlowDefinition',
        entityId: id,
        userId,
      });
    } catch {
      /* */
    }
    return { deleted: true, id };
  }

  async validateStored(id) {
    const flow = await this.getById(id);
    const result = await validateFlowJson(flow.flowJson);
    try {
      await this.auditLogService?.log({
        action: 'integration_flow.validated',
        entityType: 'IntegrationFlowDefinition',
        entityId: id,
        newValue: { valid: result.valid },
        userId: null,
      });
    } catch {
      /* */
    }
    return result;
  }

  async listRuns(flowId, { limit = 50, offset = 0 } = {}) {
    await this.getById(flowId);
    const rows = await IntegrationFlowRun.findAll({
      where: { flowId },
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((r) => (r.toJSON ? r.toJSON() : r));
  }

  async getRunById(runId) {
    const row = await IntegrationFlowRun.findOne({
      where: { id: runId },
      include: [
        {
          model: IntegrationFlowRunStep,
          as: 'steps',
          required: false,
          separate: true,
          order: [
            ['startedAt', 'ASC'],
            ['createdAt', 'ASC'],
          ],
        },
      ],
    });
    if (!row) throw new AppError('Run not found', 404, { code: 'NOT_FOUND' });
    const plain = row.toJSON ? row.toJSON() : row;
    const steps = Array.isArray(plain.steps) ? plain.steps : [];
    plain.timeline = buildTimelineFromSteps(steps);
    return plain;
  }
}

/**
 * @param {object[]} steps
 * @returns {object[]}
 */
function buildTimelineFromSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map((s) => ({
    nodeId: s.nodeId,
    nodeType: s.nodeType,
    status: s.status,
    startedAt: s.startedAt != null ? s.startedAt : null,
    finishedAt: s.finishedAt != null ? s.finishedAt : null,
    durationMs: s.durationMs != null ? s.durationMs : null,
    errorMessage: s.errorMessage != null ? s.errorMessage : null,
  }));
}

module.exports = { IntegrationFlowService, buildTimelineFromSteps, computeNextRunAt };
