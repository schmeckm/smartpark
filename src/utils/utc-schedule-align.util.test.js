'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { msUntilNextUtcWallMultipleMinutes } = require('./utc-schedule-align.util');

test('msUntilNextUtcWallMultipleMinutes targets next 5m boundary + padding', () => {
  const now = new Date('2026-05-13T13:03:10.000Z');
  const ms = msUntilNextUtcWallMultipleMinutes(5, now, 2000);
  assert.equal(ms, 112_000);
});

test('msUntilNextUtcWallMultipleMinutes on exact boundary uses following bucket', () => {
  const now = new Date('2026-05-13T13:05:00.000Z');
  const ms = msUntilNextUtcWallMultipleMinutes(5, now, 0);
  assert.equal(ms, 5 * 60 * 1000);
});
