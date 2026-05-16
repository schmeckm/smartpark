'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPreviewPayload,
  buildStepInputPreview,
  buildStepOutputPreview,
  PREVIEW_MAX_BYTES,
} = require('./integration-flow-preview.service');
const { sanitizeStepPayload } = require('./integration-flow-persistence.helper');

test('buildPreviewPayload: small payload passes through with preview metadata', () => {
  const out = buildPreviewPayload({ id: 1, name: 'test' });
  assert.ok(out && typeof out === 'object');
  assert.equal(out._preview, true);
  assert.equal(out.id, 1);
  assert.equal(out._truncated, false);
});

test('buildPreviewPayload: large array truncated with rowCount and originalBytes', () => {
  const huge = {
    items: Array.from({ length: 200 }, (_, i) => ({ id: i, wait: i * 2, label: `ride-${i}` })),
  };
  const out = buildPreviewPayload(huge, { maxBytes: 4000, maxRows: 5 });
  assert.ok(out && typeof out === 'object');
  assert.equal(out._preview, true);
  assert.equal(out._truncated, true);
  assert.equal(out._rowCount, 200);
  assert.ok(out._originalBytes > PREVIEW_MAX_BYTES || out._originalBytes > 1000);
  assert.ok(Array.isArray(out.items));
  assert.ok(out.items.length <= 5);
  const encoded = Buffer.byteLength(JSON.stringify(out), 'utf8');
  assert.ok(encoded <= 5000);
});

test('buildStepInputPreview: includes node config keys', () => {
  const out = buildStepInputPreview({
    nodeConfig: { eventType: 'X', provider: 'p' },
    upstreamPayload: { id: 'a', value: 1 },
  });
  assert.ok(out && typeof out === 'object');
  assert.deepEqual(out._nodeConfigKeys, ['eventType', 'provider']);
});

test('buildStepOutputPreview: uses sanitize and stays separate from full persistence size', () => {
  const full = { canonicalMessages: Array.from({ length: 100 }, (_, i) => ({ id: i, payload: { x: i } })) };
  const preview = buildStepOutputPreview(full);
  const fullSanitized = sanitizeStepPayload(full, 50000);
  const previewBytes = Buffer.byteLength(JSON.stringify(preview), 'utf8');
  const fullBytes = Buffer.byteLength(JSON.stringify(fullSanitized), 'utf8');
  assert.ok(previewBytes < fullBytes);
});
