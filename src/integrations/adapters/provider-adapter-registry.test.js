'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderAdapterRegistry } = require('./provider-adapter-registry');
const { AppError } = require('../../utils/app-error');

/**
 * Phase C0/C1 lock-in for the legacy provider-adapter framework
 * (`src/integrations/adapters/`). These are the inner HTTP clients
 * used by:
 *   - the legacy IntegrationOrchestratorService (via ProviderAdapterRegistryService)
 *   - the new adapter-packages runtime (themeparks_wiki/index.js + wartezeiten_app/index.js
 *     both `new ThemeParksWikiAdapter()` / `new WartezeitenAppAdapter()` to fetch upstream)
 *
 * The two-framework split (R3 in the audit) is therefore actually a layered
 * architecture: provider adapters are the inner clients, adapter-packages are
 * the runtime contract. Phase C2 will likely move these classes inside the
 * matching package directories. Until then, the public shape locked here
 * MUST stay stable — both layers depend on it.
 */

test('ProviderAdapterRegistry: lists exactly the baseline provider keys', () => {
  const r = new ProviderAdapterRegistry();
  const keys = r.listProviderInfos().map((i) => i.provider).sort();
  assert.deepEqual(keys, ['themeparks_wiki', 'wartezeiten_app']);
});

test('ProviderAdapterRegistry: every provider info has provider/name/baseUrl/capabilities', () => {
  const r = new ProviderAdapterRegistry();
  for (const info of r.listProviderInfos()) {
    assert.equal(typeof info.provider, 'string', 'provider must be a string');
    assert.notEqual(info.provider, '', 'provider must be non-empty');
    assert.equal(typeof info.name, 'string', 'name must be a string');
    assert.equal(typeof info.baseUrl, 'string', 'baseUrl must be a string');
    assert.match(info.baseUrl, /^https?:\/\//, 'baseUrl must be an http(s) URL');
    assert.equal(typeof info.capabilities, 'object', 'capabilities must be an object');
    assert.notEqual(info.capabilities, null);
  }
});

test('ProviderAdapterRegistry: get(known) returns the same instance returned by listAdapters', () => {
  const r = new ProviderAdapterRegistry();
  const list = r.listAdapters();
  for (const adapter of list) {
    const key = adapter.getProviderInfo().provider;
    assert.strictEqual(r.get(key), adapter, `r.get('${key}') must be identity-equal to the adapter from listAdapters`);
  }
});

test('ProviderAdapterRegistry: get(unknown) throws AppError 404 with code NOT_FOUND', () => {
  const r = new ProviderAdapterRegistry();
  let thrown;
  try {
    r.get('nonexistent_provider');
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'expected AppError thrown');
  assert.ok(thrown instanceof AppError, 'expected AppError, got ' + (thrown && thrown.constructor && thrown.constructor.name));
  assert.equal(thrown.statusCode, 404);
  assert.equal(thrown.code, 'NOT_FOUND');
});

test('ProviderAdapterRegistry: provider info object is decoupled from adapter instance (mutation safety)', () => {
  // The dashboard and the controller serialize provider infos to JSON; mutating
  // the returned object must not corrupt the adapter's internal state. Capture
  // the info, mutate it, then re-fetch and ensure the new info is unchanged.
  const r = new ProviderAdapterRegistry();
  const themeparks = r.get('themeparks_wiki');
  const before = JSON.stringify(themeparks.getProviderInfo());
  const mutable = themeparks.getProviderInfo();
  mutable.provider = 'mutated';
  mutable.capabilities = {};
  const after = JSON.stringify(themeparks.getProviderInfo());
  assert.equal(after, before, 'mutating returned provider info must not affect the adapter');
});
