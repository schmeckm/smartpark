#!/usr/bin/env node
/**
 * Phase C3 orchestrator-decomposition governance gate.
 *
 * Scans the integration orchestrator surface for hard-coded
 * `provider === '<key>'` control-flow branches and asserts the set
 * matches the baseline at
 *   docs/governance/orchestrator-provider-branches-baseline.json
 *
 * Scan scope (Phase C3.9):
 *   - the legacy facade: src/services/integration-orchestrator.service.js
 *   - every *.js file under src/modules/integrations/orchestrator/
 *     (excluding *.test.js)
 *
 * The discovery is automatic — adding a new orchestrator-context module
 * is enough to put it under the gate. New `provider === '<key>'` checks
 * MUST go through a post-ingest hook in the adapter package instead
 * (see src/modules/integrations/orchestrator/canonical-ingestion-hooks.js).
 *
 * The pattern flagged is:
 *   /provider[^=]*===\s*'[a-z_]+'/i
 *
 * Default-value uses such as `getValue(...selectedProvider..., { provider: 'X' })`
 * and `getString(..., 'X')` are NOT flagged because they don't contain
 * the `===` token.
 *
 * Exit codes:
 *   0  baseline matches scan
 *   1  baseline drift (count or set of matches differs)
 *   2  baseline file or scan target missing / unreadable
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const BASELINE_PATH = path.join(
  REPO_ROOT,
  'docs',
  'governance',
  'orchestrator-provider-branches-baseline.json'
);

const PROVIDER_BRANCH_PATTERN = /provider[^=]*===\s*'[a-z_][a-z0-9_]*'/i;

/**
 * @typedef {{ file: string, line: number, text: string, context?: string }} BranchMatch
 */

/**
 * Read a file relative to the repo root and split it into trimmed lines.
 * @param {string} relPath
 * @returns {string[]}
 */
function readLines(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  const raw = fs.readFileSync(abs, 'utf8');
  return raw.split(/\r?\n/);
}

/**
 * Scan a single file and return every line that contains a
 * `provider === '<key>'` control-flow branch.
 *
 * @param {string} relPath
 * @returns {BranchMatch[]}
 */
export function scanFile(relPath) {
  const lines = readLines(relPath);
  /** @type {BranchMatch[]} */
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (!PROVIDER_BRANCH_PATTERN.test(text)) continue;
    out.push({
      file: relPath,
      line: i + 1,
      text: text.trim(),
    });
  }
  return out;
}

/**
 * Static legacy entry point still scanned for backward compatibility.
 */
const LEGACY_FACADE = 'src/services/integration-orchestrator.service.js';

/**
 * Directory holding all extracted orchestrator-context services.
 * Every *.js file in here is auto-discovered and scanned.
 */
const ORCHESTRATOR_MODULES_DIR = 'src/modules/integrations/orchestrator';

/**
 * Auto-discover the canonical scan target list.
 *
 * @returns {string[]} relative-to-repo file paths
 */
export function discoverScanTargets() {
  /** @type {string[]} */
  const out = [];
  if (fs.existsSync(path.join(REPO_ROOT, LEGACY_FACADE))) {
    out.push(LEGACY_FACADE);
  }
  const dir = path.join(REPO_ROOT, ORCHESTRATOR_MODULES_DIR);
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.js')) continue;
      if (entry.endsWith('.test.js')) continue;
      out.push(path.posix.join(ORCHESTRATOR_MODULES_DIR, entry));
    }
  }
  return out.sort();
}

/**
 * Scan every file in the discovered surface and return the union.
 *
 * The baseline's `scannedFiles` is used only for diagnostics — the
 * actual scan target list is computed at runtime so that adding a new
 * orchestrator module automatically falls under the gate.
 *
 * @param {{ scannedFiles?: string[] }} _baseline
 * @returns {BranchMatch[]}
 */
export function scanBaselineFiles(_baseline) {
  const targets = discoverScanTargets();
  /** @type {BranchMatch[]} */
  const out = [];
  for (const f of targets) {
    out.push(...scanFile(f));
  }
  return out;
}

/**
 * Compare the current scan against the baseline.
 *
 * @param {BranchMatch[]} current
 * @param {{ matches: BranchMatch[] }} baseline
 * @returns {{ ok: boolean, added: BranchMatch[], removed: BranchMatch[] }}
 */
export function diffAgainstBaseline(current, baseline) {
  const baselineKeys = new Set(
    (baseline.matches || []).map((m) => `${m.file}:${m.line}:${m.text}`)
  );
  const currentKeys = new Set(current.map((m) => `${m.file}:${m.line}:${m.text}`));
  const added = current.filter((m) => !baselineKeys.has(`${m.file}:${m.line}:${m.text}`));
  const removed = (baseline.matches || []).filter(
    (m) => !currentKeys.has(`${m.file}:${m.line}:${m.text}`)
  );
  return { ok: added.length === 0 && removed.length === 0, added, removed };
}

/**
 * Read and parse the baseline JSON.
 *
 * @returns {{ scannedFiles: string[], matches: BranchMatch[], matchCount: number }}
 */
export function loadBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(raw);
}

function main() {
  let baseline;
  try {
    baseline = loadBaseline();
  } catch (e) {
    console.error(
      `[check:orchestrator-provider-branches] FAIL — cannot read baseline at ${BASELINE_PATH}: ${e.message}`
    );
    process.exit(2);
  }

  let current;
  try {
    current = scanBaselineFiles(baseline);
  } catch (e) {
    console.error(
      `[check:orchestrator-provider-branches] FAIL — cannot scan baseline files: ${e.message}`
    );
    process.exit(2);
  }

  const targets = discoverScanTargets();
  const { ok, added, removed } = diffAgainstBaseline(current, baseline);
  if (ok) {
    if (current.length === 0) {
      console.log(
        `[check:orchestrator-provider-branches] OK — 0 provider control-flow branches in ` +
          `${targets.length} auto-discovered file(s) (Phase C3.7+: post-ingest ` +
          `hook registry replaces the legacy hard-coded branches).`
      );
    } else {
      console.log(
        `[check:orchestrator-provider-branches] OK — ${current.length}/${current.length} ` +
          `provider control-flow branches match the baseline (${targets.length} scanned file(s)).`
      );
    }
    process.exit(0);
  }

  console.error('[check:orchestrator-provider-branches] FAIL — baseline drift detected.');
  if (added.length) {
    console.error('  + new branches not in baseline:');
    for (const m of added) {
      console.error(`      ${m.file}:${m.line}  ${m.text}`);
    }
    console.error(
      '    Each new branch is a hard-coded `provider === \'<key>\'` check. The C3 plan ' +
        'forbids these in core code; use a post-ingest hook in the adapter package instead.'
    );
  }
  if (removed.length) {
    console.error('  - branches in baseline that are no longer present in code:');
    for (const m of removed) {
      console.error(`      ${m.file}:${m.line}  ${m.text}`);
    }
    console.error(
      '    If you intentionally removed a branch (e.g. C3.7 hook migration), ' +
        'update docs/governance/orchestrator-provider-branches-baseline.json to reflect the new state.'
    );
  }
  process.exit(1);
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
