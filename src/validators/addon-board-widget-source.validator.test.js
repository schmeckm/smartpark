'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateWidgetSourceDraftBody } = require('./addon-board-widget-source.validator');

const rideId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('validateWidgetSourceDraftBody rejects entityId mismatch', () => {
  const r = validateWidgetSourceDraftBody(
    {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: '11111111-1111-1111-1111-111111111111',
      signalKey: 'queue.wait',
    },
    rideId
  );
  assert.equal(r.ok, false);
});

test('validateWidgetSourceDraftBody accepts matching entityId', () => {
  const r = validateWidgetSourceDraftBody(
    {
      sourceType: 'SIGNAL_METADATA',
      entityType: 'park_asset',
      entityId: rideId,
      signalKey: 'queue.wait',
    },
    rideId
  );
  assert.equal(r.ok, true);
});
