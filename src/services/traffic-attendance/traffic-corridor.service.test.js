'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCoordinatesIfPresent } = require('./traffic-corridor.service');

test('validateCoordinatesIfPresent allows both null', () => {
  validateCoordinatesIfPresent({ originLat: null, originLng: null });
});

test('validateCoordinatesIfPresent requires lat/lng pairs', () => {
  assert.throws(() => validateCoordinatesIfPresent({ originLat: 48, originLng: null }), /COORD_PAIR_INCOMPLETE/);
});
