'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eligibleForAutomaticRetry,
  markFailedRunPendingRetry,
  RETRY_STATUS,
} = require('./integration-flow-retry.helper');

test('eligibleForAutomaticRetry: false when retry disabled', () => {
  assert.equal(
    eligibleForAutomaticRetry(
      { enabled: true, retryEnabled: false, maxRetryAttempts: 2, retryDelaySeconds: 60, retryOnNodeTypes: null },
      { retryAttempt: 0 },
      'MANUAL_TRIGGER'
    ),
    false
  );
});

test('eligibleForAutomaticRetry: false when attempt >= max', () => {
  assert.equal(
    eligibleForAutomaticRetry(
      { enabled: true, retryEnabled: true, maxRetryAttempts: 2, retryDelaySeconds: 60, retryOnNodeTypes: null },
      { retryAttempt: 2 },
      'MANUAL_TRIGGER'
    ),
    false
  );
});

test('eligibleForAutomaticRetry: false when node type filtered out', () => {
  assert.equal(
    eligibleForAutomaticRetry(
      {
        enabled: true,
        retryEnabled: true,
        maxRetryAttempts: 2,
        retryDelaySeconds: 60,
        retryOnNodeTypes: ['OTHER'],
      },
      { retryAttempt: 0 },
      'MANUAL_TRIGGER'
    ),
    false
  );
});

test('markFailedRunPendingRetry: sets pending_retry and nextRetryAt when eligible', async () => {
  const updates = [];
  const row = {
    toJSON: () => ({ retryAttempt: 0 }),
    update: async (p) => {
      updates.push(p);
    },
  };
  const flow = {
    enabled: true,
    retryEnabled: true,
    maxRetryAttempts: 2,
    retryDelaySeconds: 60,
    retryOnNodeTypes: null,
  };
  const ok = await markFailedRunPendingRetry(row, flow, 'MANUAL_TRIGGER');
  assert.equal(ok, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].retryStatus, RETRY_STATUS.PENDING_RETRY);
  assert.ok(updates[0].nextRetryAt instanceof Date);
});

test('markFailedRunPendingRetry: no-op when not eligible', async () => {
  const updates = [];
  const row = {
    toJSON: () => ({ retryAttempt: 0 }),
    update: async (p) => {
      updates.push(p);
    },
  };
  const ok = await markFailedRunPendingRetry(row, { enabled: true, retryEnabled: false }, 'MANUAL_TRIGGER');
  assert.equal(ok, false);
  assert.equal(updates.length, 0);
});
