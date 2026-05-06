'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PlatformSettingsService } = require('./platform-settings.service');

test('resolveBoolean prefers DB over env default', () => {
  const svc = new PlatformSettingsService();
  const rows = new Map();
  rows.set('AI_SAMPLING_ENABLED', {
    settingKey: 'AI_SAMPLING_ENABLED',
    settingValue: 'false',
    activeFlag: true,
  });
  const r = svc.resolveBoolean('AI_SAMPLING_ENABLED', rows);
  assert.equal(r.value, false);
  assert.equal(r.source, 'DB');
});

test('resolveBoolean uses registry default when DB row missing and env unset', (t) => {
  const svc = new PlatformSettingsService();
  t.after(() => {
    delete process.env.AI_SAMPLING_ENABLED;
  });
  delete process.env.AI_SAMPLING_ENABLED;
  const rows = new Map();
  const r = svc.resolveBoolean('AI_SAMPLING_ENABLED', rows);
  assert.equal(r.value, true);
  assert.equal(r.source, 'DEFAULT');
});

test('resolveBoolean uses ENV when DB missing', (t) => {
  const svc = new PlatformSettingsService();
  t.after(() => {
    delete process.env.AI_SAMPLING_ENABLED;
  });
  process.env.AI_SAMPLING_ENABLED = 'false';
  const rows = new Map();
  const r = svc.resolveBoolean('AI_SAMPLING_ENABLED', rows);
  assert.equal(r.value, false);
  assert.equal(r.source, 'ENV');
});
