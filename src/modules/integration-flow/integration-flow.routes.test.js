'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../../middleware/error.middleware');

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@test', role: 'ADMIN' };

test('integration-flow routes: 404 when INTEGRATION_FLOW_ENGINE_ENABLED off', async () => {
  const routes = proxyquire('./routes/integration-flow.routes', {
    '../../../config/env': { integrationFlowEngineEnabled: false },
  }).integrationFlowRouter;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(routes);
  app.use(errorHandler);

  const res = await request(app).get('/');
  assert.equal(res.status, 404);
  const resFailures = await request(app).get('/failures');
  assert.equal(resFailures.status, 404);
});

test('integration-nodes routes: 404 when flag off', async () => {
  const nodesRouter = proxyquire('./routes/integration-nodes.routes', {
    '../../../config/env': { integrationFlowEngineEnabled: false },
  }).integrationNodesRouter;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(nodesRouter);
  app.use(errorHandler);

  const res = await request(app).get('/');
  assert.equal(res.status, 404);
});
