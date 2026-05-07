#!/usr/bin/env node
/**
 * Root-mount baseline gate (Phase A5).
 *
 * Smart Park OS mounts most of its surface on `app.use('/api/v1', v1Router)`
 * but a small set of prefixes are intentionally mounted directly on
 * `src/app.js` (multer-sharing routes, long-running AI ops, pre-MDM CRUD
 * planned for Phase B fold-in, …). The exact list is locked in
 * `docs/governance/root-mount-routes-baseline.json`.
 *
 * What this script does:
 *   1. Re-runs the route inventory (`scripts/list-express-routes.mjs`)
 *      so the gate works against fresh data on every CI run.
 *   2. Reads `express-routes.inventory.json` and finds every route whose
 *      `mountOrigin` is `src/app.js`.
 *   3. Confirms each such route's path matches one of the baseline's
 *      `allowedPrefixes` (or one of the `policy.rootProbes` like `/` and
 *      `/health`).
 *   4. Fails with a human-readable message naming the offending routes
 *      AND naming each previously-allowed prefix that the live app no
 *      longer covers (so the baseline can be pruned).
 *
 * The audit's full A5 vision was to also mirror the duplicate-route gate
 * here so a single CI step has a single owner. That gate already lives in
 * `scripts/check-route-duplicates.mjs` (QW6) and is wired into
 * `governance:ci`; folding the two is a tiny follow-up if the team wants
 * a single command. This script keeps them separate because failure modes
 * are different and the baselines belong to different reviewers.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INVENTORY = path.join(ROOT, 'docs', 'generated', 'express-routes.inventory.json');
const BASELINE = path.join(ROOT, 'docs', 'governance', 'root-mount-routes-baseline.json');

function refreshInventory() {
  const r = spawnSync('node', [path.join('scripts', 'list-express-routes.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error('[check:root-mount-baseline] failed to refresh route inventory:');
    console.error(r.stderr || r.stdout);
    process.exit(2);
  }
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    console.error(`[check:root-mount-baseline] missing file: ${path.relative(ROOT, filePath)}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function matchesPrefix(p, prefix) {
  if (p === prefix) return true;
  return p.startsWith(`${prefix}/`);
}

function main() {
  refreshInventory();
  const baseline = readJson(BASELINE);
  const inventory = readJson(INVENTORY);

  const allowedPrefixes = Array.isArray(baseline.allowedPrefixes) ? baseline.allowedPrefixes : [];
  const rootProbes = Array.isArray(baseline.policy?.rootProbes) ? baseline.policy.rootProbes : [];
  const allKnown = [...rootProbes, ...allowedPrefixes];

  const rootMounted = (inventory.routes || []).filter((r) => r.mountOrigin === 'src/app.js');

  const offenders = [];
  for (const r of rootMounted) {
    const ok = allKnown.some((pre) => matchesPrefix(r.path, pre));
    if (!ok) offenders.push(r);
  }

  // Track which baseline entries actually matched something (for staleness).
  const usedPrefixes = new Set();
  for (const r of rootMounted) {
    for (const pre of allowedPrefixes) {
      if (matchesPrefix(r.path, pre)) usedPrefixes.add(pre);
    }
  }
  const stale = allowedPrefixes.filter((pre) => !usedPrefixes.has(pre));

  if (offenders.length > 0) {
    console.error('[check:root-mount-baseline] FAIL — routes mounted on `src/app.js` outside the baseline:');
    for (const r of offenders) {
      console.error(`  - ${r.method.padEnd(7)} ${r.path}   (mountOrigin=${r.mountOrigin})`);
    }
    console.error('\nIf this mount is intentional:');
    console.error(`  1) Add the prefix to docs/governance/root-mount-routes-baseline.json (\`allowedPrefixes\`).`);
    console.error('  2) Document why under `migrationNotes` (must reference an ADR or a Phase-B/D sunset plan).');
    console.error('If it is NOT intentional, mount the route on `v1Router` instead (Phase B target).');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.warn(
      `[check:root-mount-baseline] OK with ${stale.length} stale baseline entries (no live route uses them — safe to prune):`
    );
    for (const s of stale) console.warn(`  - ${s}`);
    process.exit(0);
  }

  console.log(
    `[check:root-mount-baseline] OK — ${rootMounted.length} routes mounted on \`src/app.js\` all match the baseline (${allowedPrefixes.length} allowed prefixes).`
  );
}

main();
