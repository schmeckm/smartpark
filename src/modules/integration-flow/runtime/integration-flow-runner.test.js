'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('IntegrationFlowRunner: failure stops flow and records step failure', async () => {
  const flowJson = {
    nodes: [
      { id: 't', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'x', type: 'MANUAL_TRIGGER', config: {} },
    ],
    edges: [{ source: 't', target: 'x' }],
  };

  const mockDef = {
    id: 'flow-1',
    toJSON: () => ({
      id: 'flow-1',
      enabled: true,
      flowJson,
      parkId: null,
    }),
  };

  const runState = { status: 'pending' };
  const mockRun = {
    id: 'run-uuid-1',
    update: async (p) => {
      Object.assign(runState, p);
      return mockRun;
    },
  };

  const stepCreates = [];
  const stepUpdates = [];
  const mockStep = {
    update: async (u) => {
      stepUpdates.push(u);
      return mockStep;
    },
  };

  const models = {
    IntegrationFlowDefinition: {
      findByPk: async () => mockDef,
    },
    IntegrationFlowRun: {
      create: async () => mockRun,
      findByPk: async (id) => (id === mockRun.id ? { status: runState.status, ...mockRun } : null),
    },
    IntegrationFlowRunStep: {
      create: async (row) => {
        stepCreates.push(row);
        return mockStep;
      },
    },
  };

  let execN = 0;
  const runnerMod = proxyquire('../runtime/integration-flow-runner', {
    '../services/integration-flow-validation.service': {
      validateFlowJson: async () => ({ valid: true, errors: [], warnings: [] }),
    },
    '../services/integration-node-registry.service': {
      assertNodeTypeEnabled: async () => ({ ok: true, entry: {} }),
      getExecutable: () => ({
        async execute() {
          execN += 1;
          if (execN === 2) {
            return { success: false, error: 'boom' };
          }
          return { success: true, payload: { n: execN } };
        },
      }),
    },
    '../../../models': models,
  });

  const immediateQueue = { push: (task) => task() };
  const runner = new runnerMod.IntegrationFlowRunner({ flowQueue: immediateQueue });
  const out = await runner.runByFlowId('flow-1', { hello: 1 }, { userId: null });
  assert.equal(out.status, 'failed');
  assert.equal(out.steps.length, 2);
  assert.equal(out.steps[1].status, 'failed');
  assert.ok(stepUpdates.some((s) => s.status === 'failed'));
  assert.ok(stepCreates.length >= 1);
  assert.ok(stepCreates[0].previewInputJson);
  assert.equal(stepCreates[0].previewInputJson._preview, true);
  const failedUpdate = stepUpdates.find((s) => s.status === 'failed' && s.previewOutputJson != null);
  assert.ok(failedUpdate);
});

test('IntegrationFlowRunner: successful single-node manual chain', async () => {
  const flowJson = {
    nodes: [{ id: 't', type: 'MANUAL_TRIGGER', config: {} }],
    edges: [],
  };

  const mockDef = {
    id: 'flow-2',
    toJSON: () => ({ id: 'flow-2', enabled: true, flowJson, parkId: null }),
  };

  const mockRun = {
    id: 'run-2',
    update: async () => mockRun,
  };

  const models = {
    IntegrationFlowDefinition: { findByPk: async () => mockDef },
    IntegrationFlowRun: {
      create: async () => mockRun,
      findByPk: async () => ({ status: 'success' }),
    },
    IntegrationFlowRunStep: {
      create: async () => ({ update: async () => ({}) }),
    },
  };

  const runnerMod = proxyquire('../runtime/integration-flow-runner', {
    '../services/integration-flow-validation.service': {
      validateFlowJson: async () => ({ valid: true, errors: [], warnings: [] }),
    },
    '../services/integration-node-registry.service': {
      assertNodeTypeEnabled: async () => ({ ok: true, entry: {} }),
      getExecutable: () => ({
        async execute(ctx) {
          return { success: true, payload: { echoed: ctx.input } };
        },
      }),
    },
    '../../../models': models,
  });

  const immediateQueue = { push: (task) => task() };
  const runner = new runnerMod.IntegrationFlowRunner({ flowQueue: immediateQueue });
  const out = await runner.runByFlowId('flow-2', { a: 2 }, { userId: null });
  assert.equal(out.status, 'success');
  assert.deepEqual(out.output, { echoed: { a: 2 } });
});
