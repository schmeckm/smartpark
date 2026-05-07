#!/usr/bin/env node
/**
 * Static + runtime Express route inventory for architecture audits.
 * Does not start the HTTP server. Loads `src/app.js` (may initialize Sequelize config; no DB queries required).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yamljs');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

process.chdir(ROOT);

const API_PREFIX = '/api/v1';

/** Prefixes mounted on `app` in `src/app.js` before `app.use('/api/v1', v1Router)` (and root `/`, `/health`). */
const APP_JS_DIRECT_PREFIXES = [
  '/health',
  '/',
  `${API_PREFIX}/ai/forecasts/refresh`,
  `${API_PREFIX}/ai/feature-store/park-snapshots/bulk-delete`,
  `${API_PREFIX}/ai/feature-store/park-snapshots/purge`,
  `${API_PREFIX}/integrations/installed-adapters/install-local`,
  `${API_PREFIX}/integrations/adapters/install-local`,
  `${API_PREFIX}/integrations/installed-adapters`,
  `${API_PREFIX}/integrations/adapters/packages`,
  `${API_PREFIX}/integrations/adapters/pipeline-log`,
  `${API_PREFIX}/master-data`,
  `${API_PREFIX}/staff`,
  `${API_PREFIX}/visit-plans`,
  `${API_PREFIX}/visit-actuals`,
  `${API_PREFIX}/adapters`,
];

function isAppJsDirectMount(fullPath) {
  const p = normalizePath(fullPath);
  if (p === '/health' || p === '/') return true;
  return APP_JS_DIRECT_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

function isV1RouterMount(fullPath) {
  const p = normalizePath(fullPath);
  if (!p.startsWith(API_PREFIX)) return false;
  return !isAppJsDirectMount(p);
}

function normalizePath(p) {
  if (!p || p === '') return '/';
  let x = p.replace(/\/{2,}/g, '/');
  // Optional trailing slash from Express regexp mounts: `/visit-actuals/?` → `/visit-actuals`
  x = x.replace(/\/\?(\/|$)/g, '/');
  if (x.length > 1 && x.endsWith('/')) x = x.slice(0, -1);
  if (!x.startsWith('/')) x = `/${x}`;
  return x;
}

function joinBase(base, segment) {
  const b = normalizePath(base);
  if (!segment || segment === '/') return b;
  const s = String(segment);
  if (s.startsWith('/')) return normalizePath(b + s);
  return normalizePath(`${b}/${s}`);
}

/**
 * When `app.use('/path', router)` is combined with other middleware, Express may leave `layer.path` undefined
 * and only set `layer.regexp` (e.g. /^\\/api\\/v1\\/visit-actuals\\/?(?=\\/|$)/i).
 */
function mountPathFromLayer(layer) {
  if (layer.path != null && layer.path !== '') return layer.path;
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  const src = layer.regexp.source;
  if (src === '^\\/$' || src === '^\\/\\?(?=\\/|$)') return '/';
  let s = src.replace(/^\^/, '').replace(/\/?\(\?=\\\/\|\$\)\??\$?$/i, '').replace(/\$$/, '');
  s = s.replace(/\\\//g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

/**
 * @param {import('express').Application} app
 * @returns {{ method: string, path: string, mountOrigin: string, sourceHint: string }[]}
 */
function collectRoutes(app) {
  /** @type {{ method: string, path: string, mountOrigin: string, sourceHint: string }[]} */
  const out = [];
  /**
   * @param {import('express').Router['stack']} stack
   * @param {string} basePath
   * @param {string} mountOriginHint - 'app' | 'v1' for stack entered via app vs v1Router
   */
  function walk(stack, basePath, mountOriginHint) {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        const full = joinBase(basePath, layer.route.path);
        const normalized = normalizePath(full);
        const mountOrigin =
          mountOriginHint === 'app' || isAppJsDirectMount(normalized) ? 'src/app.js' : 'src/routes/v1/index.js';
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m]) {
            out.push({
              method: m.toUpperCase(),
              path: normalized,
              mountOrigin,
              sourceHint: 'express.Router stack',
            });
          }
        }
      } else if (layer.handle?.stack && typeof layer.handle === 'function') {
        // Sub-routers are not always `layer.name === 'router'` (often `bound dispatch`).
        const mount = mountPathFromLayer(layer);
        const joined = joinBase(basePath, mount);
        let nextHint = mountOriginHint;
        if (joined === API_PREFIX || joined.startsWith(`${API_PREFIX}/`)) {
          if (isAppJsDirectMount(joined)) nextHint = 'app';
          else nextHint = 'v1';
        }
        walk(layer.handle.stack, joined, nextHint);
      }
    }
  }
  walk(app._router?.stack || [], '', 'app');
  return out;
}

/**
 * Find routes registered more than once at the same `(METHOD, path)` key after
 * normalization. The Express stack is allowed to attach the same handler at
 * the same path twice (e.g. via root `app.js` and `v1Router`), so this scan
 * runs against the raw — pre-dedupe — collected list.
 *
 * @param {{ method: string, path: string, mountOrigin: string, sourceHint: string }[]} rawRows
 */
function findDuplicateRegistrations(rawRows) {
  const byKey = new Map();
  for (const r of rawRows) {
    const k = `${r.method} ${r.path}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const dups = [];
  for (const [key, rows] of byKey.entries()) {
    if (rows.length < 2) continue;
    const origins = [...new Set(rows.map((r) => r.mountOrigin))].sort();
    dups.push({
      key,
      method: rows[0].method,
      path: rows[0].path,
      registrationCount: rows.length,
      mountOrigins: origins,
    });
  }
  return dups.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Routes walked under `v1Router` omit the `/api/v1` prefix in Express layer paths; re-attach for inventory.
 * @param {{ method: string, path: string, mountOrigin: string, sourceHint: string }[]} rows
 */
function applyV1Prefix(rows) {
  return rows
    .map((r) => {
      let p = normalizePath(r.path);
      if (r.mountOrigin === 'src/routes/v1/index.js' && p !== '/health' && p !== '/' && !p.startsWith(API_PREFIX)) {
        p = normalizePath(joinBase(API_PREFIX, p));
      }
      const mountOrigin =
        p === '/health' || p === '/'
          ? 'src/app.js'
          : isAppJsDirectMount(p)
            ? 'src/app.js'
            : 'src/routes/v1/index.js';
      return { ...r, path: p, mountOrigin };
    })
    .filter((r) => !(r.method === 'POST' && r.path === '/'));
}

function dedupeRoutes(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.method} ${r.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/**
 * @param {string} method
 * @param {string} path
 */
function toTemplateKey(method, path) {
  const p = normalizePath(path)
    .replace(/:[^/]+/g, '{p}')
    .replace(/\{[^}]+\}/g, '{p}');
  return `${method.toUpperCase()} ${p}`;
}

function loadOpenApiOperations() {
  const yamlPath = path.join(ROOT, 'src', 'openapi', 'openapi.yaml');
  const doc = YAML.load(yamlPath);
  const keys = new Set();
  /** @type {string[]} */
  const raw = [];
  const paths = doc.paths || {};
  for (const [p, methods] of Object.entries(paths)) {
    const pathNorm = p.startsWith('/') ? p : `/${p}`;
    for (const [method, spec] of Object.entries(methods)) {
      const m = method.toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(m)) continue;
      const full = normalizePath(`${API_PREFIX}${pathNorm}`);
      const key = toTemplateKey(m, full);
      keys.add(key);
      raw.push(`${m.toUpperCase()} ${full}`);
    }
  }
  return { keys, raw };
}

function documentedInOpenApi(keys, method, path) {
  return keys.has(toTemplateKey(method, path));
}

function buildGapMarkdown({ routes, openapiKeys, missingInOpenapi, documentedNotLive }) {
  const lines = [];
  lines.push('# OpenAPI gap report (generated)');
  lines.push('');
  lines.push(`Generated by \`npm run audit:routes\` / \`scripts/list-express-routes.mjs\`.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------:|`);
  lines.push(`| Routes detected (Express, deduped) | ${routes.length} |`);
  lines.push(`| OpenAPI operations (method + path template) | ${openapiKeys.size} |`);
  lines.push(`| Live routes **missing** from OpenAPI (heuristic) | ${missingInOpenapi.length} |`);
  lines.push(`| OpenAPI operations **not** found on live app (heuristic) | ${documentedNotLive.length} |`);
  lines.push('');
  lines.push('> Matching uses template keys: `:param` and `{param}` segments are normalized to `{p}`.');
  lines.push('> Some gaps are false positives (multiple Express paths collapsing to one template, or middleware-only stacks).');
  lines.push(
    '> A count of **0** “OpenAPI not on live app” usually means every documented path template is matched by *some* live route with the same coarse template — not that every operation is uniquely verified.'
  );
  lines.push('');
  lines.push('## Highlight families (manual review)');
  lines.push('');
  lines.push('- **`/sqdc/*`** — verify each SQDC asset/park path is documented for admin clients.');
  lines.push('- **`/incidents/*`** — incident list/create/detail; RBAC and filters.');
  lines.push('- **`/admin/platform-settings/*`** — often under-documented; confirm schemas.');
  lines.push('- **`/visit-plans/*`** and **`/visit-actuals/*`** — mounted on **root `app.js`** (not only `v1Router`); OpenAPI may omit if paths were assumed nested only under `v1Router`.');
  lines.push('- **`/adapters/*`** — operations center; compare to OpenAPI Integrations/Adapters sections.');
  lines.push('- **Direct `app.js` mounts** under `/api/v1/...` that bypass `v1Router` — listed in script as `src/app.js`; ensure OpenAPI includes AI feature-store bulk ops, integrations install-local, adapter package asset GET, pipeline-log.');
  lines.push('- **`/integrations/*`** (inside `v1Router`) and **`/ai/*`** — large families; spot-check high-traffic routes.');
  lines.push('');
  lines.push('## Isolated / separate codebases');
  lines.push('');
  lines.push('- **`tp-uns-mvp`** (if present in the workspace) — treat as a separate lab / MVP tree; not merged into this Express inventory unless mounted by this `app.js`.');
  lines.push('');
  lines.push('## Live routes missing from OpenAPI (sample)');
  lines.push('');
  if (!missingInOpenapi.length) {
    lines.push('_None detected with current template matching._');
  } else {
    lines.push('| Method | Path | Mount origin |');
    lines.push('|--------|------|----------------|');
    for (const r of missingInOpenapi.slice(0, 200)) {
      lines.push(`| ${r.method} | \`${r.path}\` | ${r.mountOrigin} |`);
    }
    if (missingInOpenapi.length > 200) {
      lines.push('');
      lines.push(`_…and ${missingInOpenapi.length - 200} more (see \`express-routes.inventory.json\`)._`);
    }
  }
  lines.push('');
  lines.push('## OpenAPI operations not matched to live routes (sample)');
  lines.push('');
  if (!documentedNotLive.length) {
    lines.push('_None detected._');
  } else {
    lines.push('| Template key |');
  lines.push('|--------------|');
    for (const k of documentedNotLive.slice(0, 120)) {
      lines.push(`| \`${k}\` |`);
    }
    if (documentedNotLive.length > 120) {
      lines.push('');
      lines.push(`_…and ${documentedNotLive.length - 120} more._`);
    }
  }
  lines.push('');
  lines.push('## Next refactor suggestions (architecture)');
  lines.push('');
  lines.push('1. **Single mount strategy** — prefer `v1Router` for all `/api/v1/*` or document why root `app.js` duplicates routes (proxy POST body issues).');
  lines.push('2. **OpenAPI as contract** — add missing paths or mark internal routes as `x-internal` if intentionally undocumented.');
  lines.push('3. **Operations Facts layer** — implement `src/services/operations/operations-facts.service.js` and migrate Add-on Board, SQDC, timeseries, and ML bridges per `docs/architecture/operations-facts-layer.md` (when added).');
  lines.push('4. **Master data** — reconcile legacy `/zones`/`/rides` vs platform `/parks`/`/assets` vs MDM; document deprecation in OpenAPI descriptions.');
  lines.push('');
  return lines.join('\n');
}

function printTable(rows) {
  const cols = ['method', 'path', 'mountOrigin', 'inOpenApi'];
  const W = { method: 8, path: 52, mountOrigin: 28, inOpenApi: 10 };
  const trunc = (s, n) => (String(s).length <= n ? String(s) : String(s).slice(0, n - 1) + '…');
  const header = `| ${cols.map((c) => c.padEnd(W[c])).join(' | ')} |`;
  const sep = `|${cols.map((c) => '-'.repeat(W[c] + 2)).join('|')}|`;
  console.log(header);
  console.log(sep);
  for (const r of rows.slice(0, 400)) {
    const line = `| ${trunc(r.method, W.method).padEnd(W.method)} | ${trunc(r.path, W.path).padEnd(W.path)} | ${trunc(r.mountOrigin, W.mountOrigin).padEnd(W.mountOrigin)} | ${String(r.inOpenApi).padEnd(W.inOpenApi)} |`;
    console.log(line);
  }
  if (rows.length > 400) {
    console.log(`\n… ${rows.length - 400} more rows (see docs/generated/express-routes.inventory.md)\n`);
  }
}

async function main() {
  const { app } = require(path.join(ROOT, 'src', 'app.js'));
  const rawCollected = applyV1Prefix(collectRoutes(app));
  const duplicates = findDuplicateRegistrations(rawCollected);
  const rawRoutes = dedupeRoutes(rawCollected);
  const { keys: openapiKeys } = loadOpenApiOperations();

  const inventory = rawRoutes.map((r) => ({
    ...r,
    inOpenApi: documentedInOpenApi(openapiKeys, r.method, r.path),
  }));

  const missingInOpenapi = inventory.filter((r) => !r.inOpenApi);
  const liveKeys = new Set(inventory.map((r) => toTemplateKey(r.method, r.path)));
  const documentedNotLive = [...openapiKeys].filter((k) => !liveKeys.has(k));

  const outDir = path.join(ROOT, 'docs', 'generated');
  mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'express-routes.inventory.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiPrefix: API_PREFIX,
        routeCount: inventory.length,
        routes: inventory,
        stats: {
          missingFromOpenapiCount: missingInOpenapi.length,
          openapiOperationCount: openapiKeys.size,
          documentedNotLiveCount: documentedNotLive.length,
        },
      },
      null,
      2
    ),
    'utf8'
  );

  const mdLines = [];
  mdLines.push('# Express route inventory (generated)');
  mdLines.push('');
  mdLines.push(`- **Generated:** ${new Date().toISOString()}`);
  mdLines.push(`- **Route count:** ${inventory.length}`);
  mdLines.push('');
  mdLines.push('| Method | Path | Mount origin | In OpenAPI |');
  mdLines.push('|--------|------|--------------|------------|');
  for (const r of inventory) {
    mdLines.push(`| ${r.method} | \`${r.path}\` | ${r.mountOrigin} | ${r.inOpenApi ? 'yes' : 'no'} |`);
  }
  writeFileSync(path.join(outDir, 'express-routes.inventory.md'), mdLines.join('\n'), 'utf8');

  const gapMd = buildGapMarkdown({
    routes: inventory,
    openapiKeys,
    missingInOpenapi,
    documentedNotLive,
  });
  writeFileSync(path.join(outDir, 'openapi-gap-report.md'), gapMd, 'utf8');

  const duplicatesPath = path.join(outDir, 'express-routes.duplicates.json');
  writeFileSync(
    duplicatesPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        apiPrefix: API_PREFIX,
        duplicateKeyCount: duplicates.length,
        duplicates,
      },
      null,
      2
    ),
    'utf8'
  );

  printTable(inventory);
  console.log(`\nWrote ${path.relative(ROOT, jsonPath)}`);
  console.log(`Wrote ${path.relative(ROOT, path.join(outDir, 'express-routes.inventory.md'))}`);
  console.log(`Wrote ${path.relative(ROOT, path.join(outDir, 'openapi-gap-report.md'))}`);
  console.log(`Wrote ${path.relative(ROOT, duplicatesPath)}`);
  console.log(
    `\nSummary: ${inventory.length} routes, ${missingInOpenapi.length} missing from OpenAPI (template match), ${documentedNotLive.length} OpenAPI ops not found on app, ${duplicates.length} duplicate (METHOD,path) keys.\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
