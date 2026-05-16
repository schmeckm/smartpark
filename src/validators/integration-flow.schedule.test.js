'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../utils/app-error');
const { validateIntegrationFlowScheduleState } = require('./integration-flow.schemas');

test('validateIntegrationFlowScheduleState: enabled schedule needs interval', () => {
  assert.throws(
    () =>
      validateIntegrationFlowScheduleState({
        enabled: true,
        scheduleEnabled: true,
        scheduleIntervalSeconds: null,
      }),
    AppError
  );
});

test('validateIntegrationFlowScheduleState: schedule requires enabled flow', () => {
  assert.throws(
    () =>
      validateIntegrationFlowScheduleState({
        enabled: false,
        scheduleEnabled: true,
        scheduleIntervalSeconds: 300,
      }),
    AppError
  );
});

test('validateIntegrationFlowScheduleState: rejects bad interval', () => {
  assert.throws(
    () =>
      validateIntegrationFlowScheduleState({
        enabled: true,
        scheduleEnabled: false,
        scheduleIntervalSeconds: 123,
      }),
    AppError
  );
});

test('validateIntegrationFlowScheduleState: allows schedule off with null interval', () => {
  assert.doesNotThrow(() =>
    validateIntegrationFlowScheduleState({
      enabled: false,
      scheduleEnabled: false,
      scheduleIntervalSeconds: null,
    })
  );
});
