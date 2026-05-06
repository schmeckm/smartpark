#!/usr/bin/env node
/**
 * Regression gate: fail if any live Express route is undocumented in OpenAPI
 * unless its coarse template key is listed in the governance baseline.
 *
 * Preconditions: run `npm run audit:routes` so docs/generated/express-routes.inventory.json exists.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function normalizePath(p) {
  if (!p || p === '') return '/';
  let x = p.replace(/\/{2,}/g, '/');
  x = x.replace(/\/\?(\/|$)/g, '/');
  if (x.length > 1 && x.endsWith('/')) x = x.slice(0, -1);
  if (!x.startsWith('/')) x = `/${x}`;
  return x;
}

function toTemplateKey(method, pathStr) {
  const p = normalizePath(pathStr)
    .replace(/:[^/]+/g, '{p}')
    .replace(/\{[^}]+\}/g, '{p}');
  return `${method.toUpperCase()} ${p}`;
}

function main() {
  const inventoryPath = path.join(ROOT, 'docs', 'generated', 'express-routes.inventory.json');
  const baselinePath = path.join(ROOT, 'docs', 'governance', 'openapi-undocumented-routes-baseline.json');

  if (!existsSync(inventoryPath)) {
    console.error(`Missing route inventory. Run: npm run audit:routes\n  Expected: ${inventoryPath}`);
    process.exit(1);
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read baseline: ${baselinePath}`, e?.message || e);
    process.exit(1);
  }

  const allowed = new Set(baseline.allowedMissingTemplateKeys || []);
  if (allowed.size === 0) {
    console.error('Baseline has no allowedMissingTemplateKeys.');
    process.exit(1);
  }

  const inv = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const routes = inv.routes || [];
  const undocumentedKeys = new Set();
  for (const r of routes) {
    if (r.inOpenApi) continue;
    undocumentedKeys.add(toTemplateKey(r.method, r.path));
  }

  const unexpected = [...undocumentedKeys].filter((k) => !allowed.has(k));
  const staleAllowlist = [...allowed].filter((k) => !undocumentedKeys.has(k));

  if (unexpected.length) {
    console.error(
      '\nOpenAPI route drift: new undocumented route(s) (not in governance baseline):\n' +
        unexpected.map((k) => `  - ${k}`).join('\n') +
        '\n\nFix: add OpenAPI paths for these operations, or (only if intentionally undocumented long-tail) ' +
        'discuss and extend docs/governance/openapi-undocumented-routes-baseline.json.\n'
    );
    process.exit(1);
  }

  console.log(
    `OpenAPI route drift check OK: ${undocumentedKeys.size} undocumented template key(s) match baseline (${allowed.size} allowlisted; ${staleAllowlist.length} stale allowlist entries — safe to prune when convenient).`
  );
}

main();
