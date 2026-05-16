'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeStepPayload, TRUNCATE_WARNING } = require('./integration-flow-persistence.helper');

test('sanitizeStepPayload: returns payload unchanged when under limit', () => {
  const p = { a: 1, b: 'ok' };
  assert.deepEqual(sanitizeStepPayload(p, 50000), p);
});

test('sanitizeStepPayload: truncates large liveData-style arrays', () => {
  const huge = {
    debug: {
      rawInput: {
        live: {
          liveData: Array.from({ length: 500 }, (_, i) => ({
            id: `ride-${i}`,
            name: `Ride ${i}`,
            value: i,
            status: 'OPEN',
          })),
        },
      },
    },
  };
  const out = sanitizeStepPayload(huge, 5000);
  assert.ok(out && typeof out === 'object');
  assert.equal(out._warning, TRUNCATE_WARNING);
  assert.ok(out._originalBytes > 5000);
});
