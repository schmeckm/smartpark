'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CanonicalIngestionHookRegistry,
  canonicalIngestionHooks,
} = require('./canonical-ingestion-hooks');

/**
 * Phase C3.7 unit tests for the post-ingest hook registry.
 *
 * The shared `canonicalIngestionHooks` singleton is auto-populated by
 * `themeparks-sync.service.js` at module-import time. Tests in this
 * file use a FRESH `CanonicalIngestionHookRegistry` instance so the
 * singleton is left untouched.
 */

test('CanonicalIngestionHookRegistry: registerAfterEntities + run', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  let called = false;
  reg.registerAfterEntities('themeparks_wiki', async (ctx) => {
    called = true;
    return { ok: true, ctx };
  });
  const result = await reg.runAfterEntities('themeparks_wiki', { externalParkId: 'p1' });
  assert.equal(called, true);
  assert.equal(result.ok, true);
  assert.equal(result.ctx.externalParkId, 'p1');
});

test('CanonicalIngestionHookRegistry: registerAfterLive + run', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  reg.registerAfterLive('themeparks_wiki', async () => 'live-done');
  const result = await reg.runAfterLive('themeparks_wiki', {});
  assert.equal(result, 'live-done');
});

test('CanonicalIngestionHookRegistry: case-insensitive provider matching', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  reg.registerAfterEntities('Themeparks_Wiki', async () => 'ok');
  const out = await reg.runAfterEntities('THEMEPARKS_WIKI', {});
  assert.equal(out, 'ok');
});

test('CanonicalIngestionHookRegistry: run* returns null when no hook is registered', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  assert.equal(await reg.runAfterEntities('unknown', {}), null);
  assert.equal(await reg.runAfterLive('unknown', {}), null);
});

test('CanonicalIngestionHookRegistry: hasAfter* reports registration state', () => {
  const reg = new CanonicalIngestionHookRegistry();
  reg.registerAfterEntities('themeparks_wiki', () => {});
  assert.equal(reg.hasAfterEntities('themeparks_wiki'), true);
  assert.equal(reg.hasAfterEntities('wartezeiten_app'), false);
  assert.equal(reg.hasAfterLive('themeparks_wiki'), false);
});

test('CanonicalIngestionHookRegistry: registering twice replaces the function', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  reg.registerAfterEntities('themeparks_wiki', () => 'first');
  reg.registerAfterEntities('themeparks_wiki', () => 'second');
  const out = await reg.runAfterEntities('themeparks_wiki', {});
  assert.equal(out, 'second');
});

test('CanonicalIngestionHookRegistry: register* throws on bad arguments', () => {
  const reg = new CanonicalIngestionHookRegistry();
  assert.throws(() => reg.registerAfterEntities('', () => {}), TypeError);
  assert.throws(() => reg.registerAfterEntities('p', null), TypeError);
  assert.throws(() => reg.registerAfterLive(null, () => {}), TypeError);
  assert.throws(() => reg.registerAfterLive('p', undefined), TypeError);
});

test('CanonicalIngestionHookRegistry: run* propagates async errors', async () => {
  const reg = new CanonicalIngestionHookRegistry();
  reg.registerAfterEntities('themeparks_wiki', async () => {
    throw new Error('boom');
  });
  await assert.rejects(reg.runAfterEntities('themeparks_wiki', {}), /boom/);
});

/* ------------------ singleton (loaded by bootstrap) ----------------- */

test('canonicalIngestionHooks (singleton): loading the bootstrap registers themeparks_wiki', () => {
  // Trigger bootstrap registration.
  require('./canonical-ingestion-hooks.bootstrap');
  assert.equal(
    canonicalIngestionHooks.hasAfterEntities('themeparks_wiki'),
    true,
    'themeparks-sync.service must register an after-entities hook for themeparks_wiki'
  );
  assert.equal(
    canonicalIngestionHooks.hasAfterLive('themeparks_wiki'),
    true,
    'themeparks-sync.service must register an after-live hook for themeparks_wiki'
  );
});
