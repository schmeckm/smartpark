'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../../middleware/error.middleware');

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@test', role: 'ADMIN' };

function appWithRoutes(envOverrides = {}) {
  const routes = proxyquire('./routes/widget-runtime.routes', {
    '../../../config/env': { widgetRuntimeEnabled: true, ...envOverrides },
    '../../../middleware/rbac.middleware': {
      requirePermission: () => (_req, _res, next) => next(),
    },
  }).widgetRuntimeRouter;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(routes);
  app.use(errorHandler);
  return app;
}

test('widget-runtime routes: 404 when WIDGET_RUNTIME_ENABLED off', async () => {
  const routes = proxyquire('./routes/widget-runtime.routes', {
    '../../../config/env': { widgetRuntimeEnabled: false },
  }).widgetRuntimeRouter;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use(routes);
  app.use(errorHandler);

  const res = await request(app).get('/widgets');
  assert.equal(res.status, 404);
});

test('widget-runtime: list widgets and data sources after sync', async () => {
  const app = appWithRoutes();
  const widgets = await request(app).get('/widgets');
  assert.equal(widgets.status, 200);
  assert.equal(widgets.body.success, true);
  assert.ok(Array.isArray(widgets.body.data));
  assert.ok(widgets.body.data.some((w) => w.widgetKey === 'FLOW_HEALTH_CARD'));

  const sources = await request(app).get('/data-sources');
  assert.equal(sources.status, 200);
  assert.ok(sources.body.data.some((d) => d.dataSourceKey === 'integration_flows.health_summary'));
});

test('widget-runtime: create instance, validate, reject disabled widget', async () => {
  const app = appWithRoutes();
  const create = await request(app).post('/instances').send({
    widgetKey: 'FLOW_HEALTH_CARD',
    title: 'Ops health',
    widgetConfig: {},
    dataSourceKey: 'integration_flows.health_summary',
    enabled: true,
  });
  assert.equal(create.status, 201);
  const id = create.body.data.id;
  assert.ok(id);

  const validate = await request(app).post(`/instances/${id}/validate`);
  assert.equal(validate.status, 200);
  assert.equal(typeof validate.body.data.valid, 'boolean');

  const { DashboardWidgetRegistry } = require('../../models');
  await DashboardWidgetRegistry.update({ enabled: false }, { where: { widgetKey: 'FLOW_STATUS_SUMMARY_CARD' } });

  const bad = await request(app).post('/instances').send({
    widgetKey: 'FLOW_STATUS_SUMMARY_CARD',
    widgetConfig: { flowId: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111' },
    dataSourceKey: 'integration_flows.latest_run',
  });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.code, 'WIDGET_DISABLED');

  await DashboardWidgetRegistry.update({ enabled: true }, { where: { widgetKey: 'FLOW_STATUS_SUMMARY_CARD' } });

  const { DashboardDataSourceRegistry } = require('../../models');
  await DashboardDataSourceRegistry.update(
    { enabled: false },
    { where: { dataSourceKey: 'integration_flows.latest_run' } }
  );

  const badDs = await request(app).post('/instances').send({
    widgetKey: 'FLOW_HEALTH_CARD',
    widgetConfig: {},
    dataSourceKey: 'integration_flows.latest_run',
  });
  assert.equal(badDs.status, 422);
  assert.equal(badDs.body.code, 'DATA_SOURCE_DISABLED');

  await DashboardDataSourceRegistry.update(
    { enabled: true },
    { where: { dataSourceKey: 'integration_flows.latest_run' } }
  );

  await request(app).delete(`/instances/${id}`);
});
