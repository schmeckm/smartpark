'use strict';

const { validateFlowJson } = require('../services/integration-flow-validation.service');
const integrationNodeRegistry = require('../services/integration-node-registry.service');
const {
  IntegrationFlowDefinition,
  IntegrationFlowRun,
  IntegrationFlowRunStep,
} = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const {
  onInitialRunFailed,
  onAutomaticRetryChildSuccess,
  onAutomaticRetryChildFailed,
  clearRetryLockOnSource,
  lockSourceRunForRetryDispatch,
  RETRY_STATUS,
} = require('../services/integration-flow-retry.helper');
const { sanitizeStepPayload } = require('../services/integration-flow-persistence.helper');
const {
  buildStepInputPreview,
  buildStepOutputPreview,
} = require('../services/integration-flow-preview.service');
const { getIntegrationFlowQueue } = require('./integration-flow-queue');
const { createRunContext, applyNodeContextPatch } = require('./integration-flow-context');

function topoOrder(flowJson) {
  const { nodes, edges } = flowJson;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map([...byId.keys()].map((id) => [id, 0]));
  const adj = new Map([...byId.keys()].map((id) => [id, []]));
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    incoming.set(e.target, incoming.get(e.target) + 1);
  }
  const starts = [...byId.keys()].filter((id) => incoming.get(id) === 0);
  const start = starts[0];
  const order = [];
  const ic = new Map(incoming);
  const q = [start];
  while (q.length) {
    const u = q.shift();
    order.push(u);
    for (const v of adj.get(u)) {
      ic.set(v, ic.get(v) - 1);
      if (ic.get(v) === 0) q.push(v);
    }
  }
  return { order, byId, start };
}

class IntegrationFlowRunner {
  /**
   * @param {{ auditLogService?: { log: Function }, flowQueue?: { push: (task: () => Promise<unknown>) => Promise<unknown> } }} [deps]
   */
  constructor(deps = {}) {
    this.auditLogService = deps.auditLogService || null;
    this.flowQueue = deps.flowQueue || getIntegrationFlowQueue();
  }

  /**
   * @param {string} flowId
   * @param {object} flowInput
   * @param {{ userId?: string|null, scheduled?: boolean }} [opts]
   */
  async runByFlowId(flowId, flowInput = {}, opts = {}) {
    const def = await IntegrationFlowDefinition.findByPk(flowId);
    if (!def) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });

    const plainDef = def.toJSON ? def.toJSON() : def;
    const flowJson = plainDef.flowJson;
    if (!plainDef.enabled) {
      throw new AppError('Flow is disabled', 400, { code: 'FLOW_DISABLED' });
    }

    const validation = await validateFlowJson(flowJson);
    if (!validation.valid) {
      throw new AppError('Invalid flow definition', 422, {
        code: 'FLOW_INVALID',
        details: validation.errors,
      });
    }

    const run = await IntegrationFlowRun.create({
      flowId: def.id,
      status: 'pending',
      inputJson: flowInput,
      retryAttempt: 0,
      retryStatus: RETRY_STATUS.NOT_APPLICABLE,
    });

    return this.flowQueue.push(() => this._executeExistingRun(def, run, flowInput, opts));
  }

  /**
   * Automatic retry from a failed run row (scheduler).
   * @param {string} failedRunId
   * @param {{ userId?: string|null }} [opts]
   */
  async runRetryFromFailedRun(failedRunId, opts = {}) {
    const failed = await IntegrationFlowRun.findByPk(failedRunId);
    if (!failed || failed.status !== 'failed') {
      throw new AppError('Failed run not found', 404, { code: 'NOT_FOUND' });
    }
    const now = new Date();
    if (failed.retryLockUntil && failed.retryLockUntil > now) {
      throw new AppError('Run is locked', 409, { code: 'RETRY_LOCKED' });
    }
    const def = await IntegrationFlowDefinition.findByPk(failed.flowId);
    if (!def) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    const plainDef = def.toJSON ? def.toJSON() : def;
    if (!plainDef.enabled) {
      throw new AppError('Flow is disabled', 400, { code: 'FLOW_DISABLED' });
    }
    const validation = await validateFlowJson(plainDef.flowJson);
    if (!validation.valid) {
      throw new AppError('Invalid flow definition', 422, { code: 'FLOW_INVALID', details: validation.errors });
    }

    await lockSourceRunForRetryDispatch(failedRunId);

    const rootId = failed.parentRunId || failed.id;
    const nextAttempt = Number(failed.retryAttempt || 0) + 1;
    const input = failed.inputJson && typeof failed.inputJson === 'object' ? failed.inputJson : {};

    const child = await IntegrationFlowRun.create({
      flowId: failed.flowId,
      status: 'pending',
      inputJson: input,
      parentRunId: rootId,
      retryOfRunId: failed.id,
      retryAttempt: nextAttempt,
      retryStatus: RETRY_STATUS.NOT_APPLICABLE,
    });

    try {
      await this.auditLogService?.log({
        action: 'integration_flow.retry_executed',
        entityType: 'IntegrationFlowRun',
        entityId: child.id,
        newValue: { retryOfRunId: failed.id, scheduled: true },
        userId: opts.userId ?? null,
      });
    } catch {
      /* */
    }

    try {
      return await this.flowQueue.push(() =>
        this._executeExistingRun(def, child, input, {
          ...opts,
          scheduled: opts.scheduled === true,
          retryChainRootId: rootId,
          retryOfRunId: failed.id,
        })
      );
    } finally {
      await clearRetryLockOnSource(failed.id);
    }
  }

  /**
   * Manual retry from UI.
   * @param {string} failedRunId
   * @param {{ userId?: string|null, email?: string|null }} [opts]
   */
  async runManualRetryFromFailedRun(failedRunId, opts = {}) {
    const failed = await IntegrationFlowRun.findByPk(failedRunId);
    if (!failed || failed.status !== 'failed') {
      throw new AppError('Failed run not found', 404, { code: 'NOT_FOUND' });
    }
    const def = await IntegrationFlowDefinition.findByPk(failed.flowId);
    if (!def) throw new AppError('Flow not found', 404, { code: 'NOT_FOUND' });
    const plainDef = def.toJSON ? def.toJSON() : def;
    if (!plainDef.enabled) {
      throw new AppError('Flow is disabled', 400, { code: 'FLOW_DISABLED' });
    }
    if (plainDef.retryEnabled !== true) {
      throw new AppError('Retry is not enabled for this flow', 422, { code: 'RETRY_NOT_ALLOWED' });
    }
    const max = Number(plainDef.maxRetryAttempts || 0);
    if (max <= 0 || Number(failed.retryAttempt || 0) >= max) {
      throw new AppError('Retry not allowed for this run', 422, { code: 'RETRY_NOT_ALLOWED' });
    }
    const validation = await validateFlowJson(plainDef.flowJson);
    if (!validation.valid) {
      throw new AppError('Invalid flow definition', 422, { code: 'FLOW_INVALID', details: validation.errors });
    }

    await lockSourceRunForRetryDispatch(failedRunId);

    const rootId = failed.parentRunId || failed.id;
    const nextAttempt = Number(failed.retryAttempt || 0) + 1;
    const input = failed.inputJson && typeof failed.inputJson === 'object' ? failed.inputJson : {};

    const child = await IntegrationFlowRun.create({
      flowId: failed.flowId,
      status: 'pending',
      inputJson: input,
      parentRunId: rootId,
      retryOfRunId: failed.id,
      retryAttempt: nextAttempt,
      retryStatus: RETRY_STATUS.NOT_APPLICABLE,
    });

    try {
      await this.auditLogService?.log({
        action: 'integration_flow.retry_manually_triggered',
        entityType: 'IntegrationFlowRun',
        entityId: child.id,
        newValue: { retryOfRunId: failed.id },
        userId: opts.userId ?? null,
      });
    } catch {
      /* */
    }

    try {
      return await this.flowQueue.push(() =>
        this._executeExistingRun(def, child, input, {
          userId: opts.userId ?? null,
          manualRetry: true,
          retryChainRootId: rootId,
          retryOfRunId: failed.id,
        })
      );
    } finally {
      await clearRetryLockOnSource(failed.id);
    }
  }

  /**
   * @param {import('sequelize').Model} def
   * @param {import('sequelize').Model} run
   * @param {object} flowInput
   * @param {{
   *   userId?: string|null,
   *   scheduled?: boolean,
   *   manualRetry?: boolean,
   *   retryChainRootId?: string|null,
   *   retryOfRunId?: string|null,
   * }} opts
   */
  async _executeExistingRun(def, run, flowInput, opts = {}) {
    const isScheduled = opts.scheduled === true;
    const plainDef = def.toJSON ? def.toJSON() : def;
    const flowJson = plainDef.flowJson;
    const retryOfRunId = opts.retryOfRunId || null;
    const isRetryChild = Boolean(retryOfRunId);

    const t0 = Date.now();
    await run.update({ status: 'running', startedAt: new Date() });

    try {
      if (!isScheduled && !isRetryChild) {
        await this.auditLogService?.log({
          action: 'integration_flow.executed',
          entityType: 'IntegrationFlowDefinition',
          entityId: def.id,
          newValue: { runId: run.id },
          userId: opts.userId ?? null,
        });
      }
    } catch {
      /* non-fatal */
    }

    const runContext = createRunContext(plainDef, run, opts);
    let lastPayload = {};
    const { order, byId } = topoOrder(flowJson);
    const stepSummaries = [];

    const finalizeFailure = async (msg, failedNodeId, failedNodeType) => {
      const totalMs = Date.now() - t0;
      const cur = await IntegrationFlowRun.findByPk(run.id);
      if (cur?.status === 'running') {
        await run.update({
          status: 'failed',
          finishedAt: new Date(),
          durationMs: totalMs,
          errorMessage: msg,
        });
      }
      try {
        await this.auditLogService?.log({
          action: isScheduled ? 'integration_flow.scheduled_failed' : 'integration_flow.execution_failed',
          entityType: 'IntegrationFlowRun',
          entityId: run.id,
          newValue: { flowId: def.id, message: msg },
          userId: opts.userId ?? null,
        });
      } catch {
        /* */
      }

      const reloaded = await IntegrationFlowRun.findByPk(run.id);
      if (!reloaded) return;
      if (isRetryChild) {
        await onAutomaticRetryChildFailed(reloaded, plainDef, failedNodeType || null, {
          auditLogService: this.auditLogService,
        });
        try {
          await this.auditLogService?.log({
            action: 'integration_flow.retry_failed',
            entityType: 'IntegrationFlowRun',
            entityId: run.id,
            newValue: { retryOfRunId },
            userId: opts.userId ?? null,
          });
        } catch {
          /* */
        }
      } else {
        await onInitialRunFailed(reloaded, plainDef, failedNodeType || null);
        const afterInit = await IntegrationFlowRun.findByPk(run.id);
        if (afterInit?.retryStatus === RETRY_STATUS.PENDING_RETRY) {
          try {
            await this.auditLogService?.log({
              action: 'integration_flow.retry_scheduled',
              entityType: 'IntegrationFlowRun',
              entityId: run.id,
              newValue: {},
              userId: opts.userId ?? null,
            });
          } catch {
            /* */
          }
        }
      }
    };

    try {
      for (let i = 0; i < order.length; i += 1) {
        const nodeId = order[i];
        const nodeDef = byId.get(nodeId);
        const regOk = await integrationNodeRegistry.assertNodeTypeEnabled(nodeDef.type);
        if (!regOk.ok) {
          throw new Error(regOk.reason);
        }
        const exe = integrationNodeRegistry.getExecutable(nodeDef.type);
        if (!exe || typeof exe.execute !== 'function') {
          throw new Error(`no executor for ${nodeDef.type}`);
        }

        const stepInput = i === 0 ? flowInput : lastPayload;

        const stepInputRecord = {
          nodeConfig: nodeDef.config,
          upstreamPayload: stepInput,
        };

        const stepRow = await IntegrationFlowRunStep.create({
          runId: run.id,
          nodeId,
          nodeType: nodeDef.type,
          status: 'running',
          startedAt: new Date(),
          inputJson: sanitizeStepPayload(stepInputRecord),
          previewInputJson: buildStepInputPreview(stepInputRecord),
          previewOutputJson: null,
        });

        const sStart = Date.now();
        let execOut;
        try {
          execOut = await exe.execute({
            payload: stepInput,
            /** @deprecated use `payload` */
            input: stepInput,
            context: runContext,
            flow: plainDef,
            flowInput,
            nodeConfig: nodeDef.config || {},
            nodeId,
            nodeType: nodeDef.type,
          });
        } catch (e) {
          const msg = e?.message || String(e);
          const durationMs = Date.now() - sStart;
          await stepRow.update({
            status: 'failed',
            finishedAt: new Date(),
            durationMs,
            errorMessage: msg,
            outputJson: null,
            previewOutputJson: null,
          });
          await finalizeFailure(msg, nodeId, nodeDef.type);
          throw e;
        }

        const durationMs = Date.now() - sStart;
        if (!execOut || execOut.success !== true) {
          const msg = execOut?.error || 'node execution failed';
          await stepRow.update({
            status: 'failed',
            finishedAt: new Date(),
            durationMs,
            errorMessage: msg,
            outputJson: sanitizeStepPayload(execOut || null),
            previewOutputJson: buildStepOutputPreview(execOut?.payload ?? execOut),
          });
          await run.update({
            status: 'failed',
            finishedAt: new Date(),
            durationMs: Date.now() - t0,
            errorMessage: msg,
            outputJson: sanitizeStepPayload({ failedNodeId: nodeId, failedNodeType: nodeDef.type }),
          });
          await finalizeFailure(msg, nodeId, nodeDef.type);
          return {
            runId: run.id,
            flowId: def.id,
            status: 'failed',
            steps: stepSummaries.concat([{ nodeId, nodeType: nodeDef.type, status: 'failed', errorMessage: msg }]),
            output: null,
          };
        }

        await stepRow.update({
          status: 'success',
          finishedAt: new Date(),
          durationMs,
          outputJson: sanitizeStepPayload(execOut.payload != null ? execOut.payload : {}),
          previewOutputJson: buildStepOutputPreview(execOut.payload != null ? execOut.payload : {}),
          errorMessage: null,
        });

        lastPayload = execOut.payload != null ? execOut.payload : {};
        applyNodeContextPatch(runContext, execOut);
        stepSummaries.push({ nodeId, nodeType: nodeDef.type, status: 'success' });
      }

      const totalMs = Date.now() - t0;
      await run.update({
        status: 'success',
        finishedAt: new Date(),
        durationMs: totalMs,
        outputJson: sanitizeStepPayload(lastPayload),
        errorMessage: null,
      });

      if (isRetryChild) {
        const reloaded = await IntegrationFlowRun.findByPk(run.id);
        if (reloaded) {
          await onAutomaticRetryChildSuccess(reloaded, { auditLogService: this.auditLogService });
        }
      }

      return {
        runId: run.id,
        flowId: def.id,
        status: 'success',
        steps: stepSummaries,
        output: lastPayload,
      };
    } catch (e) {
      const msg = e?.message || String(e);
      const totalMs = Date.now() - t0;
      if ((await IntegrationFlowRun.findByPk(run.id))?.status === 'running') {
        await run.update({
          status: 'failed',
          finishedAt: new Date(),
          durationMs: totalMs,
          errorMessage: msg,
        });
        const reloaded = await IntegrationFlowRun.findByPk(run.id);
        if (reloaded) {
          if (isRetryChild) {
            await onAutomaticRetryChildFailed(reloaded, plainDef, null, { auditLogService: this.auditLogService });
            try {
              await this.auditLogService?.log({
                action: 'integration_flow.retry_failed',
                entityType: 'IntegrationFlowRun',
                entityId: run.id,
                newValue: { retryOfRunId },
                userId: opts.userId ?? null,
              });
            } catch {
              /* */
            }
          } else {
            await onInitialRunFailed(reloaded, plainDef, null);
            const afterInit = await IntegrationFlowRun.findByPk(run.id);
            if (afterInit?.retryStatus === RETRY_STATUS.PENDING_RETRY) {
              try {
                await this.auditLogService?.log({
                  action: 'integration_flow.retry_scheduled',
                  entityType: 'IntegrationFlowRun',
                  entityId: run.id,
                  newValue: {},
                  userId: opts.userId ?? null,
                });
              } catch {
                /* */
              }
            }
          }
        }
      }
      throw e;
    }
  }
}

module.exports = { IntegrationFlowRunner, topoOrder };
