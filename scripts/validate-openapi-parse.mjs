#!/usr/bin/env node
/**
 * Fail-fast OpenAPI YAML parse check (no Swagger CLI — uses existing yamljs dependency).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yamljs');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const yamlPath = path.join(ROOT, 'src', 'openapi', 'openapi.yaml');

function main() {
  let doc;
  try {
    doc = YAML.load(yamlPath);
  } catch (e) {
    console.error('OpenAPI YAML parse failed:', e?.message || e);
    process.exit(1);
  }
  if (!doc || typeof doc !== 'object') {
    console.error('OpenAPI parse produced empty or non-object root.');
    process.exit(1);
  }
  if (String(doc.openapi || '').trim() === '') {
    console.error('OpenAPI document missing top-level `openapi` field.');
    process.exit(1);
  }
  if (!doc.paths || typeof doc.paths !== 'object') {
    console.error('OpenAPI document missing `paths` object.');
    process.exit(1);
  }
  const n = Object.keys(doc.paths).length;
  console.log(`OpenAPI parse OK (${path.relative(ROOT, yamlPath)}): openapi=${doc.openapi}, paths=${n}`);
}

main();
