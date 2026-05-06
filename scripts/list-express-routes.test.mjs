import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('list-express-routes.mjs runs without crashing', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'list-express-routes.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
