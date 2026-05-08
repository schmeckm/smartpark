'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deprecation } = require('./deprecation.middleware');

function makeRes() {
  const headers = {};
  return {
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    headers,
  };
}

test('deprecation: with no options sets Deprecation: true and calls next()', () => {
  const mw = deprecation();
  const res = makeRes();
  let nextCalled = false;
  mw({}, res, () => {
    nextCalled = true;
  });
  assert.equal(res.getHeader('Deprecation'), 'true');
  assert.equal(res.getHeader('Link'), undefined);
  assert.equal(res.getHeader('Sunset'), undefined);
  assert.equal(res.getHeader('X-API-Deprecation-Reason'), undefined);
  assert.equal(nextCalled, true);
});

test('deprecation: canonical sets RFC 8288 Link with rel="successor-version"', () => {
  const mw = deprecation({ canonical: '/api/v1/integrations/installed-adapters/install-local' });
  const res = makeRes();
  mw({}, res, () => {});
  assert.equal(
    res.getHeader('Link'),
    '</api/v1/integrations/installed-adapters/install-local>; rel="successor-version"'
  );
});

test('deprecation: reason and sunset are emitted as headers', () => {
  const mw = deprecation({
    reason: 'Phase B2 — alias kept live for one major version.',
    sunset: '2026-12-31T00:00:00Z',
  });
  const res = makeRes();
  mw({}, res, () => {});
  assert.equal(res.getHeader('X-API-Deprecation-Reason'), 'Phase B2 — alias kept live for one major version.');
  assert.equal(res.getHeader('Sunset'), '2026-12-31T00:00:00Z');
});

test('deprecation: middleware always calls next() exactly once with no error', () => {
  const mw = deprecation({ canonical: '/x', reason: 'r', sunset: '2099-01-01' });
  let calls = [];
  mw({}, makeRes(), (...args) => {
    calls.push(args);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], []);
});
