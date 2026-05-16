'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunContext, applyNodeContextPatch } = require('./integration-flow-context');

test('createRunContext: includes run metadata', () => {
  const ctx = createRunContext(
    { id: 'flow-1', parkId: 'park-uuid' },
    { id: 'run-1' },
    { userId: 'user-1', scheduled: true }
  );
  assert.equal(ctx.flowId, 'flow-1');
  assert.equal(ctx.runId, 'run-1');
  assert.equal(ctx.parkId, 'park-uuid');
  assert.equal(ctx.scheduled, true);
  assert.equal(ctx.userId, 'user-1');
});

test('applyNodeContextPatch: merges contextPatch and payload hints', () => {
  const ctx = createRunContext({ id: 'f' }, { id: 'r' }, {});
  applyNodeContextPatch(ctx, {
    contextPatch: { externalParkId: 'from-patch' },
    payload: { observations: [{ id: 1 }], debug: { parkId: 'ignored-when-patch-set' } },
  });
  assert.equal(ctx.externalParkId, 'from-patch');
  assert.deepEqual(ctx.observations, [{ id: 1 }]);
});
