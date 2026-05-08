#!/usr/bin/env node
/**
 * QW6 — Route-duplicate gate (CI / local).
 *
 * Smart Park OS deliberately double-mounts a small handful of routes on both
 * `src/app.js` (root) and `src/routes/v1/index.js` (v1Router) — historically
 * a workaround for body-parsing on proxied POSTs. The list is captured in
 * `docs/governance/express-route-duplicates-baseline.json`.
 *
 * This gate fails when:
 *   1. a *new* duplicate key (not in the baseline) appears, or
 *   2. a baseline duplicate disappears (which means the file is now stale
 *      and must be shrunk on purpose so we can prove the dual-mount surface
 *      is monotonically going down toward the Phase A1 single-mount goal).
 *
 * Runs `scripts/list-express-routes.mjs` first to make sure the duplicates
 * artifact under `docs/generated/` is current.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runNodeScript(relPath, label) {
  const script = path.join(ROOT, relPath);
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (r.status !== 0) {
    console.error(`\n[check:route-duplicates] FAILED: ${label} (${relPath})\n`);
    if (r.stdout) process.stderr.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(1);
  }
}

function main() {
  const baselinePath = path.join(ROOT, 'docs', 'governance', 'express-route-duplicates-baseline.json');
  const generatedPath = path.join(ROOT, 'docs', 'generated', 'express-routes.duplicates.json');

  runNodeScript('scripts/list-express-routes.mjs', 'route inventory + duplicates artifact');

  if (!existsSync(generatedPath)) {
    console.error(`Missing duplicates artifact after audit: ${generatedPath}`);
    process.exit(1);
  }
  if (!existsSync(baselinePath)) {
    console.error(`Missing duplicates baseline: ${baselinePath}`);
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const generated = JSON.parse(readFileSync(generatedPath, 'utf8'));

  const allowed = new Set(baseline.allowedDuplicateKeys || []);
  const maxAllowed =
    typeof baseline.maxAllowedDuplicateCount === 'number' && baseline.maxAllowedDuplicateCount >= 0
      ? baseline.maxAllowedDuplicateCount
      : allowed.size;
  const observed = new Set((generated.duplicates || []).map((d) => d.key));

  const newDuplicates = [...observed].filter((k) => !allowed.has(k)).sort();
  const removedDuplicates = [...allowed].filter((k) => !observed.has(k)).sort();

  let failed = false;

  if (observed.size > maxAllowed) {
    console.error(
      `\n[check:route-duplicates] FAILED: ${observed.size} duplicate (METHOD,path) keys observed, baseline max ${maxAllowed}.`
    );
    failed = true;
  }

  if (newDuplicates.length) {
    console.error(`\n[check:route-duplicates] FAILED: ${newDuplicates.length} new duplicate route registration(s):\n`);
    for (const k of newDuplicates) console.error(`  + ${k}`);
    console.error(
      `\nFix: pick a single mount point (root app.js OR v1Router), or add the key to docs/governance/express-route-duplicates-baseline.json with a justification.`
    );
    failed = true;
  }

  if (removedDuplicates.length) {
    console.error(
      `\n[check:route-duplicates] FAILED: ${removedDuplicates.length} baseline duplicate(s) no longer registered:\n`
    );
    for (const k of removedDuplicates) console.error(`  - ${k}`);
    console.error(
      `\nThe baseline is stale. Remove the keys from docs/governance/express-route-duplicates-baseline.json and lower maxAllowedDuplicateCount to ${observed.size}. This is the path to single-mount routes (Phase A1).`
    );
    failed = true;
  }

  if (failed) process.exit(1);

  console.log(
    `[check:route-duplicates] OK — ${observed.size}/${maxAllowed} duplicate keys, all on baseline allowlist.`
  );
}

main();
