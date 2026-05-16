'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

const realValidation = require('./integration-flow-validation.service');

test('listTemplates includes ThemeParks and canonical test keys', () => {
  const { listTemplates } = require('./integration-flow-template.service');
  const list = listTemplates();
  assert.equal(list.length, 2);
  const keys = list.map((t) => t.templateKey).sort();
  assert.deepEqual(keys, ['manual_canonical_test_flow', 'manual_themeparks_live_import'].sort());
});

test('getTemplateOrThrow returns 404 AppError for unknown key', () => {
  const { getTemplateOrThrow } = require('./integration-flow-template.service');
  assert.throws(
    () => getTemplateOrThrow('not_a_template'),
    (e) => e.name === 'AppError' && e.statusCode === 404 && e.code === 'TEMPLATE_NOT_FOUND'
  );
});

test('buildFlowJsonForCreate applies whitelisted adapter override', async () => {
  const { buildFlowJsonForCreate } = proxyquire('./integration-flow-template.service', {
    './integration-flow-validation.service': {
      validateFlowJson: async () => ({ valid: true, errors: [], warnings: [] }),
      collectForbiddenKeys: realValidation.collectForbiddenKeys,
    },
  });
  const fj = await buildFlowJsonForCreate('manual_themeparks_live_import', {
    nodes: { adapter_1: { destinationId: 'my-destination' } },
  });
  const adapter = fj.nodes.find((n) => n.id === 'adapter_1');
  assert.equal(adapter.config.destinationId, 'my-destination');
});

test('buildFlowJsonForCreate rejects unknown override node', async () => {
  const { buildFlowJsonForCreate } = proxyquire('./integration-flow-template.service', {
    './integration-flow-validation.service': {
      validateFlowJson: async () => ({ valid: true, errors: [], warnings: [] }),
      collectForbiddenKeys: realValidation.collectForbiddenKeys,
    },
  });
  await assert.rejects(
    () => buildFlowJsonForCreate('manual_themeparks_live_import', { nodes: { no_such_node: { x: 1 } } }),
    (e) => e.code === 'UNKNOWN_OVERRIDE_NODE'
  );
});

test('buildFlowJsonForCreate rejects unsafe override key', async () => {
  const { buildFlowJsonForCreate } = proxyquire('./integration-flow-template.service', {
    './integration-flow-validation.service': {
      validateFlowJson: async () => ({ valid: true, errors: [], warnings: [] }),
      collectForbiddenKeys: realValidation.collectForbiddenKeys,
    },
  });
  await assert.rejects(
    () =>
      buildFlowJsonForCreate('manual_themeparks_live_import', {
        nodes: { adapter_1: { destinationId: 'ok', notAllowed: true } },
      }),
    (e) => e.code === 'UNSAFE_CONFIG_OVERRIDE'
  );
});
