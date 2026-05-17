'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapWithConcurrency } = require('./async-pool');

test('mapWithConcurrency preserves order', async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
    await new Promise((r) => setTimeout(r, 10 - n));
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8]);
});
