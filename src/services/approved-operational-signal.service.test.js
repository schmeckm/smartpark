'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extensionConsumerApproved,
  evaluateRegistryGovernanceSync,
  evaluateApprovedForOperationsFactsRow,
  operationsExtensionAllowsForSignalCode,
  findExtensionKeysForSignalCode,
} = require('./approved-operational-signal.service');

function capWithSource(src) {
  return {
    get(k) {
      if (k === 'capabilityJson') return { signalSource: src };
      if (k === 'signalCatalogId') return '11111111-1111-1111-1111-111111111111';
      return null;
    },
  };
}

function catWithCode(code) {
  return {
    get(k) {
      if (k === 'signalCode') return code;
      if (k === 'id') return '11111111-1111-1111-1111-111111111111';
      return null;
    },
  };
}

function rowActive(active) {
  return {
    get(k) {
      if (k === 'isActive') return active;
      return null;
    },
  };
}

test('evaluateRegistryGovernanceSync: MQTT_EDGE allows UNS active topic', () => {
  const r = evaluateRegistryGovernanceSync({
    cap: capWithSource('MQTT_EDGE'),
    catalog: catWithCode('wait_time_min'),
    activeTopicRow: rowActive(true),
    sparkRow: undefined,
  });
  assert.equal(r.ok, true);
});

test('evaluateRegistryGovernanceSync: MQTT_EDGE allows active Sparkplug row', () => {
  const r = evaluateRegistryGovernanceSync({
    cap: capWithSource('MQTT_EDGE'),
    catalog: catWithCode('wait_time_min'),
    activeTopicRow: rowActive(false),
    sparkRow: rowActive(true),
  });
  assert.equal(r.ok, true);
});

test('evaluateRegistryGovernanceSync: MQTT_EDGE rejects when no active UNS or Sparkplug', () => {
  const r = evaluateRegistryGovernanceSync({
    cap: capWithSource('MQTT_EDGE'),
    catalog: catWithCode('wait_time_min'),
    activeTopicRow: rowActive(false),
    sparkRow: rowActive(false),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'mqtt_edge_no_active_registry_path');
});

test('evaluateRegistryGovernanceSync: NOT_AVAILABLE capability rejected', () => {
  const r = evaluateRegistryGovernanceSync({
    cap: capWithSource('NOT_AVAILABLE'),
    catalog: catWithCode('x'),
    activeTopicRow: rowActive(true),
    sparkRow: undefined,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'capability_not_available');
});

test('evaluateRegistryGovernanceSync: ADAPTER requires active UNS topic', () => {
  assert.equal(
    evaluateRegistryGovernanceSync({
      cap: capWithSource('ADAPTER'),
      catalog: catWithCode('m'),
      activeTopicRow: rowActive(true),
      sparkRow: undefined,
    }).ok,
    true
  );
  assert.equal(
    evaluateRegistryGovernanceSync({
      cap: capWithSource('ADAPTER'),
      catalog: catWithCode('m'),
      activeTopicRow: rowActive(false),
      sparkRow: rowActive(true),
    }).ok,
    false
  );
});

test('extensionConsumerApproved: board and ml agree on enabled+eligible', () => {
  const ext = {
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: true },
        },
        capabilities: {},
      },
    },
  };
  const b = extensionConsumerApproved('queue.wait_time_min', ext, 'board');
  const m = extensionConsumerApproved('queue.wait_time_min', ext, 'ml');
  assert.equal(b.approved, true);
  assert.equal(m.approved, true);
});

test('extensionConsumerApproved: ml rejects when mlEligible false', () => {
  const ext = {
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: false },
        },
        capabilities: {},
      },
    },
  };
  assert.equal(extensionConsumerApproved('queue.wait_time_min', ext, 'ml').approved, false);
  assert.equal(extensionConsumerApproved('queue.wait_time_min', ext, 'board').approved, true);
});

test('evaluateApprovedForOperationsFactsRow skips when operations extension blocks', () => {
  const asset = {
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: {
          'queue.wait_time_min': { enabled: true, boardEligible: true, mlEligible: true, operationsEligible: false },
        },
        capabilities: {},
      },
    },
  };
  const r = evaluateApprovedForOperationsFactsRow({
    asset,
    cap: capWithSource('MQTT_EDGE'),
    cat: catWithCode('wait_time_min'),
    activeTopicRow: rowActive(true),
    sparkRow: undefined,
  });
  assert.equal(r.approved, false);
  assert.equal(r.reason, 'operations_extension_blocked');
});

test('findExtensionKeysForSignalCode finds domain.metric keys', () => {
  const asset = {
    masterProfile: {
      unsAssetExtensions: {
        schemaVersion: 1,
        domains: ['queue'],
        signals: { 'queue.wait_time_min': { enabled: true } },
        capabilities: {},
      },
    },
  };
  const keys = findExtensionKeysForSignalCode(asset, 'wait_time_min');
  assert.ok(keys.includes('queue.wait_time_min'));
});

test('operationsExtensionAllowsForSignalCode: no extension keys → legacy allow', () => {
  const asset = {
    masterProfile: {
      unsAssetExtensions: { schemaVersion: 1, domains: [], signals: {}, capabilities: {} },
    },
  };
  assert.equal(operationsExtensionAllowsForSignalCode(asset, 'any_metric'), true);
});
