/**
 * Release metadata for support, smoke tests, and delivery manifests.
 * - `version`: semver from repository root `package.json` (ship this with customer releases).
 * - `gitCommit`: optional; set `GIT_COMMIT` or `SOURCE_COMMIT` in the runtime environment (CI/CD).
 */
const path = require('path');

let cache;

function readRootVersion() {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    const v = pkg && pkg.version;
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function getAppRelease() {
  if (!cache) {
    cache = {
      version: readRootVersion(),
      apiVersion: 'v1',
      gitCommit: process.env.GIT_COMMIT || process.env.SOURCE_COMMIT || null,
    };
  }
  return { ...cache };
}

module.exports = { getAppRelease };
