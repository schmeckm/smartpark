'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const env = require('../../../config/env');
const node = require('./payload-transform.node.js');

describe('PAYLOAD_TRANSFORM node', () => {
  it('mapping mode applies JSON paths', async () => {
    const res = await node.execute({
      payload: { id: 'r1', queue: { STANDBY: { waitTime: 42 } }, status: 'OPEN', lastUpdated: '2026-01-01T00:00:00Z' },
      nodeConfig: {
        mode: 'mapping',
        mappings: {
          assetId: '$.id',
          waitTime: '$.queue.STANDBY.waitTime',
          status: '$.status',
          timestamp: '$.lastUpdated',
        },
        outputRoot: 'payload',
      },
    });
    assert.equal(res.success, true);
    assert.deepEqual(res.payload, {
      assetId: 'r1',
      waitTime: 42,
      status: 'OPEN',
      timestamp: '2026-01-01T00:00:00Z',
    });
  });

  it('rejects empty mappings in mapping mode', async () => {
    const res = await node.execute({
      payload: { a: 1 },
      nodeConfig: { mode: 'mapping', mappings: {} },
    });
    assert.equal(res.success, false);
    assert.match(String(res.error), /mappings/i);
  });

  it('rejects script mode when feature flag disabled', async () => {
    const prev = env.integrationFlowScriptNodeEnabled;
    env.integrationFlowScriptNodeEnabled = false;
    try {
      const res = await node.execute({
        payload: { x: 1 },
        nodeConfig: { mode: 'script', script: 'return { x: 1 };' },
      });
      assert.equal(res.success, false);
      assert.match(String(res.error), /governance/i);
    } finally {
      env.integrationFlowScriptNodeEnabled = prev;
    }
  });
});
