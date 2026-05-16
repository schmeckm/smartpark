'use strict';

const { IntegrationFlowRun } = require('../../../models');

const ALLOWED_MAX_RETRY_ATTEMPTS = Object.freeze([0, 1, 2, 3]);
const ALLOWED_RETRY_DELAY_SECONDS = Object.freeze([60, 300, 900]);
const RETRY_STATUS = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  PENDING_RETRY: 'pending_retry',
  RETRY_SUCCEEDED: 'retry_succeeded',
  RETRY_FAILED: 'retry_failed',
  RETRY_EXHAUSTED: 'retry_exhausted',
});

/**
 * @param {object} flowPlain
 * @param {object} failedRunPlain
 * @param {string|null} failedNodeType
 */
function eligibleForAutomaticRetry(flowPlain, failedRunPlain, failedNodeType) {
  if (!flowPlain || !failedRunPlain) return false;
  if (!flowPlain.enabled) return false;
  if (flowPlain.retryEnabled !== true) return false;
  const max = Number(flowPlain.maxRetryAttempts || 0);
  if (max <= 0) return false;
  const attempt = Number(failedRunPlain.retryAttempt || 0);
  if (attempt >= max) return false;
  const delay = Number(flowPlain.retryDelaySeconds);
  if (!ALLOWED_RETRY_DELAY_SECONDS.includes(delay)) return false;
  const filter = flowPlain.retryOnNodeTypes;
  if (Array.isArray(filter) && filter.length > 0 && failedNodeType) {
    if (!filter.includes(failedNodeType)) return false;
  }
  return true;
}

function nextRetryAt(delaySec) {
  return new Date(Date.now() + Number(delaySec) * 1000);
}

/**
 * @param {import('sequelize').Model} failedRunRow
 * @param {object} flowPlain
 * @param {string|null} failedNodeType
 */
async function markFailedRunPendingRetry(failedRunRow, flowPlain, failedNodeType) {
  const plain = failedRunRow.toJSON ? failedRunRow.toJSON() : failedRunRow;
  if (!eligibleForAutomaticRetry(flowPlain, plain, failedNodeType)) {
    return false;
  }
  const delay = Number(flowPlain.retryDelaySeconds);
  await failedRunRow.update({
    retryStatus: RETRY_STATUS.PENDING_RETRY,
    nextRetryAt: nextRetryAt(delay),
    retryLockUntil: null,
  });
  return true;
}

/**
 * @param {import('sequelize').Model} childRunRow
 * @param {{ auditLogService?: { log: Function } }} ctx
 */
async function onAutomaticRetryChildSuccess(childRunRow, ctx) {
  const child = childRunRow.toJSON ? childRunRow.toJSON() : childRunRow;
  const rootId = child.parentRunId || child.retryOfRunId;
  if (!rootId) return;
  await IntegrationFlowRun.update(
    {
      retryStatus: RETRY_STATUS.RETRY_SUCCEEDED,
      nextRetryAt: null,
      retryLockUntil: null,
    },
    { where: { id: rootId } }
  );
  if (child.retryOfRunId && child.retryOfRunId !== rootId) {
    await IntegrationFlowRun.update(
      { retryStatus: RETRY_STATUS.RETRY_SUCCEEDED, nextRetryAt: null, retryLockUntil: null },
      { where: { id: child.retryOfRunId } }
    );
  }
  try {
    await ctx.auditLogService?.log({
      action: 'integration_flow.retry_succeeded',
      entityType: 'IntegrationFlowRun',
      entityId: child.id,
      newValue: { rootRunId: rootId },
      userId: null,
    });
  } catch {
    /* */
  }
}

/**
 * @param {import('sequelize').Model} childRunRow
 * @param {object} flowPlain
 * @param {string|null} failedNodeType
 * @param {{ auditLogService?: { log: Function } }} ctx
 */
async function onAutomaticRetryChildFailed(childRunRow, flowPlain, failedNodeType, ctx) {
  const child = childRunRow.toJSON ? childRunRow.toJSON() : childRunRow;
  const rootId = child.parentRunId || child.retryOfRunId;
  const scheduled = await markFailedRunPendingRetry(childRunRow, flowPlain, failedNodeType);
  if (scheduled) {
    try {
      await ctx.auditLogService?.log({
        action: 'integration_flow.retry_scheduled',
        entityType: 'IntegrationFlowRun',
        entityId: child.id,
        newValue: {},
        userId: null,
      });
    } catch {
      /* */
    }
    return;
  }
  await childRunRow.update({
    retryStatus: RETRY_STATUS.RETRY_EXHAUSTED,
    nextRetryAt: null,
    retryLockUntil: null,
  });
  if (rootId) {
    await IntegrationFlowRun.update(
      {
        retryStatus: RETRY_STATUS.RETRY_EXHAUSTED,
        nextRetryAt: null,
        retryLockUntil: null,
      },
      { where: { id: rootId } }
    );
  }
  try {
    await ctx.auditLogService?.log({
      action: 'integration_flow.retry_exhausted',
      entityType: 'IntegrationFlowRun',
      entityId: child.id,
      newValue: { rootRunId: rootId },
      userId: null,
    });
  } catch {
    /* */
  }
}

/**
 * First failure (no retry parent): maybe pending.
 * @param {import('sequelize').Model} runRow
 * @param {object} flowPlain
 * @param {string|null} failedNodeType
 */
async function onInitialRunFailed(runRow, flowPlain, failedNodeType) {
  const plain = runRow.toJSON ? runRow.toJSON() : runRow;
  if (plain.retryOfRunId) return;
  const ok = await markFailedRunPendingRetry(runRow, flowPlain, failedNodeType);
  if (!ok) {
    await runRow.update({ retryStatus: RETRY_STATUS.NOT_APPLICABLE, nextRetryAt: null });
  }
}

/**
 * @param {string|null} retryOfRunId
 */
async function clearRetryLockOnSource(retryOfRunId) {
  if (!retryOfRunId) return;
  await IntegrationFlowRun.update({ retryLockUntil: null }, { where: { id: retryOfRunId } });
}

/**
 * @param {string} sourceFailedRunId
 */
async function lockSourceRunForRetryDispatch(sourceFailedRunId) {
  const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
  await IntegrationFlowRun.update(
    {
      retryLockUntil: lockUntil,
      nextRetryAt: null,
      retryStatus: RETRY_STATUS.NOT_APPLICABLE,
    },
    { where: { id: sourceFailedRunId } }
  );
}

module.exports = {
  ALLOWED_MAX_RETRY_ATTEMPTS,
  ALLOWED_RETRY_DELAY_SECONDS,
  RETRY_STATUS,
  eligibleForAutomaticRetry,
  markFailedRunPendingRetry,
  onAutomaticRetryChildSuccess,
  onAutomaticRetryChildFailed,
  onInitialRunFailed,
  clearRetryLockOnSource,
  lockSourceRunForRetryDispatch,
};
