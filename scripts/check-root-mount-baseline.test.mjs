import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runCheckInTempRepo(mutateInventory) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'smartpark-rmb-'));
  try {
    mkdirSync(path.join(tmp, 'docs', 'generated'), { recursive: true });
    mkdirSync(path.join(tmp, 'docs', 'governance'), { recursive: true });
    mkdirSync(path.join(tmp, 'scripts'), { recursive: true });

    cpSync(
      path.join(ROOT, 'docs', 'governance', 'root-mount-routes-baseline.json'),
      path.join(tmp, 'docs', 'governance', 'root-mount-routes-baseline.json')
    );
    cpSync(
      path.join(ROOT, 'scripts', 'check-root-mount-baseline.mjs'),
      path.join(tmp, 'scripts', 'check-root-mount-baseline.mjs')
    );
    writeFileSync(
      path.join(tmp, 'scripts', 'list-express-routes.mjs'),
      "#!/usr/bin/env node\nconsole.log('stub');\nprocess.exit(0);\n"
    );

    const inventory = JSON.parse(
      readFileSync(path.join(ROOT, 'docs', 'generated', 'express-routes.inventory.json'), 'utf8')
    );
    const mutated = mutateInventory(JSON.parse(JSON.stringify(inventory)));
    writeFileSync(path.join(tmp, 'docs', 'generated', 'express-routes.inventory.json'), JSON.stringify(mutated, null, 2));

    const r = spawnSync('node', [path.join('scripts', 'check-root-mount-baseline.mjs')], {
      cwd: tmp,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('check-root-mount-baseline: passes against the current live inventory', () => {
  const r = spawnSync('node', [path.join('scripts', 'check-root-mount-baseline.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\[check:root-mount-baseline\] OK/);
});

test('check-root-mount-baseline: fails when a new prefix appears on src/app.js', () => {
  const r = runCheckInTempRepo((inv) => {
    inv.routes.push({
      method: 'POST',
      path: '/api/v1/rogue-prefix/foo',
      mountOrigin: 'src/app.js',
      sourceHint: 'synthetic test',
      inOpenApi: false,
    });
    return inv;
  });
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}`);
  assert.match(r.stderr, /FAIL/);
  assert.match(r.stderr, /\/api\/v1\/rogue-prefix\/foo/);
});

test('check-root-mount-baseline: tolerates new routes that fall under existing allowed prefixes', () => {
  const r = runCheckInTempRepo((inv) => {
    inv.routes.push({
      method: 'GET',
      path: '/api/v1/master-data/new-resource',
      mountOrigin: 'src/app.js',
      sourceHint: 'synthetic test',
      inOpenApi: true,
    });
    return inv;
  });
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}\n${r.stdout}\n${r.stderr}`);
});

test('check-root-mount-baseline: warns when an allowlisted prefix becomes stale', () => {
  const r = runCheckInTempRepo((inv) => {
    inv.routes = inv.routes.filter((rt) => !rt.path.startsWith('/api/v1/visit-actuals'));
    return inv;
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /stale baseline entries/);
  assert.match(r.stderr, /\/api\/v1\/visit-actuals/);
});

test('baseline file: shape contract (every entry has a migrationNote)', () => {
  const baseline = JSON.parse(
    readFileSync(path.join(ROOT, 'docs', 'governance', 'root-mount-routes-baseline.json'), 'utf8')
  );
  assert.ok(Array.isArray(baseline.allowedPrefixes), 'allowedPrefixes is an array');
  assert.equal(baseline.schemaVersion, 1);
  for (const pre of baseline.allowedPrefixes) {
    assert.ok(
      typeof baseline.migrationNotes?.[pre] === 'string' && baseline.migrationNotes[pre].length > 0,
      `missing migrationNotes entry for "${pre}"`
    );
  }
});
