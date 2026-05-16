'use strict';

/**
 * Per-run context shared across nodes (replaces implicit executionHints).
 *
 * @typedef {object} IntegrationFlowRunContext
 * @property {string} flowId
 * @property {string} runId
 * @property {string|null} parkId
 * @property {string} triggeredAt ISO-8601
 * @property {boolean} scheduled
 * @property {boolean} manualRetry
 * @property {string|null} userId
 * @property {string|null} [externalParkId]
 * @property {object[]|null} [observations]
 */

/**
 * @param {object} plainDef
 * @param {import('sequelize').Model} run
 * @param {{ userId?: string|null, scheduled?: boolean, manualRetry?: boolean }} opts
 * @returns {IntegrationFlowRunContext}
 */
function createRunContext(plainDef, run, opts = {}) {
  return {
    flowId: String(plainDef.id),
    runId: String(run.id),
    parkId: plainDef.parkId != null ? String(plainDef.parkId) : null,
    triggeredAt: new Date().toISOString(),
    scheduled: opts.scheduled === true,
    manualRetry: opts.manualRetry === true,
    userId: opts.userId != null ? String(opts.userId) : null,
    externalParkId: null,
    observations: null,
  };
}

/**
 * Merge node output into run context (explicit contextPatch + legacy payload hints).
 * @param {IntegrationFlowRunContext} runContext
 * @param {{ contextPatch?: object, payload?: object }} execOut
 */
function applyNodeContextPatch(runContext, execOut) {
  const payload = execOut?.payload;
  if (payload && typeof payload === 'object') {
    if (payload.debug?.parkId != null) {
      runContext.externalParkId = String(payload.debug.parkId);
    }
    if (Array.isArray(payload.observations)) {
      runContext.observations = payload.observations;
    }
  }
  const patch = execOut?.contextPatch;
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    if (patch.externalParkId !== undefined && patch.externalParkId !== null) {
      runContext.externalParkId = String(patch.externalParkId);
    }
    if (Array.isArray(patch.observations)) {
      runContext.observations = patch.observations;
    }
    if (patch.triggeredAt !== undefined) {
      runContext.triggeredAt = String(patch.triggeredAt);
    }
  }
}

module.exports = { createRunContext, applyNodeContextPatch };
