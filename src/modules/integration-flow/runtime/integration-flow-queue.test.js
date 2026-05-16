'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IntegrationFlowQueue,
  resetIntegrationFlowQueueForTests,
} = require('./integration-flow-queue');

test('IntegrationFlowQueue: respects concurrency limit', async () => {
  const q = new IntegrationFlowQueue(2);
  let active = 0;
  let maxActive = 0;

  const task = () =>
    new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        resolve('ok');
      }, 30);
    });

  const results = await Promise.all([
    q.push(task),
    q.push(task),
    q.push(task),
    q.push(task),
  ]);

  assert.equal(results.length, 4);
  assert.ok(maxActive <= 2, `expected max 2 concurrent, saw ${maxActive}`);
});

test.after(() => {
  resetIntegrationFlowQueueForTests();
});
