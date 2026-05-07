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
  // ML wait-time prediction surface; superseded by `/ai/ml/*` (Phase B5).
  { path: '/ml/predict/rides/{rideId}', method: 'get' },
  { path: '/ml/predict/park-summary', method: 'get' },
  { path: '/ml/dataset/rides', method: 'get' },
  { path: '/ml/train/wait-time/global', method: 'post' },
  { path: '/ml/train/wait-time/rides/{rideId}', method: 'post' },
];

/**
 * The Phase B5 canonical mounts must be documented in OpenAPI (so admin
 * dashboards and SDK generators can discover them) and must NOT be marked
 * `deprecated: true`. This is the inverse contract of the deprecation list
 * above — they are the migration target.
 */
const REQUIRED_CANONICAL_OPERATIONS = [
  { path: '/ai/ml/predict/rides/{rideId}', method: 'get' },
  { path: '/ai/ml/predict/park-summary', method: 'get' },
  { path: '/ai/ml/dataset/rides', method: 'get' },
  { path: '/ai/ml/train/wait-time/global', method: 'post' },
  { path: '/ai/ml/train/wait-time/rides/{rideId}', method: 'post' },
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

test('OpenAPI: every Phase B5 canonical /ai/ml/* operation is documented and NOT deprecated', () => {
  const doc = YAML.load(yamlPath);
  assert.ok(doc && doc.paths, 'openapi.yaml has no paths block');

  const failures = [];
  for (const { path: p, method } of REQUIRED_CANONICAL_OPERATIONS) {
    const item = doc.paths[p];
    if (!item) {
      failures.push(`missing canonical path: ${p}`);
      continue;
    }
    const op = item[method];
    if (!op) {
      failures.push(`missing canonical operation: ${method.toUpperCase()} ${p}`);
      continue;
    }
    if (op.deprecated === true) {
      failures.push(`canonical operation must NOT be deprecated: ${method.toUpperCase()} ${p}`);
    }
  }

  assert.equal(
    failures.length,
    0,
    `Phase B5 canonical contract broken:\n  - ${failures.join('\n  - ')}\n\n` +
      'The /ai/ml/* operations are the migration target for the deprecated /ml/* operations and must remain documented.'
  );
});
