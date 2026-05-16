'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('built-in templates pass graph validation with stubbed node registry', async () => {
  const validateFlowJson = proxyquire('./integration-flow-validation.service', {
    './integration-node-registry.service': {
      ensureSynced: async () => {},
      assertNodeTypeEnabled: async () => ({ ok: true, entry: {} }),
    },
  }).validateFlowJson;
  const { listTemplates, cloneJson } = require('./integration-flow-template.service');
  for (const tpl of listTemplates()) {
    const result = await validateFlowJson(cloneJson(tpl.flowJson));
    assert.ok(result.valid, `${tpl.templateKey}: ${(result.errors || []).join('; ')}`);
  }
});
