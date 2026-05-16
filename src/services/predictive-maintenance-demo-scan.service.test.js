'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expandAssetTypeCodes } = require('./predictive-maintenance-demo-scan.service');

test('expandAssetTypeCodes maps ATTRACTION to RIDE', () => {
  assert.deepEqual(expandAssetTypeCodes(['RIDE', 'ATTRACTION']), ['RIDE']);
});

test('expandAssetTypeCodes preserves distinct codes', () => {
  const codes = expandAssetTypeCodes(['SHOW', 'RESTAURANT']);
  assert.ok(codes.includes('SHOW'));
  assert.ok(codes.includes('RESTAURANT'));
  assert.equal(codes.length, 2);
});

test('expandAssetTypeCodes defaults to RIDE when empty input', () => {
  assert.deepEqual(expandAssetTypeCodes([]), ['RIDE']);
});
