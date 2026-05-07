'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Lifecycle, installShutdownHandlers } = require('./lifecycle');

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

test('Lifecycle: register requires name and run', () => {
  const lc = new Lifecycle({ logger: silentLogger() });
  assert.throws(() => lc.register({}), /name is required/);
  assert.throws(() => lc.register({ name: 'x' }), /run must be a function/);
  assert.throws(() => lc.register({ name: '', run: () => {} }), /name is required/);
});

test('Lifecycle: start runs registrations in order, stop in reverse', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });

  lc.register({
    name: 'a',
    run: async () => {
      events.push('start:a');
      return () => events.push('stop:a');
    },
  });
  lc.register({
    name: 'b',
    run: async () => {
      events.push('start:b');
      return async () => events.push('stop:b');
    },
  });
  lc.register({
    name: 'c',
    run: () => {
      events.push('start:c');
      return () => events.push('stop:c');
    },
  });

  await lc.start();
  assert.deepEqual(events, ['start:a', 'start:b', 'start:c']);
  assert.equal(lc.isReady(), true);
  assert.deepEqual(lc.steps(), ['a', 'b', 'c']);

  const errors = await lc.stop();
  assert.deepEqual(errors, []);
  assert.deepEqual(events, ['start:a', 'start:b', 'start:c', 'stop:c', 'stop:b', 'stop:a']);
  assert.equal(lc.isReady(), false);
});

test('Lifecycle: explicit stop is used when run does not return one', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({
    name: 'a',
    run: () => {
      events.push('start:a');
    },
    stop: () => events.push('stop:a:explicit'),
  });
  await lc.start();
  await lc.stop();
  assert.deepEqual(events, ['start:a', 'stop:a:explicit']);
});

test('Lifecycle: returned stop function takes precedence over explicit stop', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({
    name: 'a',
    run: () => () => events.push('stop:a:returned'),
    stop: () => events.push('stop:a:explicit'),
  });
  await lc.start();
  await lc.stop();
  assert.deepEqual(events, ['stop:a:returned']);
});

test('Lifecycle: start failure unwinds previously-started steps in reverse', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => events.push('stop:a') });
  lc.register({ name: 'b', run: () => () => events.push('stop:b') });
  lc.register({
    name: 'boom',
    run: () => {
      throw new Error('boom failed');
    },
  });
  lc.register({ name: 'never', run: () => events.push('start:never') });

  await assert.rejects(lc.start(), /boom failed/);
  assert.deepEqual(events, ['stop:b', 'stop:a']);
  assert.equal(events.includes('start:never'), false);
  assert.equal(lc.isReady(), false);
});

test('Lifecycle: stop collects errors from misbehaving stops without short-circuiting', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => events.push('stop:a') });
  lc.register({
    name: 'b',
    run: () => () => {
      throw new Error('b stop boom');
    },
  });
  lc.register({ name: 'c', run: () => () => events.push('stop:c') });

  await lc.start();
  const errors = await lc.stop();
  assert.deepEqual(events, ['stop:c', 'stop:a']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, 'b');
  assert.match(errors[0].error, /b stop boom/);
});

test('Lifecycle: stop is idempotent (second call returns empty array)', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => events.push('stop:a') });
  await lc.start();
  await lc.stop();
  const errors = await lc.stop();
  assert.deepEqual(errors, []);
  assert.deepEqual(events, ['stop:a']);
});

test('Lifecycle: register after start is rejected', async () => {
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => {} });
  await lc.start();
  assert.throws(() => lc.register({ name: 'late', run: () => {} }), /cannot register after start/);
});

test('Lifecycle: double start is rejected', async () => {
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => {} });
  await lc.start();
  await assert.rejects(lc.start(), /already started/);
});

test('Lifecycle: steps that return non-function values do not blow up stop', async () => {
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => 'not a stop fn' });
  lc.register({ name: 'b', run: () => 42 });
  lc.register({ name: 'c', run: () => () => events.push('stop:c') });
  await lc.start();
  const errors = await lc.stop();
  assert.deepEqual(errors, []);
  assert.deepEqual(events, ['stop:c']);
});

test('installShutdownHandlers: SIGTERM triggers stop exactly once', async () => {
  const proc = new EventEmitter();
  proc.removeListener = proc.removeListener || EventEmitter.prototype.removeListener;
  const events = [];
  const lc = new Lifecycle({ logger: silentLogger() });
  lc.register({ name: 'a', run: () => () => events.push('stop:a') });
  await lc.start();

  let onExitErrors = null;
  installShutdownHandlers({
    lifecycle: lc,
    logger: silentLogger(),
    onExit: (errs) => {
      onExitErrors = errs;
    },
    proc,
  });

  proc.emit('SIGTERM');
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(events, ['stop:a']);
  assert.deepEqual(onExitErrors, []);
});

test('installShutdownHandlers: returns a disposer that removes its listeners', () => {
  const proc = new EventEmitter();
  proc.removeListener = proc.removeListener || EventEmitter.prototype.removeListener;
  const lc = new Lifecycle({ logger: silentLogger() });
  const dispose = installShutdownHandlers({ lifecycle: lc, logger: silentLogger(), proc });
  assert.equal(proc.listenerCount('SIGTERM'), 1);
  assert.equal(proc.listenerCount('SIGINT'), 1);
  assert.equal(proc.listenerCount('beforeExit'), 1);
  dispose();
  assert.equal(proc.listenerCount('SIGTERM'), 0);
  assert.equal(proc.listenerCount('SIGINT'), 0);
  assert.equal(proc.listenerCount('beforeExit'), 0);
});
