'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const proxyquire = require('proxyquire').noCallThru();

test('listFailureInbox: caps limit at 200', async () => {
  let usedLimit;
  const IntegrationFlowRun = {
    findAndCountAll: async (opts) => {
      usedLimit = opts.limit;
      return { rows: [], count: 0 };
    },
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await mod.listFailureInbox({ limit: 999 });
  assert.equal(usedLimit, 200);
});

test('listFailureInbox: uses first failed step per run (ordered)', async () => {
  const runRow = {
    id: 'run-1',
    toJSON: () => ({
      id: 'run-1',
      flowId: 'flow-1',
      status: 'failed',
      retryStatus: 'not_applicable',
      retryAttempt: 0,
      nextRetryAt: null,
      startedAt: null,
      finishedAt: null,
      durationMs: 1,
      errorMessage: 'run err',
      acknowledgedAt: null,
      acknowledgedBy: null,
      acknowledgementNote: null,
      flow: { name: 'F', maxRetryAttempts: 0, retryEnabled: false },
    }),
  };
  const IntegrationFlowRun = {
    findAndCountAll: async () => ({ rows: [runRow], count: 1 }),
  };
  const IntegrationFlowRunStep = {
    findAll: async () => [
      { toJSON: () => ({ runId: 'run-1', nodeId: 'n1', nodeType: 'A', errorMessage: 'first', startedAt: new Date(1) }) },
      { toJSON: () => ({ runId: 'run-1', nodeId: 'n2', nodeType: 'B', errorMessage: 'second', startedAt: new Date(2) }) },
    ],
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep,
      IntegrationFlowDefinition: {},
    },
  });
  const out = await mod.listFailureInbox({});
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].failedNodeId, 'n1');
  assert.equal(out.items[0].failedNodeType, 'A');
  assert.equal(out.items[0].failedStepErrorMessage, 'first');
});

test('acknowledgeFailedRun: rejects non-failed run', async () => {
  const IntegrationFlowRun = {
    findByPk: async () => ({
      id: 'r',
      status: 'success',
      update: async () => {
        throw new Error('should not update');
      },
    }),
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': { IntegrationFlowRun, IntegrationFlowRunStep: {}, IntegrationFlowDefinition: {} },
  });
  await assert.rejects(
    () => mod.acknowledgeFailedRun('r', { note: 'x', userId: null, email: null }),
    /Only failed runs can be acknowledged/
  );
});

test('acknowledgeFailedRun: updates acknowledgement fields only', async () => {
  const updates = [];
  const row = {
    id: 'r',
    status: 'failed',
    flowId: 'f',
    update: async (p) => {
      updates.push(p);
    },
  };
  const afterJson = {
    id: 'r',
    flowId: 'f',
    status: 'failed',
    retryStatus: 'pending_retry',
    retryAttempt: 0,
    nextRetryAt: new Date(),
    startedAt: null,
    finishedAt: null,
    durationMs: 1,
    errorMessage: 'e',
    acknowledgedAt: new Date(),
    acknowledgedBy: 'ops@test',
    acknowledgementNote: 'Reviewed',
    flow: { name: 'Fn', maxRetryAttempts: 1, retryEnabled: true },
  };
  let pkCalls = 0;
  const IntegrationFlowRun = {
    findByPk: async (id) => {
      if (id !== 'r') return null;
      pkCalls += 1;
      if (pkCalls === 1) return row;
      return {
        toJSON() {
          return { ...afterJson };
        },
      };
    },
  };
  const IntegrationFlowRunStep = {
    findAll: async () => [],
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': { IntegrationFlowRun, IntegrationFlowRunStep, IntegrationFlowDefinition: {} },
  });
  const out = await mod.acknowledgeFailedRun('r', {
    note: 'Reviewed',
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'ops@test',
    auditLogService: { log: async () => {} },
  });
  assert.equal(updates.length, 1);
  assert.ok(updates[0].acknowledgedAt);
  assert.equal(updates[0].acknowledgedBy, 'ops@test');
  assert.equal(updates[0].acknowledgementNote, 'Reviewed');
  assert.equal(out.acknowledgementNote, 'Reviewed');
});

test('listFailureInbox: invalid retryStatus throws', async () => {
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun: { findAndCountAll: async () => ({ rows: [], count: 0 }) },
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await assert.rejects(() => mod.listFailureInbox({ retryStatus: 'bogus' }), /Invalid retryStatus/);
});

test('listFailureInbox: applies retryStatus to where clause', async () => {
  let usedWhere;
  const IntegrationFlowRun = {
    findAndCountAll: async (opts) => {
      usedWhere = opts.where;
      return { rows: [], count: 0 };
    },
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await mod.listFailureInbox({ retryStatus: 'retry_exhausted' });
  assert.equal(usedWhere.status, 'failed');
  assert.equal(usedWhere.retryStatus, 'retry_exhausted');
});

test('listFailureInbox: acknowledged=yes filters acknowledgedAt', async () => {
  let usedWhere;
  const IntegrationFlowRun = {
    findAndCountAll: async (opts) => {
      usedWhere = opts.where;
      return { rows: [], count: 0 };
    },
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await mod.listFailureInbox({ acknowledged: 'yes' });
  assert.deepEqual(usedWhere.acknowledgedAt, { [Op.ne]: null });
});

test('listFailureInbox: acknowledged=no keeps null acknowledgedAt', async () => {
  let usedWhere;
  const IntegrationFlowRun = {
    findAndCountAll: async (opts) => {
      usedWhere = opts.where;
      return { rows: [], count: 0 };
    },
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await mod.listFailureInbox({ acknowledged: 'no' });
  assert.equal(usedWhere.acknowledgedAt, null);
});

test('listFailureInbox: nodeType adds subquery filter on run id', async () => {
  let usedWhere;
  const IntegrationFlowRun = {
    sequelize: { escape: (v) => `'${String(v).replaceAll("'", "''")}'` },
    findAndCountAll: async (opts) => {
      usedWhere = opts.where;
      return { rows: [], count: 0 };
    },
  };
  const mod = proxyquire('./integration-flow-failure-inbox.service', {
    '../../../models': {
      IntegrationFlowRun,
      IntegrationFlowRunStep: { findAll: async () => [] },
      IntegrationFlowDefinition: {},
    },
  });
  await mod.listFailureInbox({ nodeType: 'adapter' });
  assert.equal(usedWhere.status, 'failed');
  assert.ok(usedWhere.id);
  assert.ok(usedWhere.id[Op.in]);
  const lit = usedWhere.id[Op.in];
  assert.match(String(lit.val || lit), /node_type = 'adapter'/);
});
