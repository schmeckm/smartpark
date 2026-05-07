#!/usr/bin/env node
/**
 * Smart Park OS — OpenAPI splitter / builder (Phase A4).
 *
 * Background
 * ----------
 * `src/openapi/openapi.yaml` was a single 8.5k-line file that produced a
 * merge-conflict every time two PRs touched OpenAPI. A4 splits the file
 * into `src/openapi/_src/` so editors can change one resource family
 * without touching the monolith. The committed `openapi.yaml` becomes a
 * **build artifact** rebuilt deterministically from `_src/` so tooling
 * (swagger-ui, drift checks, deprecation tests, list-express-routes)
 * keeps loading a single document at runtime — no behavior change.
 *
 * Modes
 * -----
 * - default ("build"): read `_src/`, deep-merge, write `openapi.yaml`.
 * - `--check`: read `_src/`, deep-merge IN MEMORY, compare structurally
 *   to the on-disk `openapi.yaml`. Fail on drift. Used by CI.
 *
 * Why structural rather than byte-equal: per the A4 decision, byte
 * equality is not required. The drift gate compares (a) every top-level
 * key, (b) the set of `paths` and per-path operations, (c) every
 * components.schema / parameter / response / securityScheme key, and
 * (d) the tags list.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yamljs = require('yamljs');

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OPENAPI_DIR = path.join(ROOT, 'src', 'openapi');
const SRC_DIR = path.join(OPENAPI_DIR, '_src');
const OUT_FILE = path.join(OPENAPI_DIR, 'openapi.yaml');

const TOP_FILES = ['openapi.yaml', 'info.yaml', 'servers.yaml', 'tags.yaml', 'security.yaml'];
const COMPONENT_FILES = ['schemas.yaml', 'parameters.yaml', 'responses.yaml', 'examples.yaml'];

// yamljs is permissive (matches `validate-openapi-parse.mjs` and the
// swagger-ui loader at runtime); `stringify(_, 999, 2)` keeps every
// nested level in block-style for readability.
const YAML_INLINE_FROM_LEVEL = 999;
const YAML_INDENT = 2;

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return yamljs.load(filePath);
}

function writeYaml(filePath, doc, header) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = yamljs.stringify(doc, YAML_INLINE_FROM_LEVEL, YAML_INDENT);
  const out = header ? `${header}\n${body}` : body;
  fs.writeFileSync(filePath, out);
}

function deepMerge(target, source) {
  if (source == null) return target;
  if (typeof source !== 'object' || Array.isArray(source)) return source;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function buildDocument() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`build-openapi: source directory missing: ${path.relative(ROOT, SRC_DIR)}`);
  }

  // 1. Top-level skeleton.
  const skeleton = readYaml(path.join(SRC_DIR, 'openapi.yaml'));
  if (!skeleton || typeof skeleton.openapi !== 'string') {
    throw new Error('build-openapi: _src/openapi.yaml must define `openapi: <version>`');
  }
  let doc = { ...skeleton };

  // 2. Top-level singletons (info / servers / tags / security).
  for (const file of TOP_FILES) {
    if (file === 'openapi.yaml') continue;
    const part = readYaml(path.join(SRC_DIR, file));
    if (part) doc = deepMerge(doc, part);
  }

  // 3. Components — each `_src/components/*.yaml` carries the full
  //    `{ components: { schemas|parameters|responses|examples: {…} } }`
  //    envelope so it's self-documenting; deep-merge at top level
  //    folds it into `doc.components` correctly even when the same
  //    sibling is also produced by `security.yaml`.
  for (const file of COMPONENT_FILES) {
    const part = readYaml(path.join(SRC_DIR, 'components', file));
    if (part) doc = deepMerge(doc, part);
  }

  // 4. Paths — one file per resource family.
  doc.paths = doc.paths || {};
  const pathsDir = path.join(SRC_DIR, 'paths');
  if (fs.existsSync(pathsDir)) {
    const files = fs.readdirSync(pathsDir).filter((f) => f.endsWith('.yaml')).sort();
    for (const file of files) {
      const part = readYaml(path.join(pathsDir, file));
      if (part && typeof part === 'object') {
        for (const [pathKey, ops] of Object.entries(part)) {
          if (doc.paths[pathKey]) {
            throw new Error(`build-openapi: path "${pathKey}" defined in multiple _src/paths/ files`);
          }
          doc.paths[pathKey] = ops;
        }
      }
    }
  }

  return doc;
}

function shape(doc) {
  const paths = Object.fromEntries(
    Object.entries(doc.paths || {}).map(([p, v]) => [
      p,
      Object.keys(v || {})
        .filter((k) => ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'].includes(k))
        .sort(),
    ])
  );
  const components = doc.components || {};
  return {
    openapi: doc.openapi,
    pathKeys: Object.keys(paths).sort(),
    pathOps: paths,
    schemas: Object.keys(components.schemas || {}).sort(),
    parameters: Object.keys(components.parameters || {}).sort(),
    responses: Object.keys(components.responses || {}).sort(),
    securitySchemes: Object.keys(components.securitySchemes || {}).sort(),
    examples: Object.keys(components.examples || {}).sort(),
    tags: (doc.tags || []).map((t) => t.name).sort(),
    serverCount: (doc.servers || []).length,
  };
}

function diffShapes(a, b) {
  const diffs = [];
  const compareList = (label, x, y) => {
    const xs = new Set(x);
    const ys = new Set(y);
    const onlyA = [...xs].filter((k) => !ys.has(k));
    const onlyB = [...ys].filter((k) => !xs.has(k));
    if (onlyA.length || onlyB.length) {
      diffs.push({ label, onlyInBuilt: onlyA, onlyInDisk: onlyB });
    }
  };
  if (a.openapi !== b.openapi) diffs.push({ label: 'openapi-version', built: a.openapi, disk: b.openapi });
  if (a.serverCount !== b.serverCount) diffs.push({ label: 'server-count', built: a.serverCount, disk: b.serverCount });
  compareList('paths', a.pathKeys, b.pathKeys);
  compareList('schemas', a.schemas, b.schemas);
  compareList('parameters', a.parameters, b.parameters);
  compareList('responses', a.responses, b.responses);
  compareList('securitySchemes', a.securitySchemes, b.securitySchemes);
  compareList('examples', a.examples, b.examples);
  compareList('tags', a.tags, b.tags);

  for (const p of a.pathKeys) {
    if (!b.pathOps[p]) continue;
    const builtOps = a.pathOps[p];
    const diskOps = b.pathOps[p];
    if (builtOps.length !== diskOps.length || builtOps.some((op, i) => op !== diskOps[i])) {
      diffs.push({ label: `operations[${p}]`, built: builtOps, disk: diskOps });
    }
  }
  return diffs;
}

function modeBuild() {
  const doc = buildDocument();
  writeYaml(
    OUT_FILE,
    doc,
    '# !!! GENERATED FILE — edit src/openapi/_src/ and run `npm run build:openapi`.'
  );
  console.log(
    `[build-openapi] wrote ${path.relative(ROOT, OUT_FILE)} — paths=${Object.keys(doc.paths).length}, schemas=${Object.keys(doc.components?.schemas || {}).length}.`
  );
}

function modeCheck() {
  const built = buildDocument();
  const onDisk = readYaml(OUT_FILE);
  if (!onDisk) {
    console.error(`[build-openapi:check] ${path.relative(ROOT, OUT_FILE)} missing on disk.`);
    process.exit(1);
  }
  const diffs = diffShapes(shape(built), shape(onDisk));
  if (diffs.length > 0) {
    console.error('[build-openapi:check] structural drift between _src/ and openapi.yaml:');
    for (const d of diffs) console.error('  -', JSON.stringify(d));
    console.error('Run `npm run build:openapi` to refresh the artifact.');
    process.exit(1);
  }
  console.log(
    `[build-openapi:check] OK — _src/ builds to a structurally equivalent openapi.yaml (${Object.keys(built.paths).length} paths).`
  );
}

// Only run when invoked directly (`node scripts/build-openapi.mjs ...`).
// When imported by tests we expose pure helpers and DO NOT touch disk.
const isMain = (() => {
  try {
    return import.meta.url === url.pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const arg = process.argv[2];
  if (arg === '--check' || arg === 'check') {
    modeCheck();
  } else if (!arg || arg === 'build' || arg === '--build') {
    modeBuild();
  } else {
    console.error(`Unknown mode: ${arg}. Use --check or omit for build.`);
    process.exit(2);
  }
}

export { buildDocument, diffShapes, shape };
