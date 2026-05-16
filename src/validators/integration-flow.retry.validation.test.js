'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateIntegrationFlowRetryState } = require('./integration-flow.schemas');

test('validateIntegrationFlowRetryState: retry off requires max 0', () => {
  assert.throws(
    () =>
      validateIntegrationFlowRetryState({
        enabled: true,
        retryEnabled: false,
        maxRetryAttempts: 1,
        retryDelaySeconds: null,
        retryOnNodeTypes: null,
      }),
    /maxRetryAttempts must be 0 when retry is disabled/
  );
});

test('validateIntegrationFlowRetryState: retry on requires enabled flow', () => {
  assert.throws(
    () =>
      validateIntegrationFlowRetryState({
        enabled: false,
        retryEnabled: true,
        maxRetryAttempts: 2,
        retryDelaySeconds: 300,
        retryOnNodeTypes: null,
      }),
    /retryEnabled requires enabled flow/
  );
});

test('validateIntegrationFlowRetryState: retry on requires max 1–3', () => {
  assert.throws(
    () =>
      validateIntegrationFlowRetryState({
        enabled: true,
        retryEnabled: true,
        maxRetryAttempts: 0,
        retryDelaySeconds: 300,
        retryOnNodeTypes: null,
      }),
    /maxRetryAttempts between 1 and 3/
  );
});

test('validateIntegrationFlowRetryState: retry on requires allowed delay', () => {
  assert.throws(
    () =>
      validateIntegrationFlowRetryState({
        enabled: true,
        retryEnabled: true,
        maxRetryAttempts: 2,
        retryDelaySeconds: 120,
        retryOnNodeTypes: null,
      }),
    /valid retryDelaySeconds/
  );
});

test('validateIntegrationFlowRetryState: valid retry-on configuration', () => {
  assert.doesNotThrow(() =>
    validateIntegrationFlowRetryState({
      enabled: true,
      retryEnabled: true,
      maxRetryAttempts: 3,
      retryDelaySeconds: 900,
      retryOnNodeTypes: ['MANUAL_TRIGGER'],
    })
  );
});
