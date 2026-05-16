'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('./index');

test('predictive_maintenance poll noop by default', async () => {
  const r = await adapter.poll({}, {});
  assert.ok(Array.isArray(r.observations));
  assert.equal(r.observations.length, 0);
  assert.equal(r.debug.mode, 'noop');
});

test('predictive_maintenance validate passes when demo off without park slug', async () => {
  const v = await adapter.validateConfig({}, {});
  assert.equal(v.valid, true);
});

test('predictive_maintenance validate fails demo without park slug', async () => {
  const v = await adapter.validateConfig({ demoTelemetryEnabled: true }, {});
  assert.equal(v.valid, false);
});
