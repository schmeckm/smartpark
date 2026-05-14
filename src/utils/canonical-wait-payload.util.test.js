'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { coerceNumericWaitMinutes } = require('./canonical-wait-payload.util');

test('coerceNumericWaitMinutes accepts finite numbers', () => {
  assert.equal(coerceNumericWaitMinutes(0), 0);
  assert.equal(coerceNumericWaitMinutes(42.5), 42.5);
});

test('coerceNumericWaitMinutes parses numeric strings', () => {
  assert.equal(coerceNumericWaitMinutes(' 30 '), 30);
  assert.equal(coerceNumericWaitMinutes('-12.25'), -12.25);
});

test('coerceNumericWaitMinutes rejects non-numeric', () => {
  assert.equal(coerceNumericWaitMinutes('n/a'), null);
  assert.equal(coerceNumericWaitMinutes(''), null);
  assert.equal(coerceNumericWaitMinutes(Number.NaN), null);
  assert.equal(coerceNumericWaitMinutes(Number.POSITIVE_INFINITY), null);
  assert.equal(coerceNumericWaitMinutes({}), null);
});
