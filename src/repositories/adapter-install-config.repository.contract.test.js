'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  AdapterInstallConfigRepository,
  assertSafeAdapterKey,
  defaultInstallDocument,
  getConfigRootDir,
} = require('./adapter-install-config.repository');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'governance', 'adapter-keys-baseline.json');
const PROD_INSTALL_DIR = path.join(ROOT, 'data', 'adapter-install-config');

function loadBaseline() {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

/**
 * Phase C0/C1 contract tests for the install-config repository (YAML-on-disk
 * adapter install state). These guarantee that every existing
 * `data/adapter-install-config/<key>.install.yaml` is well-formed and that
 * the adapter key is allow-listed by the governance baseline. Phase C2+ may
 * move install-config files into per-package directories — when it does,
 * these tests must follow the move and stay green.
 */

test('install-config: assertSafeAdapterKey accepts production keys and rejects unsafe ones', () => {
  for (const k of ['themeparks_wiki', 'wartezeiten_app', 'opcua_edge', 'a-b_c1']) {
    assert.equal(assertSafeAdapterKey(k), k);
  }
  for (const bad of ['', '   ', '../etc', 'name with spaces', 'name/with/slash']) {
    assert.throws(() => assertSafeAdapterKey(bad), /Invalid adapterKey/);
  }
});

test('install-config: defaultInstallDocument has the locked-in shape', () => {
  const doc = defaultInstallDocument('themeparks_wiki');
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.adapterKey, 'themeparks_wiki');
  assert.equal(typeof doc.installedAt, 'string');
  assert.equal(typeof doc.updatedAt, 'string');
  assert.deepEqual(doc.configJson, {});
  assert.equal(typeof doc.contextJson, 'object');
  assert.ok(Array.isArray(doc.outputProfiles), 'outputProfiles must be an array');
  assert.equal(typeof doc.emitEnabled, 'boolean');
  assert.equal(typeof doc.ingestCanonicalEnabled, 'boolean');
});

test('install-config: every YAML file in data/adapter-install-config/ loads, declares schemaVersion=1, and has a baseline-allowlisted adapterKey', () => {
  if (!fs.existsSync(PROD_INSTALL_DIR)) {
    return; // empty fleets are valid; nothing to lock in
  }

  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.adapterKeys);
  const repo = new AdapterInstallConfigRepository();
  const failures = [];

  const yamlFiles = fs
    .readdirSync(PROD_INSTALL_DIR)
    .filter((f) => f.endsWith('.install.yaml'));

  for (const file of yamlFiles) {
    const expectedKey = file.replace(/\.install\.yaml$/, '');
    if (!baselineSet.has(expectedKey)) {
      failures.push(`${file}: filename-derived adapterKey "${expectedKey}" not in baseline`);
      continue;
    }
    const doc = repo.load(expectedKey);
    if (!doc) {
      failures.push(`${file}: repo.load returned null (parse failure)`);
      continue;
    }
    if (doc.schemaVersion !== 1) {
      failures.push(`${file}: schemaVersion=${doc.schemaVersion}, expected 1`);
    }
    if (doc.adapterKey !== expectedKey) {
      failures.push(`${file}: doc.adapterKey="${doc.adapterKey}" does not match filename "${expectedKey}"`);
    }
    if (doc.outputProfiles != null && !Array.isArray(doc.outputProfiles)) {
      failures.push(`${file}: outputProfiles must be an array (got ${typeof doc.outputProfiles})`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Install-config contract violations:\n  - ${failures.join('\n  - ')}`
  );
});

test('install-config: roundtrip saveFull -> load returns the same document (under a temp ADAPTER_INSTALL_CONFIG_DIR)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-install-config-roundtrip-'));
  const prevEnv = process.env.ADAPTER_INSTALL_CONFIG_DIR;
  process.env.ADAPTER_INSTALL_CONFIG_DIR = tmp;
  try {
    assert.equal(getConfigRootDir(), path.resolve(tmp));
    const repo = new AdapterInstallConfigRepository();
    const written = repo.saveFull('themeparks_wiki', {
      ...defaultInstallDocument('themeparks_wiki'),
      configJson: { parkId: 'abc' },
      outputProfiles: ['UNS_JSON', 'CANONICAL_HISTORIAN'],
      emitEnabled: false,
      scheduleCron: '*/5 * * * *',
    });
    const loaded = repo.load('themeparks_wiki');
    assert.equal(loaded.adapterKey, 'themeparks_wiki');
    assert.deepEqual(loaded.configJson, { parkId: 'abc' });
    assert.deepEqual(loaded.outputProfiles, ['UNS_JSON', 'CANONICAL_HISTORIAN']);
    assert.equal(loaded.scheduleCron, '*/5 * * * *');
    assert.equal(loaded.emitEnabled, false);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(written.adapterKey, 'themeparks_wiki');
  } finally {
    if (prevEnv === undefined) {
      delete process.env.ADAPTER_INSTALL_CONFIG_DIR;
    } else {
      process.env.ADAPTER_INSTALL_CONFIG_DIR = prevEnv;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
