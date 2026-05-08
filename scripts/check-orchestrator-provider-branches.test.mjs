import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  scanFile,
  scanBaselineFiles,
  diffAgainstBaseline,
  loadBaseline,
  discoverScanTargets,
} from './check-orchestrator-provider-branches.mjs';

/**
 * Unit tests for the governance script that locks the count of
 * `provider === '<key>'` branches across the orchestrator surface.
 * The script itself is exercised via the npm `governance:ci` umbrella;
 * this file pins the parsing/diff logic so the script can't regress
 * silently while baseline numbers stay green.
 *
 * Phase history:
 *   - C3.0: orchestrator had 2 branches; baseline pinned both.
 *   - C3.7: hooks registry replaces the branches; baseline is empty.
 *           Tests below assert the orchestrator and pipeline service
 *           are now branch-free.
 *   - C3.9: scan target list is auto-discovered. Adding a new file
 *           under `src/modules/integrations/orchestrator/` puts it
 *           under the gate without baseline edits.
 */

test('scanFile: the integration orchestrator has zero provider-branches (post-C3.7)', () => {
  const matches = scanFile('src/services/integration-orchestrator.service.js');
  assert.equal(
    matches.length,
    0,
    'the orchestrator must NOT contain `provider === \'<key>\'` branches after C3.7. ' +
      'Use a post-ingest hook in the adapter module instead. ' +
      `Found: ${JSON.stringify(matches, null, 2)}`
  );
});

test('scanFile: the canonical-ingestion pipeline has zero provider-branches (post-C3.7)', () => {
  const matches = scanFile(
    'src/modules/integrations/orchestrator/canonical-ingestion-pipeline.service.js'
  );
  assert.equal(
    matches.length,
    0,
    'the ingestion pipeline must NOT contain `provider === \'<key>\'` branches. ' +
      'Use a post-ingest hook in the adapter module instead. ' +
      `Found: ${JSON.stringify(matches, null, 2)}`
  );
});

test('discoverScanTargets: includes the legacy facade and every orchestrator module', () => {
  const targets = discoverScanTargets();
  assert.ok(
    targets.includes('src/services/integration-orchestrator.service.js'),
    'must include the legacy facade'
  );
  assert.ok(
    targets.some((t) => t.startsWith('src/modules/integrations/orchestrator/') && t.endsWith('.js')),
    'must include at least one orchestrator module'
  );
  for (const t of targets) {
    assert.ok(!t.endsWith('.test.js'), `discovered target ${t} must not be a test file`);
  }
});

test('discoverScanTargets: every discovered file is branch-free (the C3.9 gate)', () => {
  const targets = discoverScanTargets();
  const hits = [];
  for (const t of targets) {
    hits.push(...scanFile(t));
  }
  assert.equal(
    hits.length,
    0,
    [
      'C3.9 gate failed: a hard-coded `provider === \'<key>\'` branch was found in an',
      'orchestrator-context module. Provider-specific work must run through a post-ingest',
      'hook (canonical-ingestion-hooks.js). Offending lines:',
      JSON.stringify(hits, null, 2),
    ].join('\n')
  );
});

test('loadBaseline returns a parseable JSON document', () => {
  const baseline = loadBaseline();
  assert.equal(typeof baseline, 'object');
  assert.ok(Array.isArray(baseline.scannedFiles), 'baseline.scannedFiles must be array');
  assert.ok(Array.isArray(baseline.matches), 'baseline.matches must be array');
  assert.equal(typeof baseline.matchCount, 'number');
});

test('baseline matchCount equals baseline.matches.length', () => {
  const baseline = loadBaseline();
  assert.equal(
    baseline.matchCount,
    baseline.matches.length,
    'matchCount and matches.length must agree — keep the baseline self-consistent'
  );
});

test('current scan exactly matches the baseline (the actual gate)', () => {
  const baseline = loadBaseline();
  const current = scanBaselineFiles(baseline);
  const { ok, added, removed } = diffAgainstBaseline(current, baseline);
  assert.equal(
    ok,
    true,
    [
      'orchestrator provider-branch baseline drifted.',
      'added: ' + JSON.stringify(added, null, 2),
      'removed: ' + JSON.stringify(removed, null, 2),
    ].join('\n')
  );
});

test('diffAgainstBaseline flags added branches', () => {
  const baseline = { scannedFiles: [], matches: [] };
  const current = [
    { file: 'X.js', line: 10, text: "if (provider === 'foo')" },
  ];
  const { ok, added, removed } = diffAgainstBaseline(current, baseline);
  assert.equal(ok, false);
  assert.equal(added.length, 1);
  assert.equal(removed.length, 0);
});

test('diffAgainstBaseline flags removed branches', () => {
  const baseline = {
    scannedFiles: [],
    matches: [{ file: 'X.js', line: 10, text: "if (provider === 'foo')" }],
  };
  const current = [];
  const { ok, added, removed } = diffAgainstBaseline(current, baseline);
  assert.equal(ok, false);
  assert.equal(added.length, 0);
  assert.equal(removed.length, 1);
});

test('diffAgainstBaseline accepts an exact match', () => {
  const baseline = {
    scannedFiles: [],
    matches: [{ file: 'X.js', line: 10, text: "if (provider === 'foo')" }],
  };
  const current = [{ file: 'X.js', line: 10, text: "if (provider === 'foo')" }];
  const { ok, added, removed } = diffAgainstBaseline(current, baseline);
  assert.equal(ok, true);
  assert.equal(added.length, 0);
  assert.equal(removed.length, 0);
});

test('scanFile against a tmp file with synthetic branches captures every variant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-orch-test-'));
  const rel = path.join('docs', 'tmp', 'fake-tmp-orch.js');
  const abs = path.join(dir, 'fake.js');
  fs.writeFileSync(
    abs,
    [
      "if (provider === 'simple') {}",
      "if (String(selected.provider).toLowerCase() === 'lower') {}",
      "const default1 = getString('K', 'themeparks_wiki');",
      "const default2 = getValue(K, { provider: 'themeparks_wiki' });",
      "switch (true) { case provider === 'cased': break; }",
      "// nothing here",
    ].join('\n'),
    'utf8'
  );

  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const re = /provider[^=]*===\s*'[a-z_][a-z0-9_]*'/i;
  const hits = lines
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter((m) => re.test(m.text));

  assert.equal(hits.length, 3, `expected 3 control-flow hits, got ${hits.length}: ${JSON.stringify(hits)}`);
  for (const h of hits) {
    assert.doesNotMatch(h.text, /getString/, 'getString line must not match');
    assert.doesNotMatch(h.text, /getValue/, 'getValue line must not match');
  }

  fs.rmSync(dir, { recursive: true, force: true });
});
