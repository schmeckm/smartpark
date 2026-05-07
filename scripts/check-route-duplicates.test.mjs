import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Route-duplicate gate (no new dual-mounted routes vs baseline)', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-route-duplicates.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
