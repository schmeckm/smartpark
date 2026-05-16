'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../middleware/error.middleware');
const { validate } = require('../middleware/validate.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');
const { putTomTomTrafficProviderBody, testTomTomTrafficProviderBody } = require('../validators/traffic-provider.schemas');

const adminUser = {
  id: '99999999-9999-4999-8999-999999999999',
  role: 'ADMIN',
};

function mountRouter(controller) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = adminUser;
    next();
  });
  const r = express.Router();
  r.get('/integrations/traffic-providers', requirePermission('integrations', 'read'), controller.listTrafficProviders);
  r.put(
    '/integrations/traffic-providers/traffic_tomtom',
    requirePermission('integrations', 'manage'),
    validate(putTomTomTrafficProviderBody),
    controller.putTomTomTrafficProvider
  );
  r.post(
    '/integrations/traffic-providers/traffic_tomtom/test',
    requirePermission('integrations', 'manage'),
    validate(testTomTomTrafficProviderBody),
    controller.postTomTomTrafficProviderTest
  );
  r.put(
    '/integrations/traffic-providers/tomtom',
    requirePermission('integrations', 'manage'),
    validate(putTomTomTrafficProviderBody),
    controller.putTomTomTrafficProvider
  );
  r.post(
    '/integrations/traffic-providers/tomtom/test',
    requirePermission('integrations', 'manage'),
    validate(testTomTomTrafficProviderBody),
    controller.postTomTomTrafficProviderTest
  );
  app.use(r);
  app.use(errorHandler);
  return app;
}

test('GET /integrations/traffic-providers returns masked list', async () => {
  const ctrl = proxyquire('./traffic-provider-integrations.controller', {
    '../services/traffic-provider-config.service': {
      TrafficProviderConfigService: class {
        async listMasked() {
          return [{ providerKey: 'traffic_tomtom', maskedApiKey: '************CW1', enabled: true }];
        }
      },
    },
  });
  const app = mountRouter(ctrl);
  const res = await request(app).get('/integrations/traffic-providers');
  assert.equal(res.status, 200);
  assert.equal(res.body.data[0].maskedApiKey, '************CW1');
  assert.equal(res.body.data[0].apiKey, undefined);
});

test('PUT /integrations/traffic-providers/traffic_tomtom returns masked only', async () => {
  const ctrl = proxyquire('./traffic-provider-integrations.controller', {
    '../services/traffic-provider-config.service': {
      TrafficProviderConfigService: class {
        async upsertTomTom() {
          return { providerKey: 'traffic_tomtom', maskedApiKey: '************ZZ', enabled: true };
        }
      },
    },
  });
  const app = mountRouter(ctrl);
  const res = await request(app).put('/integrations/traffic-providers/traffic_tomtom').send({ enabled: true, apiKey: 'secret-value' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.apiKey, undefined);
  assert.equal(res.body.data.maskedApiKey, '************ZZ');
});

test('PUT /integrations/traffic-providers/tomtom (legacy alias) returns masked only', async () => {
  const ctrl = proxyquire('./traffic-provider-integrations.controller', {
    '../services/traffic-provider-config.service': {
      TrafficProviderConfigService: class {
        async upsertTomTom() {
          return { providerKey: 'traffic_tomtom', maskedApiKey: '************ZZ', enabled: true };
        }
      },
    },
  });
  const app = mountRouter(ctrl);
  const res = await request(app).put('/integrations/traffic-providers/tomtom').send({ enabled: true, apiKey: 'secret-value' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.maskedApiKey, '************ZZ');
});

test('POST /integrations/traffic-providers/traffic_tomtom/test', async () => {
  const ctrl = proxyquire('./traffic-provider-integrations.controller', {
    '../services/traffic-provider-config.service': {
      TrafficProviderConfigService: class {
        async testTomTomConnection() {
          return { ok: true, providerStatus: 'ok', travelTimeSeconds: 10, routeDistanceMeters: 1 };
        }
      },
    },
  });
  const app = mountRouter(ctrl);
  const res = await request(app).post('/integrations/traffic-providers/traffic_tomtom/test').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.ok, true);
});
