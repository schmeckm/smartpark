'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function loadScheduler(mocks) {
  return proxyquire('./integration-flow-scheduler.service', {
    '../../../config/env': {
      integrationFlowEngineEnabled: true,
      integrationFlowSchedulerEnabled: true,
      integrationFlowSchedulerPollSeconds: 30,
      ...mocks.env,
    },
    '../../../models': mocks.models || { IntegrationFlowDefinition: {} },
    '../../../utils/logger': { logger: { info() {}, warn() {} } },
  }).IntegrationFlowSchedulerService;
}

test('startIfEnabled: returns null when global scheduler flag off', () => {
  const IntegrationFlowSchedulerService = loadScheduler({
    env: { integrationFlowSchedulerEnabled: false },
  });
  const svc = new IntegrationFlowSchedulerService();
  assert.equal(svc.startIfEnabled(), null);
});

test('processDueFlow: skips when schedule_lock_until is in the future', async () => {
  let runCalls = 0;
  const runner = {
    runByFlowId: async () => {
      runCalls += 1;
      return { status: 'success' };
    },
  };
  const future = new Date(Date.now() + 120_000);
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    scheduleEnabled: true,
    enabled: true,
    scheduleIntervalSeconds: 60,
    nextScheduledRunAt: new Date(Date.now() - 5000),
    scheduleLockUntil: future,
    update: async () => {
      throw new Error('should not update when locked');
    },
  };
  const IntegrationFlowSchedulerService = loadScheduler({
    models: {
      IntegrationFlowDefinition: {
        findByPk: async () => row,
        update: async () => {
          throw new Error('bulk update should not run');
        },
      },
    },
  });
  const svc = new IntegrationFlowSchedulerService({ runner });
  await svc.processDueFlow(row.id);
  assert.equal(runCalls, 0);
});

test('processDueFlow: on success advances next_scheduled_run_at and clears lock', async () => {
  let runCalls = 0;
  const runner = {
    runByFlowId: async () => {
      runCalls += 1;
      return { status: 'success' };
    },
  };
  const flowId = '22222222-2222-4222-8222-222222222222';
  const updates = [];
  const row = {
    id: flowId,
    scheduleEnabled: true,
    enabled: true,
    scheduleIntervalSeconds: 60,
    nextScheduledRunAt: new Date(Date.now() - 5000),
    scheduleLockUntil: null,
    update: async (p) => {
      updates.push(['lock', p]);
    },
  };
  const fresh = {
    id: flowId,
    update: async (p) => {
      updates.push(['after', p]);
    },
  };
  let pkCalls = 0;
  const IntegrationFlowSchedulerService = loadScheduler({
    models: {
      IntegrationFlowDefinition: {
        findByPk: async (id) => {
          if (id !== flowId) return null;
          pkCalls += 1;
          return pkCalls === 1 ? row : fresh;
        },
        update: async () => {
          throw new Error('unexpected static update');
        },
      },
    },
  });
  const audit = { log: async () => {} };
  const svc = new IntegrationFlowSchedulerService({ runner, auditLogService: audit });
  await svc.processDueFlow(flowId);
  assert.equal(runCalls, 1);
  const afterPatch = updates.find((u) => u[0] === 'after');
  assert.ok(afterPatch);
  assert.equal(afterPatch[1].scheduleLockUntil, null);
  assert.ok(afterPatch[1].nextScheduledRunAt instanceof Date);
  assert.ok(afterPatch[1].lastScheduledRunAt instanceof Date);
});

test('processDueFlow: failure path still advances next run and clears lock', async () => {
  const flowId = '33333333-3333-4333-8333-333333333333';
  const runner = {
    runByFlowId: async () => {
      throw new Error('boom');
    },
  };
  const bulkUpdates = [];
  const row = {
    id: flowId,
    scheduleEnabled: true,
    enabled: true,
    scheduleIntervalSeconds: 60,
    nextScheduledRunAt: new Date(Date.now() - 5000),
    scheduleLockUntil: null,
    update: async () => {},
  };
  const IntegrationFlowSchedulerService = loadScheduler({
    models: {
      IntegrationFlowDefinition: {
        findByPk: async () => row,
        update: async (fields, opts) => {
          bulkUpdates.push({ fields, opts });
        },
      },
    },
  });
  const audit = { log: async () => {} };
  const svc = new IntegrationFlowSchedulerService({ runner, auditLogService: audit });
  await svc.processDueFlow(flowId);
  assert.equal(bulkUpdates.length, 1);
  assert.equal(bulkUpdates[0].fields.scheduleLockUntil, null);
  assert.ok(bulkUpdates[0].fields.nextScheduledRunAt instanceof Date);
});
