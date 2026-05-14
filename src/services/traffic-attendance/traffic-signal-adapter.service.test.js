'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TrafficSignalAdapter } = require('./traffic-signal-adapter.service');

test('TrafficSignalAdapter.createManualSnapshot returns null when corridor missing', async () => {
  const a = new TrafficSignalAdapter({
    TrafficCorridor: { findByPk: async () => null },
    TrafficCorridorSnapshot5m: { create: async () => assert.fail('should not create') },
  });
  assert.equal(await a.createManualSnapshot('00000000-0000-4000-8000-000000000099', 12), null);
});
