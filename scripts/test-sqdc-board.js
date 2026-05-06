#!/usr/bin/env node
/**
 * Runs hierarchical SQDC board unit tests only.
 * Full suite: `npm test` (includes this file via node --test).
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const testFile = path.join(root, 'src', 'services', 'sqdc-board.service.test.js');
const r = spawnSync(process.execPath, ['--test', testFile], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
