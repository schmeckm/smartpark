'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProviderAdapterRegistry,
  loadProviderAdaptersFromPackages,
  findProviderAdapterConstructor,
} = require('./provider-adapter-registry');
const { ProviderAdapterInterface } = require('./provider-adapter.interface');
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

/* ────────────────────────────────────────────────────────────────────────────
   Phase C2 lock-in: dynamic, manifest-driven registry
   ────────────────────────────────────────────────────────────────────────── */

test('C2 findProviderAdapterConstructor: finds a class extending ProviderAdapterInterface', () => {
  class GoodOne extends ProviderAdapterInterface {}
  class Unrelated {}
  function notAClass() {}
  assert.equal(findProviderAdapterConstructor({ GoodOne }), GoodOne);
  assert.equal(findProviderAdapterConstructor({ Unrelated, GoodOne }), GoodOne);
  assert.equal(findProviderAdapterConstructor({ notAClass, Unrelated }), null);
  assert.equal(findProviderAdapterConstructor(null), null);
  assert.equal(findProviderAdapterConstructor({}), null);
});

test('C2 loadProviderAdaptersFromPackages: production filesystem yields exactly the baseline providers', () => {
  const { instances, errors } = loadProviderAdaptersFromPackages();
  const providers = instances.map((i) => i.getProviderInfo().provider).sort();
  assert.deepEqual(
    providers,
    ['themeparks_wiki', 'wartezeiten_app'],
    'production providerAdapterClient manifests must produce exactly the legacy provider set'
  );
  assert.deepEqual(errors, [], `expected zero load errors, got: ${JSON.stringify(errors, null, 2)}`);
});

test('C2 loadProviderAdaptersFromPackages: instances are alphabetically ordered by provider key', () => {
  const { instances } = loadProviderAdaptersFromPackages();
  const providers = instances.map((i) => i.getProviderInfo().provider);
  const sorted = [...providers].sort();
  assert.deepEqual(providers, sorted, 'instances must be sorted by provider key for deterministic boot order');
});

test('C2 ProviderAdapterRegistry: handles a synthetic packages dir with one provider + one runtime-only + one error case', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-registry-c2-'));
  try {
    // Provider package: manifest points to a sibling client.js that exports
    // a class extending ProviderAdapterInterface.
    const provDir = path.join(tmp, 'mock_provider');
    fs.mkdirSync(provDir);
    fs.writeFileSync(
      path.join(provDir, 'manifest.json'),
      JSON.stringify({ adapterKey: 'mock_provider', providerAdapterClient: 'client.js' })
    );
    fs.writeFileSync(
      path.join(provDir, 'client.js'),
      `'use strict';
const { ProviderAdapterInterface } = require(${JSON.stringify(
        path.resolve(__dirname, 'provider-adapter.interface.js').replace(/\\/g, '/')
      )});
class MockProviderAdapter extends ProviderAdapterInterface {
  getProviderInfo() {
    return { provider: 'mock_provider', name: 'Mock', baseUrl: 'https://example.test', capabilities: {} };
  }
}
module.exports = { MockProviderAdapter };
`
    );

    // Runtime-only package: no providerAdapterClient declared. Must be skipped silently.
    const runtimeDir = path.join(tmp, 'runtime_only');
    fs.mkdirSync(runtimeDir);
    fs.writeFileSync(
      path.join(runtimeDir, 'manifest.json'),
      JSON.stringify({ adapterKey: 'runtime_only' })
    );

    // Broken provider package: manifest claims a client.js that doesn't exist.
    const brokenDir = path.join(tmp, 'broken_provider');
    fs.mkdirSync(brokenDir);
    fs.writeFileSync(
      path.join(brokenDir, 'manifest.json'),
      JSON.stringify({ adapterKey: 'broken_provider', providerAdapterClient: 'missing-client.js' })
    );

    const errorMessages = [];
    const registry = new ProviderAdapterRegistry({
      packagesDir: tmp,
      onLoadError: (msg) => errorMessages.push(msg),
    });

    const providers = registry.listProviderInfos().map((i) => i.provider);
    assert.deepEqual(providers, ['mock_provider'], 'only the well-formed provider package must register');
    assert.equal(errorMessages.length, 1, 'broken_provider must produce exactly one onLoadError call');
    assert.match(errorMessages[0], /broken_provider/);
    assert.match(errorMessages[0], /missing-client\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('C2 ProviderAdapterRegistry: empty packages dir registers zero providers without throwing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-registry-empty-'));
  try {
    const registry = new ProviderAdapterRegistry({
      packagesDir: tmp,
      onLoadError: () => {},
    });
    assert.deepEqual(registry.listProviderInfos(), []);
    assert.deepEqual(registry.listAdapters(), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('C2 ProviderAdapterRegistry: rejects modules whose exports are not ProviderAdapterInterface subclasses', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-registry-reject-'));
  try {
    const dir = path.join(tmp, 'misshaped');
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ adapterKey: 'misshaped', providerAdapterClient: 'client.js' })
    );
    fs.writeFileSync(
      path.join(dir, 'client.js'),
      `'use strict';
class NotAProvider {} // does not extend ProviderAdapterInterface
module.exports = { NotAProvider };
`
    );
    const errors = [];
    const registry = new ProviderAdapterRegistry({
      packagesDir: tmp,
      onLoadError: (msg) => errors.push(msg),
    });
    assert.deepEqual(registry.listProviderInfos(), []);
    assert.equal(errors.length, 1, 'misshaped module must produce an onLoadError');
    assert.match(errors[0], /does not export a class extending ProviderAdapterInterface/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
