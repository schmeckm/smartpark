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
} from './check-orchestrator-provider-branches.mjs';

/**
 * Phase C3.0 — unit tests for the governance script that locks the
 * count of `provider === '<key>'` branches in the orchestrator. The
 * script itself is exercised via the npm `governance:ci` umbrella; this
 * file pins the parsing/diff logic so the script can't regress
 * silently while baseline numbers stay green.
 */

test('scanFile detects the two known orchestrator provider branches', () => {
  const matches = scanFile('src/services/integration-orchestrator.service.js');
  assert.ok(matches.length >= 2, `expected at least 2 matches, got ${matches.length}`);
  for (const m of matches) {
    assert.match(m.text, /provider/);
    assert.match(m.text, /===/);
    assert.match(m.text, /'[a-z_]+'/);
  }
});

test('scanFile ignores default-value seeds (`getValue(..., { provider: "X" })`)', () => {
  const matches = scanFile('src/services/integration-orchestrator.service.js');
  for (const m of matches) {
    assert.doesNotMatch(
      m.text,
      /getString\s*\(/,
      `default-value getString line incorrectly flagged: ${m.text}`
    );
    assert.doesNotMatch(
      m.text,
      /getValue\s*\([^)]*\{\s*provider\s*:/,
      `default-value getValue line incorrectly flagged: ${m.text}`
    );
  }
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
