import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBaseline, scanPackagesDir, diffBaselineAgainstDisk } from './check-adapter-keys-baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROD_BASELINE = path.join(ROOT, 'docs', 'governance', 'adapter-keys-baseline.json');
const PROD_PACKAGES = path.join(ROOT, 'src', 'integrations', 'adapter-packages');

test('check-adapter-keys-baseline: production state is on the baseline', () => {
  const baseline = loadBaseline(PROD_BASELINE);
  const scan = scanPackagesDir(PROD_PACKAGES);
  const { failures, counts } = diffBaselineAgainstDisk(baseline, scan);
  assert.equal(
    failures.length,
    0,
    `Production state must match the baseline:\n  - ${failures.join('\n  - ')}`
  );
  assert.equal(counts.onDisk, counts.baseline, 'on-disk and baseline must have identical cardinality');
});

test('check-adapter-keys-baseline: detects undocumented package on disk', () => {
  const baseline = { adapterKeys: ['themeparks_wiki'] };
  const scan = [
    { dirName: 'themeparks_wiki', packageDir: '', manifest: { adapterKey: 'themeparks_wiki' }, manifestError: null },
    { dirName: 'rogue_adapter', packageDir: '', manifest: { adapterKey: 'rogue_adapter' }, manifestError: null },
  ];
  const { failures } = diffBaselineAgainstDisk(baseline, scan);
  assert.ok(
    failures.some((f) => f.includes('rogue_adapter') && f.includes('not in the baseline')),
    `expected baseline-allowlist failure, got:\n${failures.join('\n')}`
  );
});

test('check-adapter-keys-baseline: detects baseline entry with no directory', () => {
  const baseline = { adapterKeys: ['themeparks_wiki', 'ghost_adapter'] };
  const scan = [
    { dirName: 'themeparks_wiki', packageDir: '', manifest: { adapterKey: 'themeparks_wiki' }, manifestError: null },
  ];
  const { failures } = diffBaselineAgainstDisk(baseline, scan);
  assert.ok(
    failures.some((f) => f.includes('ghost_adapter') && f.includes('no package directory found')),
    `expected missing-directory failure, got:\n${failures.join('\n')}`
  );
});

test('check-adapter-keys-baseline: detects manifest.adapterKey vs directory mismatch', () => {
  const baseline = { adapterKeys: ['themeparks_wiki'] };
  const scan = [
    {
      dirName: 'themeparks_wiki',
      packageDir: '',
      manifest: { adapterKey: 'themeparks_wiki_v2' },
      manifestError: null,
    },
  ];
  const { failures } = diffBaselineAgainstDisk(baseline, scan);
  assert.ok(
    failures.some((f) => f.includes('does not match directory name')),
    `expected directory-name mismatch failure, got:\n${failures.join('\n')}`
  );
});

test('check-adapter-keys-baseline: scanPackagesDir works on a synthetic temp dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-keys-baseline-'));
  try {
    const pkgA = path.join(tmp, 'alpha');
    fs.mkdirSync(pkgA);
    fs.writeFileSync(path.join(pkgA, 'manifest.json'), JSON.stringify({ adapterKey: 'alpha' }));
    const pkgB = path.join(tmp, 'beta');
    fs.mkdirSync(pkgB);
    fs.writeFileSync(path.join(pkgB, 'manifest.json'), '{ not valid json');
    const pkgC = path.join(tmp, 'no_manifest');
    fs.mkdirSync(pkgC);

    const scan = scanPackagesDir(tmp);
    const byDir = Object.fromEntries(scan.map((s) => [s.dirName, s]));
    assert.deepEqual(byDir.alpha?.manifest, { adapterKey: 'alpha' });
    assert.equal(byDir.beta?.manifest, null);
    assert.ok(byDir.beta?.manifestError, 'malformed manifest must surface manifestError');
    assert.equal(byDir.no_manifest, undefined, 'directories without manifest.json must be skipped');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('check-adapter-keys-baseline: baseline JSON file structure is valid', () => {
  const baseline = loadBaseline(PROD_BASELINE);
  assert.ok(Array.isArray(baseline.adapterKeys) && baseline.adapterKeys.length > 0, 'adapterKeys must be a non-empty array');
  assert.ok(Array.isArray(baseline.providerAdapterKeys), 'providerAdapterKeys must be an array');
  assert.ok(typeof baseline.referencesByKey === 'object' && baseline.referencesByKey, 'referencesByKey must be an object');
  for (const key of baseline.adapterKeys) {
    assert.ok(baseline.referencesByKey[key], `referencesByKey must list every adapterKey; missing: ${key}`);
    assert.ok(
      typeof baseline.referencesByKey[key].manifest === 'string',
      `referencesByKey.${key}.manifest must be a path string`
    );
    assert.ok(
      typeof baseline.referencesByKey[key].runtime === 'string',
      `referencesByKey.${key}.runtime must be a path string`
    );
  }
  for (const key of baseline.providerAdapterKeys) {
    assert.ok(
      baseline.adapterKeys.includes(key),
      `providerAdapterKeys must be a subset of adapterKeys; offender: ${key}`
    );
  }
});
