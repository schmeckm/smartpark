'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _flowTesting } = require('./geo-flow-simulator.service');

test('mulberry32 is deterministic for same seed', () => {
  const a = _flowTesting.mulberry32(42);
  const b = _flowTesting.mulberry32(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('weightedPick respects weights', () => {
  const rng = () => 0.99;
  const items = ['a', 'b', 'c'];
  const pick = _flowTesting.weightedPick(rng, items, (x) => (x === 'c' ? 100 : 1));
  assert.equal(pick, 'c');
});
