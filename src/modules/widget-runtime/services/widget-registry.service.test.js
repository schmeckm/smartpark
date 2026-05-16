'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('validateConfigAgainstSchema rejects unknown keys when additionalProperties false', () => {
  const { validateConfigAgainstSchema } = proxyquire('./widget-registry.service', {
    '../../../models': {
      DashboardWidgetRegistry: { findOne: async () => null, create: async () => ({}), update: async () => ({}) },
    },
  });

  assert.throws(
    () =>
      validateConfigAgainstSchema(
        { type: 'object', properties: { limit: { type: 'integer' } }, additionalProperties: false },
        { limit: 5, evil: true }
      ),
    (e) => e.code === 'INVALID_WIDGET_CONFIG'
  );
});

test('DEFAULT_WIDGETS includes four governed flow widgets', () => {
  const { DEFAULT_WIDGETS, ALLOWED_COMPONENT_NAMES } = require('../registry/default-widgets');
  assert.equal(DEFAULT_WIDGETS.length, 4);
  assert.ok(ALLOWED_COMPONENT_NAMES.has('FlowHealthCardWidget'));
});
