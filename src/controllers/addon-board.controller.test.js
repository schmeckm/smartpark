'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../middleware/error.middleware');
const { validate } = require('../middleware/validate.middleware');
const { rideIdWidgetIdParams } = require('../validators/addon-board-custom-widget-lifecycle.validator');

test('getWidgetSourceDraftHandler returns latestValue in envelope', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-widget-source.service': {
      getWidgetSourceDraftPreview: async () => ({
        draft: {
          sourceType: 'SIGNAL_METADATA',
          entityType: 'park_asset',
          entityId: '11111111-1111-1111-1111-111111111111',
          signalKey: 'queue.wait_time_min',
        },
        resolved: {
          valid: true,
          domain: 'queue',
          metric: 'wait_time_min',
          enabled: true,
          boardEligible: true,
        },
        latestValue: {
          value: 7,
          unit: 'min',
          ts: '2026-05-06T17:00:00.000Z',
          quality: 'GOOD',
          source: 'uns_live_state',
        },
      }),
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.get('/api/v1/addon-board/rides/:rideId/widget-source-draft', ctrl.getWidgetSourceDraftHandler);
  app.use(errorHandler);
  const res = await request(app).get(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/widget-source-draft'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.latestValue.value, 7);
  assert.equal(res.body.data.latestValue.source, 'uns_live_state');
});

test('getCustomWidgetsHandler returns widgets array', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': {
      getCustomWidgetsForRide: async () => [
        {
          widgetId: 'signal_queue_wait_time_min',
          title: 'queue.wait_time_min',
          source: {
            sourceType: 'SIGNAL_METADATA',
            entityType: 'park_asset',
            entityId: '11111111-1111-1111-1111-111111111111',
            signalKey: 'queue.wait_time_min',
          },
          display: {
            type: 'latest_value',
            unitMode: 'fromSource',
            refreshMode: 'manual_or_existing_board_refresh',
          },
          enabled: true,
          resolved: {
            valid: true,
            domain: 'queue',
            metric: 'wait_time_min',
            enabled: true,
            boardEligible: true,
          },
          latestValue: {
            value: 12,
            unit: 'min',
            ts: '2026-05-06T18:00:00.000Z',
            quality: 'GOOD',
            source: 'uns_live_state',
          },
          health: 'ok',
        },
      ],
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.get('/api/v1/addon-board/rides/:rideId/custom-widgets', ctrl.getCustomWidgetsHandler);
  app.use(errorHandler);
  const res = await request(app).get(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/custom-widgets'
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.data.widgets.length, 1);
  assert.equal(res.body.data.widgets[0].widgetId, 'signal_queue_wait_time_min');
  assert.equal(res.body.data.widgets[0].resolved.valid, true);
  assert.equal(res.body.data.widgets[0].latestValue.value, 12);
  assert.equal(res.body.data.widgets[0].health, 'ok');
});

test('postPromoteWidgetFromDraft returns 201 with widget', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': {
      promoteWidgetFromSourceDraft: async () => ({
        widgetId: 'signal_queue_wait_time_min',
        title: 'queue.wait_time_min',
        source: {
          sourceType: 'SIGNAL_METADATA',
          entityType: 'park_asset',
          entityId: '11111111-1111-1111-1111-111111111111',
          signalKey: 'queue.wait_time_min',
        },
        display: {
          type: 'latest_value',
          unitMode: 'fromSource',
          refreshMode: 'manual_or_existing_board_refresh',
        },
        enabled: true,
      }),
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.post(
    '/api/v1/addon-board/rides/:rideId/widgets/from-source-draft',
    ctrl.postPromoteWidgetFromDraft
  );
  app.use(errorHandler);
  const res = await request(app).post(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/widgets/from-source-draft'
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.data.widget.display.type, 'latest_value');
});

test('postPromoteWidgetFromDraft maps DRAFT_MISSING to 400', async () => {
  const err = new Error('x');
  /** @type {any} */ (err).code = 'DRAFT_MISSING';
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': {
      promoteWidgetFromSourceDraft: async () => {
        throw err;
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.post(
    '/api/v1/addon-board/rides/:rideId/widgets/from-source-draft',
    ctrl.postPromoteWidgetFromDraft
  );
  app.use(errorHandler);
  const res = await request(app).post(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/widgets/from-source-draft'
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'DRAFT_MISSING');
});

test('postPromoteWidgetFromDraft maps DRAFT_NOT_VALID to 400', async () => {
  const err = new Error('x');
  /** @type {any} */ (err).code = 'DRAFT_NOT_VALID';
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': {
      promoteWidgetFromSourceDraft: async () => {
        throw err;
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.post(
    '/api/v1/addon-board/rides/:rideId/widgets/from-source-draft',
    ctrl.postPromoteWidgetFromDraft
  );
  app.use(errorHandler);
  const res = await request(app).post(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/widgets/from-source-draft'
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'DRAFT_NOT_VALID');
});

test('postPromoteWidgetFromDraft maps DRAFT_ENTITY_MISMATCH to 400', async () => {
  const err = new Error('x');
  /** @type {any} */ (err).code = 'DRAFT_ENTITY_MISMATCH';
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': {
      promoteWidgetFromSourceDraft: async () => {
        throw err;
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.post(
    '/api/v1/addon-board/rides/:rideId/widgets/from-source-draft',
    ctrl.postPromoteWidgetFromDraft
  );
  app.use(errorHandler);
  const res = await request(app).post(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/widgets/from-source-draft'
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'DRAFT_ENTITY_MISMATCH');
});

const stubRideCustomWidgetsService = (overrides = {}) => ({
  getCustomWidgetsForRide: async () => [],
  promoteWidgetFromSourceDraft: async () => ({}),
  patchCustomWidgetForRide: async () => ({
    widgetId: 'signal_q',
    title: 'N',
    source: {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: '11111111-1111-1111-1111-111111111111',
      signalKey: 'queue.x',
    },
    display: {
      type: 'latest_value',
      unitMode: 'fromSource',
      refreshMode: 'manual_or_existing_board_refresh',
    },
    enabled: true,
    health: 'ok',
  }),
  deleteCustomWidgetForRide: async () => {},
  ...overrides,
});

test('patchCustomWidgetHandler returns 200', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': stubRideCustomWidgetsService(),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.patch(
    '/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId',
    validate(rideIdWidgetIdParams, 'params'),
    ctrl.patchCustomWidgetHandler
  );
  app.use(errorHandler);
  const res = await request(app)
    .patch('/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/custom-widgets/signal_q')
    .send({ title: 'Queue wait' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.widget.title, 'N');
});

test('patchCustomWidgetHandler returns 400 on empty body', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': stubRideCustomWidgetsService(),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.patch(
    '/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId',
    validate(rideIdWidgetIdParams, 'params'),
    ctrl.patchCustomWidgetHandler
  );
  app.use(errorHandler);
  const res = await request(app)
    .patch('/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/custom-widgets/signal_q')
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_CUSTOM_WIDGET_PATCH');
});

test('patchCustomWidgetHandler maps CUSTOM_WIDGET_NOT_FOUND to 404', async () => {
  const err = new Error('x');
  /** @type {any} */ (err).code = 'CUSTOM_WIDGET_NOT_FOUND';
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': stubRideCustomWidgetsService({
      patchCustomWidgetForRide: async () => {
        throw err;
      },
    }),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.patch(
    '/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId',
    validate(rideIdWidgetIdParams, 'params'),
    ctrl.patchCustomWidgetHandler
  );
  app.use(errorHandler);
  const res = await request(app)
    .patch('/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/custom-widgets/signal_q')
    .send({ enabled: true });
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'CUSTOM_WIDGET_NOT_FOUND');
});

test('deleteCustomWidgetHandler returns 204', async () => {
  const ctrl = proxyquire('./addon-board.controller', {
    '../services/addon-board-ride-custom-widgets.service': stubRideCustomWidgetsService(),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.parkContext = { id: '22222222-2222-2222-2222-222222222222' };
    next();
  });
  app.delete(
    '/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId',
    validate(rideIdWidgetIdParams, 'params'),
    ctrl.deleteCustomWidgetHandler
  );
  app.use(errorHandler);
  const res = await request(app).delete(
    '/api/v1/addon-board/rides/11111111-1111-1111-1111-111111111111/custom-widgets/signal_q'
  );
  assert.equal(res.status, 204);
});
