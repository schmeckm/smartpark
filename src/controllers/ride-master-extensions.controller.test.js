'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire');
const { errorHandler } = require('../middleware/error.middleware');
const { validateExtensionsPatchBody } = require('../validators/ride-master-extensions-patch.validator');

test('getMdmRideExtensions returns 404 when ride not found', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => null },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/mdm/rides/:id/extensions', ctrl.getMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/mdm/rides/00000000-0000-4000-8000-000000000001/extensions');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('getMdmRideExtensions returns normalized payload for ride without extensions column', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: {
        findByPk: async () => ({
          id: '00000000-0000-4000-8000-000000000099',
          extensions: {},
        }),
      },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/mdm/rides/:id/extensions', ctrl.getMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/mdm/rides/00000000-0000-4000-8000-000000000099/extensions');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.entityType, 'ride');
  assert.deepEqual(res.body.data.domains, []);
  assert.deepEqual(res.body.data.signals, {});
  assert.equal(res.body.data.capabilities.hasQueueSignal, false);
});

test('getMdmRideExtensions returns domains and signals when extensions populated', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: {
        findByPk: async () => ({
          id: '00000000-0000-4000-8000-000000000088',
          extensions: {
            domains: ['queue', 'operations'],
            signals: {
              'queue.wait_time_min': { enabled: true, mlEligible: true, boardEligible: true },
              'operations.cycle_time_s': { enabled: true, mlEligible: false, boardEligible: true },
            },
            capabilities: { hasQueueSignal: true, hasCycleSignal: true, hasEnergyMetering: false },
          },
        }),
      },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/mdm/rides/:id/extensions', ctrl.getMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/mdm/rides/00000000-0000-4000-8000-000000000088/extensions');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.domains, ['queue', 'operations']);
  assert.equal(res.body.data.signals['queue.wait_time_min'].enabled, true);
  assert.equal(res.body.data.capabilities.hasCycleSignal, true);
});

test('getMdmRideExtensions tolerates invalid extensions JSON shape', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: {
        findByPk: async () => ({
          id: '00000000-0000-4000-8000-000000000077',
          extensions: { domains: 'broken', signals: [1, 2, 3] },
        }),
      },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/mdm/rides/:id/extensions', ctrl.getMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/mdm/rides/00000000-0000-4000-8000-000000000077/extensions');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.domains, []);
  assert.deepEqual(res.body.data.signals, {});
});

test('getParkAssetExtensions returns 404 when asset not found', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => null },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/assets/:assetId/extensions', ctrl.getParkAssetExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/assets/00000000-0000-4000-8000-000000000002/extensions');
  assert.equal(res.status, 404);
});

test('getParkAssetExtensions reads master_profile.unsAssetExtensions', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => null },
      ParkAsset: {
        findByPk: async () => ({
          assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          masterProfile: {
            unsAssetExtensions: {
              domains: ['green'],
              signals: { 'green.power_kw': { enabled: false, mlEligible: false, boardEligible: false } },
            },
          },
        }),
      },
    },
  });
  const app = express();
  app.use(express.json());
  app.get('/api/v1/assets/:assetId/extensions', ctrl.getParkAssetExtensions);
  app.use(errorHandler);
  const res = await request(app).get('/api/v1/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/extensions');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.entityType, 'park_asset');
  assert.deepEqual(res.body.data.domains, ['green']);
  assert.equal(res.body.data.signals['green.power_kw'].enabled, false);
});

test('patchMdmRideExtensions returns 400 for invalid domain in domains array', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: {
        findByPk: async () => ({
          id: '00000000-0000-4000-8000-0000000000bb',
          extensions: {},
          get: () => ({ id: '00000000-0000-4000-8000-0000000000bb', extensions: {} }),
          update: async () => {},
          reload: async () => {},
        }),
      },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.patch('/mdm/rides/:id/extensions', validateExtensionsPatchBody, ctrl.patchMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app)
    .patch('/mdm/rides/00000000-0000-4000-8000-0000000000bb/extensions')
    .send({ domains: ['not_a_real_domain'] });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'INVALID_EXTENSIONS_PATCH');
});

test('patchMdmRideExtensions returns 404 when ride not found', async () => {
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => null },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.patch('/mdm/rides/:id/extensions', validateExtensionsPatchBody, ctrl.patchMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app)
    .patch('/mdm/rides/00000000-0000-4000-8000-0000000000cc/extensions')
    .send({ capabilities: { hasQueueSignal: true } });
  assert.equal(res.status, 404);
});

test('patchMdmRideExtensions merges and persists normalized document', async () => {
  const RID = '00000000-0000-4000-8000-0000000000dd';
  let stored = {};
  const ride = {
    id: RID,
    get(opts) {
      const plain = { id: RID, extensions: { ...stored } };
      return opts?.plain ? plain : this;
    },
    async update(payload) {
      stored = JSON.parse(JSON.stringify(payload.extensions));
    },
    async reload() {},
  };
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => ride },
      ParkAsset: { findByPk: async () => null },
    },
  });
  const app = express();
  app.use(express.json());
  app.patch('/mdm/rides/:id/extensions', validateExtensionsPatchBody, ctrl.patchMdmRideExtensions);
  app.use(errorHandler);
  const res = await request(app)
    .patch(`/mdm/rides/${RID}/extensions`)
    .send({
      domains: ['queue'],
      replaceSignals: true,
      signals: { 'queue.wait_time_min': { enabled: true, mlEligible: false, boardEligible: true } },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.data.domains, ['queue']);
  assert.equal(res.body.data.signals['queue.wait_time_min'].enabled, true);
  assert.equal(stored.schemaVersion, 1);
  assert.ok(stored.signals['queue.wait_time_min']);
});

test('patchParkAssetExtensions updates masterProfile unsAssetExtensions', async () => {
  const AID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const asset = {
    assetId: AID,
    masterProfile: { other: 1 },
    getDataValue(key) {
      if (key === 'masterProfile') return this.masterProfile;
      return undefined;
    },
    async update(payload) {
      this.masterProfile = payload.masterProfile;
    },
    async reload() {},
  };
  const ctrl = proxyquire.noCallThru()('./ride-master-extensions.controller', {
    '../models': {
      MdmRide: { findByPk: async () => null },
      ParkAsset: { findByPk: async () => asset },
    },
  });
  const app = express();
  app.use(express.json());
  app.patch('/assets/:assetId/extensions', validateExtensionsPatchBody, ctrl.patchParkAssetExtensions);
  app.use(errorHandler);
  const res = await request(app)
    .patch(`/assets/${AID}/extensions`)
    .send({
      replaceSignals: true,
      signals: { 'operations.cycle_time_s': { enabled: true, mlEligible: false, boardEligible: false } },
    });
  assert.equal(res.status, 200);
  assert.equal(asset.masterProfile.other, 1);
  assert.ok(asset.masterProfile.unsAssetExtensions);
  assert.equal(asset.masterProfile.unsAssetExtensions.signals['operations.cycle_time_s'].enabled, true);
});
