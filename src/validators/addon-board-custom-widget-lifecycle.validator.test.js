'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rideIdWidgetIdParams, validatePatchCustomWidgetBody } = require('./addon-board-custom-widget-lifecycle.validator');

test('rideIdWidgetIdParams accepts signal-style widgetId', () => {
  const { error } = rideIdWidgetIdParams.validate({
    rideId: '11111111-1111-1111-1111-111111111111',
    widgetId: 'signal_queue_wait_time_min',
  });
  assert.equal(error, undefined);
});

test('validatePatchCustomWidgetBody rejects empty object', () => {
  const r = validatePatchCustomWidgetBody({});
  assert.equal(r.ok, false);
});

test('validatePatchCustomWidgetBody accepts title', () => {
  const r = validatePatchCustomWidgetBody({ title: '  Queue wait  ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.title, 'Queue wait');
});

test('validatePatchCustomWidgetBody accepts enabled', () => {
  const r = validatePatchCustomWidgetBody({ enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.enabled, false);
});

test('validatePatchCustomWidgetBody rejects non-boolean enabled', () => {
  const r = validatePatchCustomWidgetBody({ enabled: 'yes' });
  assert.equal(r.ok, false);
});

test('validatePatchCustomWidgetBody rejects blank title', () => {
  const r = validatePatchCustomWidgetBody({ title: '   ' });
  assert.equal(r.ok, false);
});

test('validatePatchCustomWidgetBody rejects disallowed keys such as source', () => {
  const r = validatePatchCustomWidgetBody({ title: 'ok', source: {} });
  assert.equal(r.ok, false);
});
