'use strict';

/**
 * Regression guard: UNS governance paths must not pull in MQTT connector publish,
 * ThemeParks sync, or legacy UNS writers (except where explicitly owned elsewhere).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const denyPatterns = [
  {
    file: 'registry-signal-deprecation.service.js',
    mustNotContain: ['mqtt-connector.service', 'themeparks-sync', 'uns-state.service', 'UnsService'],
  },
  {
    file: 'operations-facts.service.js',
    mustNotContain: ['mqtt-connector.service', 'themeparks-sync.routes', 'uns.service'],
  },
];

function readService(rel) {
  const p = path.join(__dirname, rel);
  return fs.readFileSync(p, 'utf8');
}

for (const { file, mustNotContain } of denyPatterns) {
  test(`static: ${file} avoids heavyweight UNS/MQTT/sync writers`, () => {
    const src = readService(file);
    for (const needle of mustNotContain) {
      assert.ok(
        !src.includes(needle),
        `${file} must not reference ${needle} (accidental coupling)`
      );
    }
  });
}

test('registry publisher imports mqtt publish helper only for intentional pilot publishes', () => {
  const src = readService('registry-publisher.service.js');
  assert.ok(src.includes('./mqtt-connector.service'));
  assert.ok(src.includes('publishMqtt'));
});
