import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';
import { buildDocument, shape, diffShapes } from './build-openapi.mjs';

const require = createRequire(import.meta.url);
const yamljs = require('yamljs');

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OUT_FILE = path.join(ROOT, 'src', 'openapi', 'openapi.yaml');

test('buildDocument: composes _src/ into a complete OpenAPI document', () => {
  const built = buildDocument();
  assert.equal(typeof built.openapi, 'string', 'openapi version present');
  assert.equal(typeof built.info, 'object', 'info block present');
  assert.equal(typeof built.paths, 'object', 'paths present');
  assert.ok(Object.keys(built.paths).length > 0, 'paths non-empty');
  assert.ok(built.components, 'components present');
  assert.ok(Object.keys(built.components.schemas || {}).length > 0, 'schemas non-empty');
});

test('shape: extracts the structural fingerprint of a document', () => {
  const built = buildDocument();
  const s = shape(built);
  assert.ok(Array.isArray(s.pathKeys));
  assert.ok(Array.isArray(s.schemas));
  assert.ok(Array.isArray(s.tags));
  assert.equal(typeof s.pathOps, 'object');
});

test('build artifact in repo is structurally equivalent to a fresh build of _src/', () => {
  const built = buildDocument();
  const onDisk = yamljs.load(OUT_FILE);
  const diffs = diffShapes(shape(built), shape(onDisk));
  if (diffs.length > 0) {
    assert.fail(
      `Drift detected — run \`npm run build:openapi\` to refresh the artifact.\n${JSON.stringify(diffs, null, 2)}`
    );
  }
});

test('diffShapes: detects added paths', () => {
  const a = { ...shape(buildDocument()) };
  const b = { ...a, pathKeys: a.pathKeys.slice(0, -1) };
  b.pathOps = { ...a.pathOps };
  const lastKey = a.pathKeys[a.pathKeys.length - 1];
  delete b.pathOps[lastKey];
  const diffs = diffShapes(a, b);
  assert.ok(diffs.some((d) => d.label === 'paths' && d.onlyInBuilt.includes(lastKey)));
});

test('diffShapes: detects schema additions and removals', () => {
  const baseline = { ...shape(buildDocument()) };
  const drifted = {
    ...baseline,
    schemas: [...baseline.schemas.slice(0, -1), 'NewSchema'],
  };
  const diffs = diffShapes(baseline, drifted);
  const schemaDiff = diffs.find((d) => d.label === 'schemas');
  assert.ok(schemaDiff, 'expected schemas diff');
  assert.ok(schemaDiff.onlyInDisk.includes('NewSchema'));
  assert.ok(schemaDiff.onlyInBuilt.includes(baseline.schemas[baseline.schemas.length - 1]));
});

test('diffShapes: detects per-path operation differences', () => {
  const baseline = shape(buildDocument());
  const samplePath = baseline.pathKeys[0];
  const drifted = {
    ...baseline,
    pathOps: { ...baseline.pathOps, [samplePath]: ['post'] },
  };
  const diffs = diffShapes(baseline, drifted);
  assert.ok(diffs.some((d) => d.label === `operations[${samplePath}]`));
});

test('build artifact: still parses to 276 paths and 205 schemas (current monolith snapshot)', () => {
  const onDisk = yamljs.load(OUT_FILE);
  assert.ok(Object.keys(onDisk.paths).length >= 270, 'paths count should not regress');
  assert.ok(Object.keys(onDisk.components?.schemas || {}).length >= 200, 'schemas count should not regress');
});
