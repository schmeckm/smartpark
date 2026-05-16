'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('findActiveModel requires archivedAt null', async () => {
  let capturedWhere;
  const MlModelRegistry = {
    findOne: async ({ where }) => {
      capturedWhere = where;
      return null;
    },
  };
  const { findActiveModel } = proxyquire('./ml-model-registry.service', {
    '../../models': { MlModelRegistry },
  });
  await findActiveModel({
    modelTypes: ['GLOBAL_RIDE_MODEL'],
    scopeType: 'global',
    scopeId: null,
    horizonMinutes: 60,
  });
  assert.ok(capturedWhere.archivedAt);
});

test('archiveRegistryEntryByPk rejects when isActive', async () => {
  const row = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
    get: () => ({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
      isActive: true,
      archivedAt: null,
      modelType: 'GLOBAL_RIDE_MODEL',
      scopeType: 'global',
      scopeId: null,
      horizonMinutes: 60,
    }),
    update: async () => {},
  };
  const MlModelRegistry = {
    findByPk: async () => row,
    count: async () => 5,
  };
  const { archiveRegistryEntryByPk } = proxyquire('./ml-model-registry.service', {
    '../../models': { MlModelRegistry },
  });
  await assert.rejects(archiveRegistryEntryByPk(row.id, null), (e) => e.code === 'MODEL_ACTIVE');
});

test('archiveRegistryEntryByPk rejects last deployable version', async () => {
  const row = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
    get: () => ({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
      isActive: false,
      archivedAt: null,
      modelType: 'GLOBAL_RIDE_MODEL',
      scopeType: 'global',
      scopeId: null,
      horizonMinutes: 60,
    }),
    update: async () => {},
  };
  const MlModelRegistry = {
    findByPk: async () => row,
    count: async () => 0,
  };
  const { archiveRegistryEntryByPk } = proxyquire('./ml-model-registry.service', {
    '../../models': { MlModelRegistry },
  });
  await assert.rejects(archiveRegistryEntryByPk(row.id, null), (e) => e.code === 'MODEL_LAST_DEPLOYABLE_VERSION');
});

test('permanentlyDeleteRegistryEntryByPk rejects when not archived', async () => {
  const row = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
    get: () => ({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
      isActive: false,
      archivedAt: null,
    }),
    destroy: async () => {},
  };
  const MlModelRegistry = { findByPk: async () => row };
  const { permanentlyDeleteRegistryEntryByPk } = proxyquire('./ml-model-registry.service', {
    '../../models': { MlModelRegistry },
  });
  await assert.rejects(permanentlyDeleteRegistryEntryByPk(row.id), (e) => e.code === 'MODEL_NOT_ARCHIVED');
});

test('permanentlyDeleteRegistryEntryByPk destroys when archived', async () => {
  let destroyed = false;
  const row = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
    get: () => ({
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
      isActive: false,
      archivedAt: new Date(),
    }),
    destroy: async () => {
      destroyed = true;
    },
  };
  const MlModelRegistry = { findByPk: async () => row };
  const { permanentlyDeleteRegistryEntryByPk } = proxyquire('./ml-model-registry.service', {
    '../../models': { MlModelRegistry },
  });
  const out = await permanentlyDeleteRegistryEntryByPk(row.id);
  assert.equal(out.deleted, true);
  assert.equal(destroyed, true);
});
