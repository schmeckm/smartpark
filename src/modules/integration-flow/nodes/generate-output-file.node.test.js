'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const node = require('./generate-output-file.node.js');

describe('GENERATE_OUTPUT_FILE node', () => {
  it('returns safe no-op file metadata', async () => {
    const res = await node.execute({
      payload: { items: [{ id: 1 }] },
      nodeConfig: { format: 'csv', filenameTemplate: 'rides-{{timestamp}}' },
    });
    assert.equal(res.success, true);
    assert.equal(res.payload.fileOutput.generated, false);
    assert.match(String(res.payload.fileOutput.reason), /not implemented/i);
    assert.equal(res.payload.fileOutput.format, 'csv');
    assert.equal(res.payload.items.length, 1);
  });
});
