'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugifyName } = require('./slugify.util');

test('slugifyName: returns empty string for null/undefined/empty', () => {
  assert.equal(slugifyName(null), '');
  assert.equal(slugifyName(undefined), '');
  assert.equal(slugifyName(''), '');
  assert.equal(slugifyName('   '), '');
});

test('slugifyName: lowercases', () => {
  assert.equal(slugifyName('Europa Park'), 'europa_park');
  assert.equal(slugifyName('SILVER STAR'), 'silver_star');
});

test('slugifyName: collapses non-alphanumeric runs into a single underscore', () => {
  assert.equal(slugifyName('blue---fire'), 'blue_fire');
  assert.equal(slugifyName('a / b - c d'), 'a_b_c_d');
  assert.equal(slugifyName('foo___bar'), 'foo_bar');
});

test('slugifyName: trims leading/trailing underscores', () => {
  assert.equal(slugifyName('  __foo__  '), 'foo');
  assert.equal(slugifyName('!!!hello!!!'), 'hello');
});

test('slugifyName: preserves digits', () => {
  assert.equal(slugifyName('Voltron Nevera 360°'), 'voltron_nevera_360');
});

test('slugifyName: non-string input is coerced via String()', () => {
  assert.equal(slugifyName(42), '42');
  assert.equal(slugifyName(true), 'true');
});

test('slugifyName: idempotent on already-slugged input', () => {
  assert.equal(slugifyName('blue_fire'), 'blue_fire');
  assert.equal(slugifyName(slugifyName('Blue Fire — Megacoaster')), slugifyName('Blue Fire — Megacoaster'));
});
