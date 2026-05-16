'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

function validationWithRegistryMock(mockAssert) {
  return proxyquire('./integration-flow-validation.service', {
    './integration-node-registry.service': {
      ensureSynced: async () => {},
      assertNodeTypeEnabled: mockAssert,
    },
  });
}

const flowBase = {
  nodes: [
    { id: 't', type: 'MANUAL_TRIGGER', config: {} },
    {
      id: 'm',
      type: 'CANONICAL_MAPPING',
      config: { eventType: 'WAIT_TIME_UPDATED', mappings: { externalEntityId: '$.id' } },
    },
  ],
  edges: [{ source: 't', target: 'm' }],
};

test('validateFlowJson: valid linear flow', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async (type) => {
    if (String(type).startsWith('MANUAL') || String(type).includes('CANONICAL_MAPPING')) return { ok: true, entry: {} };
    return { ok: false, reason: `unknown node type: ${type}` };
  });
  const r = await validateFlowJson(flowBase);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateFlowJson: unknown node type rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async (type) =>
    type === 'MANUAL_TRIGGER'
      ? { ok: true, entry: {} }
      : { ok: false, reason: `unknown node type: ${type}` }
  );
  const r = await validateFlowJson({
    nodes: [
      { id: 'a', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'b', type: 'NOT_REGISTERED', config: {} },
    ],
    edges: [{ source: 'a', target: 'b' }],
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('unknown')));
});

test('validateFlowJson: disabled node rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async (type) =>
    type === 'MANUAL_TRIGGER'
      ? { ok: true, entry: {} }
      : { ok: false, reason: 'node type disabled: CANONICAL_MAPPING' }
  );
  const r = await validateFlowJson(flowBase);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('disabled')));
});

test('validateFlowJson: invalid edge rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const r = await validateFlowJson({
    nodes: [
      { id: 'a', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'b', type: 'MANUAL_TRIGGER', config: {} },
    ],
    edges: [{ source: 'a', target: 'missing' }],
  });
  assert.equal(r.valid, false);
});

test('validateFlowJson: disconnected graph rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const r = await validateFlowJson({
    nodes: [
      { id: 's', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'a', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'orphan', type: 'MANUAL_TRIGGER', config: {} },
    ],
    edges: [
      { source: 's', target: 'a' },
      { source: 'orphan', target: 'orphan' },
    ],
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.length > 0);
});

test('validateFlowJson: cyclic graph rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const r = await validateFlowJson({
    nodes: [
      { id: 's', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'a', type: 'MANUAL_TRIGGER', config: {} },
      { id: 'b', type: 'MANUAL_TRIGGER', config: {} },
    ],
    edges: [
      { source: 's', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  });
  assert.equal(r.valid, false);
});

test('validateFlowJson: script/code field rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const bad = {
    ...flowBase,
    nodes: [
      { id: 't', type: 'MANUAL_TRIGGER', config: { code: 'evil' } },
      flowBase.nodes[1],
    ],
  };
  const r = await validateFlowJson(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes('forbidden')));
});

test('validateFlowJson: invalid node position rejected', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const r = await validateFlowJson({
    nodes: [
      { id: 't', type: 'MANUAL_TRIGGER', config: {}, position: { x: 1, y: 'nope' } },
      flowBase.nodes[1],
    ],
    edges: flowBase.edges,
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('position')));
});

test('validateFlowJson: accepts optional finite node position', async () => {
  const { validateFlowJson } = validationWithRegistryMock(async () => ({ ok: true, entry: {} }));
  const r = await validateFlowJson({
    nodes: [
      { id: 't', type: 'MANUAL_TRIGGER', config: {}, position: { x: 10, y: 20 } },
      flowBase.nodes[1],
    ],
    edges: flowBase.edges,
  });
  assert.equal(r.valid, true);
});
