'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../../middleware/error.middleware');

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@test', role: 'ADMIN' };

const noop = async (_req, res) => {
  res.status(200).json({ success: true });
};

test('POST /runs/:runId/retry returns runner payload', async () => {
  const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const controller = {
    listFlows: noop,
    getFlow: noop,
    createFlow: noop,
    createFromTemplate: noop,
    patchFlow: noop,
    recalculateFlowSchedule: noop,
    deleteFlow: noop,
    validateFlow: noop,
    runFlow: noop,
    listRuns: noop,
    getRun: noop,
    listNodes: noop,
    listTemplates: noop,
    manualRetryRun: async (req, res) => {
      assert.equal(req.validated.runId, runId);
      res.json({ success: true, data: { runId: 'child-run', status: 'success', flowId: 'f', steps: [], output: {} } });
    },
  };

  const routes = proxyquire('./routes/integration-flow.routes', {
    '../../../config/env': { integrationFlowEngineEnabled: true },
    '../controllers/integration-flow.controller': controller,
    '../../../middleware/rbac.middleware': {
      requirePermission: () => (_req, _res, next) => {
        _req.user = user;
        next();
      },
    },
  }).integrationFlowRouter;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(routes);
  app.use(errorHandler);

  const res = await request(app).post(`/runs/${runId}/retry`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.runId, 'child-run');
});
