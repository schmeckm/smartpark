#!/usr/bin/env node
/**
 * Phase S.1 — OpenAPI drift gate (CI / local).
 *
 * 1. Parse `src/openapi/openapi.yaml` (structural sanity).
 * 2. Regenerate route inventory + OpenAPI match (`list-express-routes.mjs`).
 * 3. Hard limits from inventory stats:
 *    - `documentedNotLiveCount` must be 0 (no orphaned OpenAPI ops vs live app).
 *    - `missingFromOpenapiCount` must be ≤ `maxAllowedMissingRouteCount` from baseline JSON (default 2).
 * 4. Baseline allowlist: no *new* undocumented template keys beyond
 *    `docs/governance/openapi-undocumented-routes-baseline.json`.
 *
 * Root probes `GET /` and `GET /health` stay out of the `/api/v1` OpenAPI server URL; they are allowlisted
 * so missing count stays at the accepted baseline until the project documents them differently.
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
    console.error(`\n[check:openapi-drift] FAILED: ${label} (${relPath})\n`);
    if (r.stdout) process.stderr.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(1);
  }
  if (r.stdout) process.stdout.write(r.stdout);
}

function main() {
  const baselinePath = path.join(ROOT, 'docs', 'governance', 'openapi-undocumented-routes-baseline.json');
  const inventoryPath = path.join(ROOT, 'docs', 'generated', 'express-routes.inventory.json');

  runNodeScript('scripts/validate-openapi-parse.mjs', 'OpenAPI YAML parse');
  runNodeScript('scripts/list-express-routes.mjs', 'Express route inventory + gap files');

  if (!existsSync(inventoryPath)) {
    console.error(`Missing inventory after audit: ${inventoryPath}`);
    process.exit(1);
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read baseline: ${baselinePath}`, e?.message || e);
    process.exit(1);
  }

  const maxMissing =
    typeof baseline.maxAllowedMissingRouteCount === 'number' && baseline.maxAllowedMissingRouteCount >= 0
      ? baseline.maxAllowedMissingRouteCount
      : 2;

  const inv = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const stats = inv.stats || {};
  const missing = Number(stats.missingFromOpenapiCount);
  const orphans = Number(stats.documentedNotLiveCount);

  if (Number.isNaN(orphans) || orphans > 0) {
    console.error(
      `\n[check:openapi-drift] FAILED: ${orphans} OpenAPI operation(s) have no matching live route (orphans).\n` +
        `Remove stale paths from src/openapi/openapi.yaml or restore the Express route. See docs/generated/openapi-gap-report.md\n`
    );
    process.exit(1);
  }

  if (Number.isNaN(missing) || missing > maxMissing) {
    console.error(
      `\n[check:openapi-drift] FAILED: ${missing} live route(s) missing from OpenAPI (max allowed: ${maxMissing}).\n` +
        `Document new routes in src/openapi/openapi.yaml, or raise max only with explicit governance review.\n`
    );
    process.exit(1);
  }

  runNodeScript('scripts/check-openapi-route-drift.mjs', 'Undocumented-route baseline allowlist');

  console.log(
    `\n[check:openapi-drift] OK — parse + inventory + limits (missing≤${maxMissing}, orphans=0) + allowlist.\n`
  );
}

main();
