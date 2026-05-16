'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimelineFromSteps } = require('./integration-flow.service');

test('buildTimelineFromSteps maps persisted step rows', () => {
  const tl = buildTimelineFromSteps([
    {
      nodeId: 'trigger_1',
      nodeType: 'MANUAL_TRIGGER',
      status: 'success',
      startedAt: new Date('2026-01-01T12:00:00Z'),
      finishedAt: null,
      durationMs: 12,
      errorMessage: null,
    },
  ]);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].nodeId, 'trigger_1');
  assert.equal(tl[0].durationMs, 12);
});

test('buildTimelineFromSteps copies errorMessage', () => {
  const tl = buildTimelineFromSteps([
    {
      nodeId: 'a',
      nodeType: 'X',
      status: 'failed',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      errorMessage: 'boom',
    },
  ]);
  assert.equal(tl[0].status, 'failed');
  assert.equal(tl[0].errorMessage, 'boom');
});
