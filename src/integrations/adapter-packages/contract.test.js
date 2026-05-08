'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AdapterPackageLoaderService } = require('../../modules/integrations/adapter-framework/adapter-package-loader.service');
const { AdapterManifestValidatorService } = require('../../modules/integrations/adapter-framework/adapter-manifest-validator.service');
const { assertRuntimeContract } = require('../../modules/integrations/adapter-framework/adapter-runtime-contract');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'governance', 'adapter-keys-baseline.json');
const PACKAGES_DIR = __dirname;

function loadBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const baseline = loadBaseline();
const expectedKeys = [...baseline.adapterKeys].sort();
const expectedRuntimeFns = baseline.expectedRuntimeContract;

/**
 * Phase C0/C1 contract tests for the adapter-packages framework. They lock in
 * the minimum shape that the consolidation work in C2+ must preserve. None of
 * these tests touch a database; they only require the filesystem under
 * `src/integrations/adapter-packages/`.
 *
 * If any of these fail, the refactor has changed an externally-observable
 * contract (an adapter key, a manifest schema, the runtime function set,
 * or the loader's discovery semantics) — restore the contract or update
 * the baseline + write the matching DB migration before merging.
 */

test('adapter-packages contract: scanPackages returns exactly the baseline keys', () => {
  const loader = new AdapterPackageLoaderService();
  const scan = loader.scanPackages();
  const found = scan.map((s) => s.adapterKey).sort();
  assert.deepEqual(found, expectedKeys, 'scanned adapter keys must equal the baseline');
});

test('adapter-packages contract: every package has a valid manifest with adapterKey === directory name', () => {
  const validator = new AdapterManifestValidatorService();
  const failures = [];

  for (const dirName of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)) {
    const manifestPath = path.join(PACKAGES_DIR, dirName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      failures.push(`${dirName}: manifest.json failed to parse — ${err.message}`);
      continue;
    }

    if (manifest.adapterKey !== dirName) {
      failures.push(`${dirName}: manifest.adapterKey="${manifest.adapterKey}" does not equal directory name`);
    }

    const v = validator.validateManifest(manifest);
    if (!v.valid) {
      failures.push(`${dirName}: manifest invalid — ${v.errors.join('; ')}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Manifest contract violations:\n  - ${failures.join('\n  - ')}`
  );
});

test('adapter-packages contract: every baseline package loads via loadByAdapterKey and exposes the runtime function set', () => {
  const loader = new AdapterPackageLoaderService();
  const failures = [];

  for (const adapterKey of expectedKeys) {
    let loaded;
    try {
      loaded = loader.loadByAdapterKey(adapterKey);
    } catch (err) {
      failures.push(`${adapterKey}: loadByAdapterKey threw — ${err.message}`);
      continue;
    }
    if (!loaded || !loaded.runtime) {
      failures.push(`${adapterKey}: loadByAdapterKey returned ${loaded == null ? 'null' : 'no runtime'}`);
      continue;
    }
    for (const fn of expectedRuntimeFns) {
      if (typeof loaded.runtime[fn] !== 'function') {
        failures.push(`${adapterKey}: runtime missing function ${fn}`);
      }
    }
    try {
      assertRuntimeContract(loaded.runtime);
    } catch (err) {
      failures.push(`${adapterKey}: assertRuntimeContract threw — ${err.message}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Runtime contract violations:\n  - ${failures.join('\n  - ')}`
  );
});

test('adapter-packages contract: loader returns null for unknown adapter keys (no implicit fallback)', () => {
  const loader = new AdapterPackageLoaderService();
  const result = loader.loadByAdapterKey('does_not_exist_anywhere');
  assert.equal(result, null, 'unknown adapter keys must resolve to null, never to a sibling package');
});

test('adapter-packages contract: scanPackages and loadAll agree on the set of keys', () => {
  const loader = new AdapterPackageLoaderService();
  const scanKeys = loader.scanPackages().map((p) => p.adapterKey).sort();
  const loadAllKeys = loader.loadAll().map((p) => p.manifest.adapterKey).sort();
  assert.deepEqual(
    loadAllKeys,
    scanKeys,
    'loadAll() must return the same set of keys as scanPackages() — diverging means require() failed for some package'
  );
});

test('adapter-packages contract: every adapter key matches the regex enforced by AdapterInstallConfigRepository', () => {
  // `assertSafeAdapterKey` in src/repositories/adapter-install-config.repository.js
  // accepts /^[a-z0-9_-]{1,120}$/i. Lock in that the production keys all comply
  // so YAML install-config writes never throw at the repository boundary.
  const re = /^[a-z0-9_-]{1,120}$/i;
  for (const key of expectedKeys) {
    assert.ok(re.test(key), `adapterKey "${key}" does not match the install-config repository regex ${re}`);
  }
});

test('adapter-packages contract: every provider package declares providerAdapterClient pointing at an existing file (Phase C2)', () => {
  const failures = [];
  for (const adapterKey of baseline.providerAdapterKeys) {
    const manifestPath = path.join(PACKAGES_DIR, adapterKey, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.providerAdapterClient !== 'string' || !manifest.providerAdapterClient.trim()) {
      failures.push(`${adapterKey}: manifest.providerAdapterClient must be a non-empty string`);
      continue;
    }
    const clientPath = path.join(PACKAGES_DIR, adapterKey, manifest.providerAdapterClient);
    if (!fs.existsSync(clientPath)) {
      failures.push(`${adapterKey}: providerAdapterClient="${manifest.providerAdapterClient}" not found at ${clientPath}`);
    }
  }
  assert.equal(
    failures.length,
    0,
    `providerAdapterClient declaration violations:\n  - ${failures.join('\n  - ')}`
  );
});

test('adapter-packages contract: manifest validator rejects malformed providerAdapterClient (Phase C2)', () => {
  const validator = new AdapterManifestValidatorService();
  // A baseline-shaped manifest with the field set to non-string fails.
  const base = {
    adapterKey: 'x',
    name: 'X',
    version: '1.0.0',
    runtime: 'NODE',
    adapterType: 'PUBLIC_API',
    capabilities: [],
  };
  const empty = validator.validateManifest({ ...base, providerAdapterClient: '' });
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.some((e) => e.includes('providerAdapterClient')));

  const numeric = validator.validateManifest({ ...base, providerAdapterClient: 42 });
  assert.equal(numeric.valid, false);
  assert.ok(numeric.errors.some((e) => e.includes('providerAdapterClient')));

  // A manifest with the field absent stays valid.
  const without = validator.validateManifest({ ...base });
  assert.equal(without.valid, true);

  // A manifest with the field set to a valid string is also valid.
  const good = validator.validateManifest({ ...base, providerAdapterClient: 'client.js' });
  assert.equal(good.valid, true);
});

test('adapter-packages contract: providerAdapterKeys baseline subset is consistent with the legacy registry', () => {
  // The legacy ProviderAdapterRegistry (src/integrations/adapters/provider-adapter-registry.js)
  // hard-codes the set { themeparks_wiki, wartezeiten_app }. The baseline lists
  // these under `providerAdapterKeys` and must stay in lockstep.
  const { ProviderAdapterRegistry } = require('../adapters/provider-adapter-registry');
  const registry = new ProviderAdapterRegistry();
  const live = registry.listProviderInfos().map((i) => i.provider).sort();
  const baselineProviders = [...baseline.providerAdapterKeys].sort();
  assert.deepEqual(
    live,
    baselineProviders,
    'ProviderAdapterRegistry providers must equal docs/governance/adapter-keys-baseline.json#providerAdapterKeys'
  );
});
