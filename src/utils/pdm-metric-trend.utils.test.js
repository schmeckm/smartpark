'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linearRegressionSlope, coefficientOfVariation, spikeCount } = require('./pdm-metric-trend.utils');

test('linearRegressionSlope: ascending trend > 0', () => {
  const s = linearRegressionSlope([1, 2, 3, 4, 5]);
  assert.ok(s > 0);
});

test('coefficientOfVariation: constant series is null', () => {
  assert.equal(coefficientOfVariation([3, 3, 3, 3]), null);
});

test('spikeCount: detects rare jump', () => {
  const v = [1, 1.1, 1.05, 1.12, 10, 1.08];
  assert.ok(spikeCount(v) >= 1);
});
