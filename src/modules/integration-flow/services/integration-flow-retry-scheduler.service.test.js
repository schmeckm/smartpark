'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('IntegrationFlowRetrySchedulerService: skips when flow disabled (not_applicable)', async () => {
  const updates = [];
  const runRow = { id: 'run-a', flowId: 'flow-a' };

  const IntegrationFlowRun = {
    findAll: async () => [runRow],
    update: async (vals, opts) => {
      updates.push({ vals, where: opts.where });
    },
  };

  const IntegrationFlowDefinition = {
    findByPk: async () => ({ enabled: false }),
  };

  const runnerCalls = [];
  const runner = {
    runRetryFromFailedRun: async (id) => {
      runnerCalls.push(id);
    },
  };

  const svcMod = proxyquire('./integration-flow-retry-scheduler.service', {
    '../../../config/env': {
      integrationFlowEngineEnabled: true,
      integrationFlowRetrySchedulerEnabled: true,
      integrationFlowRetrySchedulerPollSeconds: 30,
    },
    '../../../models': { IntegrationFlowRun, IntegrationFlowDefinition },
    '../runtime/integration-flow-runner': { IntegrationFlowRunner: class {} },
  });

  const { IntegrationFlowRetrySchedulerService } = svcMod;
  const svc = new IntegrationFlowRetrySchedulerService({ runner });
  await svc.tick();

  assert.equal(runnerCalls.length, 0);
  assert.ok(updates.some((u) => u.vals.retryStatus === 'not_applicable'));
});

test('IntegrationFlowRetrySchedulerService: invokes runner when flow enabled and retry on', async () => {
  const runRow = { id: 'run-b', flowId: 'flow-b' };

  const IntegrationFlowRun = {
    findAll: async () => [runRow],
    update: async () => {},
  };

  const IntegrationFlowDefinition = {
    findByPk: async () => ({
      enabled: true,
      toJSON: () => ({ enabled: true, retryEnabled: true }),
    }),
  };

  const runnerCalls = [];
  const runner = {
    runRetryFromFailedRun: async (id, opts) => {
      runnerCalls.push({ id, opts });
    },
  };

  const svcMod = proxyquire('./integration-flow-retry-scheduler.service', {
    '../../../config/env': {
      integrationFlowEngineEnabled: true,
      integrationFlowRetrySchedulerEnabled: true,
      integrationFlowRetrySchedulerPollSeconds: 30,
    },
    '../../../models': { IntegrationFlowRun, IntegrationFlowDefinition },
    '../runtime/integration-flow-runner': { IntegrationFlowRunner: class {} },
  });

  const { IntegrationFlowRetrySchedulerService } = svcMod;
  const svc = new IntegrationFlowRetrySchedulerService({ runner });
  await svc.tick();

  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0].id, 'run-b');
  assert.equal(runnerCalls[0].opts.scheduled, true);
});
