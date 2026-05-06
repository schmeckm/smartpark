'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function mockEvent(id, details) {
  let d = { ...details };
  return {
    id,
    get(key) {
      if (key === 'details') return d;
      return null;
    },
    async update(patch) {
      d = patch.details;
    },
  };
}

test('analyzeAdapterOutput: NEW when no asset and no mapping', async () => {
  const created = [];
  const UnsDiscoveryEvent = {
    findAll: async () => [],
    create: async (row) => {
      created.push(row);
      return { id: 'evt-1', ...row };
    },
  };
  const svc = proxyquire('./uns-spy-adapter-discovery.service', {
    '../config/env': { adapterDiscoverySpyEnabled: true, mqttEnforceCapabilities: false },
    '../models': {
      ParkAsset: { findOne: async () => null },
      UnsRegistryEntity: { findOne: async () => null },
      UnsDiscoveryEvent,
    },
    '../repositories/external-entity-mapping.repository.js': {
      ExternalEntityMappingRepository: class {
        findByExternalKey() {
          return null;
        }
      },
    },
    '../db/sequelize': { sequelize: {} },
  });

  const out = await svc.analyzeAdapterOutput({
    provider: 'THEMEPARKS_WIKI',
    adapterKey: 'themeparks_wiki',
    parkId: '00000000-0000-4000-8000-000000000001',
    externalParkId: 'ext-park-1',
    entities: [
      {
        externalId: 'ext-attr-1',
        externalParentId: null,
        externalType: 'ATTRACTION',
        name: 'Test Ride',
        suggestedEntityType: 'RIDE',
        suggestedSlug: 'test_ride',
        rawPayload: {},
      },
    ],
    metrics: [],
    sourceRunId: 'test-run-1',
  });
  assert.equal(out.created, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].classification, svc.ADAPTER_DISCOVERY_CLASSIFICATION.NEW);
  assert.equal(created[0].details.source, 'adapter');
});

test('analyzeAdapterOutput: ALREADY_KNOWN when park asset exists', async () => {
  const created = [];
  const UnsDiscoveryEvent = {
    findAll: async () => [],
    create: async (row) => {
      created.push(row);
      return { id: 'evt-2', ...row };
    },
  };
  const svc = proxyquire('./uns-spy-adapter-discovery.service', {
    '../config/env': { adapterDiscoverySpyEnabled: true, mqttEnforceCapabilities: false },
    '../models': {
      ParkAsset: {
        findOne: async () => ({ assetId: 'asset-uuid-1', name: 'X', slug: 'x', externalEntityId: 'ext-1' }),
      },
      UnsRegistryEntity: { findOne: async () => null },
      UnsDiscoveryEvent,
    },
    '../repositories/external-entity-mapping.repository.js': {
      ExternalEntityMappingRepository: class {
        findByExternalKey() {
          return null;
        }
      },
    },
    '../db/sequelize': { sequelize: {} },
  });

  await svc.analyzeAdapterOutput({
    provider: 'THEMEPARKS_WIKI',
    adapterKey: 'themeparks_wiki',
    parkId: '00000000-0000-4000-8000-000000000002',
    entities: [{ externalId: 'ext-1', name: 'A', suggestedEntityType: 'RIDE', rawPayload: {} }],
    metrics: [],
  });
  assert.equal(created[0].classification, svc.ADAPTER_DISCOVERY_CLASSIFICATION.ALREADY_KNOWN);
});

test('rejectAdapterDiscoveryEvent sets reviewStatus', async () => {
  const evt = mockEvent('e1', { source: 'adapter', externalEntityId: 'x' });
  const UnsDiscoveryEvent = {
    findByPk: async (id) => (id === 'e1' ? evt : null),
  };
  const svc = proxyquire('./uns-spy-adapter-discovery.service', {
    '../config/env': { adapterDiscoverySpyEnabled: true, mqttEnforceCapabilities: false },
    '../models': { ParkAsset: {}, UnsRegistryEntity: {}, UnsDiscoveryEvent },
    '../repositories/external-entity-mapping.repository.js': {
      ExternalEntityMappingRepository: class {},
    },
    '../db/sequelize': { sequelize: {} },
  });
  await svc.rejectAdapterDiscoveryEvent('e1', { userId: 'u1' });
  assert.equal(evt.get('details').reviewStatus, 'REJECTED');
});
