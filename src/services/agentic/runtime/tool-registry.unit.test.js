'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('./tool-registry');
const { AppError } = require('../../../utils/app-error');

test('ToolRegistry rejects unknown tools', async () => {
  const r = new ToolRegistry();
  await assert.rejects(
    () => r.execute('missing.tool', { parkId: '00000000-0000-4000-8000-000000000001' }, {}),
    (err) => err instanceof AppError && err.code === 'AGENT_UNKNOWN_TOOL'
  );
});

test('ToolRegistry injects parkId for scoped tools (cannot be overridden by args)', async () => {
  const r = new ToolRegistry();
  const parkId = '11111111-1111-4111-8111-111111111111';
  r.register({
    name: 'test.echo',
    description: 'test',
    schema: { type: 'object' },
    async execute(_ctx, args) {
      assert.equal(args.parkId, parkId);
      return { ok: true };
    },
  });
  const out = await r.execute('test.echo', { parkId }, { parkId: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(out, { ok: true });
});

test('ToolRegistry allows missing parkId only when tool is global', async () => {
  const r = new ToolRegistry();
  r.register({
    name: 'global.ping',
    description: 'ping',
    schema: { type: 'object' },
    global: true,
    async execute() {
      return { pong: true };
    },
  });
  const out = await r.execute('global.ping', {}, {});
  assert.deepEqual(out, { pong: true });
});

test('ToolRegistry blocks mutating tools without applyApproved context', async () => {
  const r = new ToolRegistry();
  r.register({
    name: 'write.test_ping',
    description: 'test mutation',
    schema: { type: 'object' },
    requiresApproval: true,
    async execute() {
      return { ok: true };
    },
  });
  const parkId = '33333333-3333-4333-8333-333333333333';
  await assert.rejects(
    () => r.execute('write.test_ping', { parkId }, {}),
    (err) => err instanceof AppError && err.code === 'AGENT_MUTATION_BLOCKED'
  );
});

test('ToolRegistry runs mutating tools when applyApproved + actingUser are set', async () => {
  const r = new ToolRegistry();
  r.register({
    name: 'write.test_ping',
    description: 'test mutation',
    schema: { type: 'object' },
    requiresApproval: true,
    async execute() {
      return { ok: true };
    },
  });
  const parkId = '44444444-4444-4444-8444-444444444444';
  const out = await r.execute('write.test_ping', { parkId, applyApproved: true, actingUser: { id: parkId } }, {});
  assert.deepEqual(out, { ok: true });
});

test('ToolRegistry rejects scoped tool without parkId in context', async () => {
  const r = new ToolRegistry();
  r.register({
    name: 'scoped.x',
    description: 'x',
    schema: { type: 'object' },
    async execute() {
      return {};
    },
  });
  await assert.rejects(
    () => r.execute('scoped.x', {}, {}),
    (err) => err instanceof AppError && err.code === 'AGENT_PARK_REQUIRED'
  );
});
