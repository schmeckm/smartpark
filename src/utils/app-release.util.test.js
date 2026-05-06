'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { getAppRelease } = require('./app-release.util');

test('getAppRelease exposes version from root package.json', () => {
  const rel = getAppRelease();
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  assert.equal(rel.version, pkg.version);
  assert.equal(rel.apiVersion, 'v1');
});

test('getAppRelease includes gitCommit when env set', (t) => {
  t.after(() => {
    delete process.env.GIT_COMMIT;
    delete require.cache[require.resolve('./app-release.util')];
  });
  delete require.cache[require.resolve('./app-release.util')];
  process.env.GIT_COMMIT = 'abc1234';
  // eslint-disable-next-line global-require
  const { getAppRelease: getAgain } = require('./app-release.util');
  assert.equal(getAgain().gitCommit, 'abc1234');
});
