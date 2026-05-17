'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../middleware/error.middleware');
const { validate } = require('../middleware/validate.middleware');
const { requirePermission } = require('../middleware/rbac.middleware');
const { trafficSnapshotPollBody, trafficLatestQuery } = require('../validators/traffic-snapshots.schemas');
const { TomTomTrafficProviderError } = require('../services/traffic-attendance/tomtom-traffic.provider');

const opsUser = {
  id: '99999999-9999-4999-8999-999999999999',
  role: 'OPERATIONS_MANAGER',
};

function mountTrafficSnapshotsRouter(controller) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = opsUser;
    next();
  });
  const r = express.Router();
  r.post('/traffic/snapshots/poll', requirePermission('rides', 'update'), validate(trafficSnapshotPollBody), controller.postPollTrafficSnapshots);
  // Tests mount minimal stack; production adds requireParkContext + rate limit.
  r.get('/traffic/snapshots/latest', requirePermission('rides', 'read'), validate(trafficLatestQuery, 'query'), controller.getLatestTrafficSnapshots);
  app.use(r);
  app.use(errorHandler);
  return app;
}

const accessStub = {
  parkScopeId: () => null,
  assertParkRouteScoped: () => {},
};

test('POST /traffic/snapshots/poll → 403 when TomTom disabled', async () => {
  const ctrl = proxyquire('./traffic-snapshots.controller', {
    '../services/traffic-attendance/traffic-snapshot.service': {
      TrafficSnapshotService: class {
        async pollEnabledCorridors() {
          throw new TomTomTrafficProviderError('off', 'TOMTOM_DISABLED');
        }
      },
    },
    '../services/traffic-attendance/traffic-corridor-access': accessStub,
  });
  const app = mountTrafficSnapshotsRouter(ctrl);
  const parkId = '22222222-2222-4222-8222-222222222222';
  const res = await request(app).post('/traffic/snapshots/poll').send({ parkId });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TOMTOM_DISABLED');
});

test('POST /traffic/snapshots/poll → 422 when parkId missing', async () => {
  const ctrl = proxyquire('./traffic-snapshots.controller', {
    '../services/traffic-attendance/traffic-snapshot.service': {
      TrafficSnapshotService: class {
        async pollEnabledCorridors() {
          return { polledAt: new Date().toISOString(), results: [] };
        }
      },
    },
    '../services/traffic-attendance/traffic-corridor-access': accessStub,
  });
  const app = mountTrafficSnapshotsRouter(ctrl);
  const res = await request(app).post('/traffic/snapshots/poll').send({});
  assert.equal(res.status, 422);
});

test('POST /traffic/snapshots/poll → 503 when API key missing', async () => {
  const ctrl = proxyquire('./traffic-snapshots.controller', {
    '../services/traffic-attendance/traffic-snapshot.service': {
      TrafficSnapshotService: class {
        async pollEnabledCorridors() {
          throw new TomTomTrafficProviderError('no key', 'TOMTOM_API_KEY_MISSING');
        }
      },
    },
    '../services/traffic-attendance/traffic-corridor-access': accessStub,
  });
  const app = mountTrafficSnapshotsRouter(ctrl);
  const parkId = '22222222-2222-4222-8222-222222222222';
  const res = await request(app).post('/traffic/snapshots/poll').send({ parkId });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'TOMTOM_API_KEY_MISSING');
});

test('GET /traffic/snapshots/latest returns envelope', async () => {
  const parkId = '22222222-2222-4222-8222-222222222222';
  const ctrl = proxyquire('./traffic-snapshots.controller', {
    '../services/traffic-attendance/traffic-snapshot.service': {
      TrafficSnapshotService: class {
        async getLatestNormalizedSnapshots(pid) {
          assert.equal(pid, parkId);
          return [
            {
              corridorId: '11111111-1111-4111-8111-111111111111',
              corridorName: 'X',
              snapshotId: null,
              snapshotTs: null,
              source: null,
              normalized: null,
            },
          ];
        }
      },
    },
    '../services/traffic-attendance/traffic-corridor-access': accessStub,
  });
  const app = mountTrafficSnapshotsRouter(ctrl);
  const res = await request(app).get('/traffic/snapshots/latest').query({ parkId });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].corridorName, 'X');
});
