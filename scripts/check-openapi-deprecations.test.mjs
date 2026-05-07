import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const YAML = require('yamljs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yamlPath = path.join(root, 'src', 'openapi', 'openapi.yaml');

/**
 * Operations that must remain marked `deprecated: true` in OpenAPI until they
 * are physically removed from the live Express app. This list is the QW7
 * deprecation contract; new clients must not consume any of these operations,
 * and CI must catch any silent un-deprecation.
 */
const REQUIRED_DEPRECATED_OPERATIONS = [
  // Singular `/integration` namespace; superseded by plural `/integrations/*`.
  { path: '/integration/logs', method: 'get' },
  // Legacy zones master data; superseded by `/parks` + `/assets?type=zone`.
  { path: '/zones', method: 'get' },
  { path: '/zones', method: 'post' },
  { path: '/zones/{id}', method: 'get' },
  { path: '/zones/{id}', method: 'patch' },
  { path: '/zones/{id}', method: 'delete' },
  // Legacy rides master data; superseded by `/assets?type=ride` + `/master-data/rides`.
  { path: '/rides', method: 'get' },
  { path: '/rides', method: 'post' },
  { path: '/rides/{id}', method: 'get' },
  { path: '/rides/{id}', method: 'patch' },
];

test('OpenAPI: every QW7 stale-route operation is marked deprecated', () => {
  const doc = YAML.load(yamlPath);
  assert.ok(doc && doc.paths, 'openapi.yaml has no paths block');

  const failures = [];
  for (const { path: p, method } of REQUIRED_DEPRECATED_OPERATIONS) {
    const item = doc.paths[p];
    if (!item) {
      failures.push(`missing path: ${p}`);
      continue;
    }
    const op = item[method];
    if (!op) {
      failures.push(`missing operation: ${method.toUpperCase()} ${p}`);
      continue;
    }
    if (op.deprecated !== true) {
      failures.push(`not deprecated: ${method.toUpperCase()} ${p} (deprecated=${JSON.stringify(op.deprecated)})`);
    }
    if (typeof op.description !== 'string' || op.description.trim() === '') {
      failures.push(`missing migration description: ${method.toUpperCase()} ${p}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Deprecation contract broken:\n  - ${failures.join('\n  - ')}\n\n` +
      'Either restore deprecated:true and the migration description, or — if the route is being physically removed — also remove the entry from REQUIRED_DEPRECATED_OPERATIONS in this file.'
  );
});
