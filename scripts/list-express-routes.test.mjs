import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('OpenAPI drift gate (parse + inventory + orphans/missing limits + allowlist)', () => {
  const drift = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-openapi-drift.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(drift.status, 0, drift.stderr || drift.stdout);
});
