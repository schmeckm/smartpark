'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const env = require('../../../config/env');
const { validateFlowJson } = require('./integration-flow-validation.service');

describe('validateFlowJson PAYLOAD_TRANSFORM', () => {
  it('rejects script mode when governance flag is off', async () => {
    const prev = env.integrationFlowScriptNodeEnabled;
    env.integrationFlowScriptNodeEnabled = false;
    try {
      const result = await validateFlowJson({
        nodes: [
          { id: 't', type: 'MANUAL_TRIGGER', config: {} },
          {
            id: 'xform',
            type: 'PAYLOAD_TRANSFORM',
            config: { mode: 'script', script: 'return {}' },
          },
        ],
        edges: [{ source: 't', target: 'xform' }],
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => /governance/i.test(e)));
    } finally {
      env.integrationFlowScriptNodeEnabled = prev;
    }
  });

  it('accepts mapping mode with mappings', async () => {
    const result = await validateFlowJson({
      nodes: [
        { id: 't', type: 'MANUAL_TRIGGER', config: {} },
        {
          id: 'xform',
          type: 'PAYLOAD_TRANSFORM',
          config: { mode: 'mapping', mappings: { a: '$.b' } },
        },
      ],
      edges: [{ source: 't', target: 'xform' }],
    });
    assert.equal(result.valid, true);
  });
});
