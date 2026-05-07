'use strict';

/**
 * Smart Park OS — boot/shutdown lifecycle (Phase A1).
 *
 * Tiny, dependency-free orchestrator that turns the previously-inline boot
 * sequence in `server.js` into a uniform ordered registry. Every step in the
 * sequence is registered with a `name`, a `run()` (which may return a `stop`
 * function), and an optional explicit `stop`. On shutdown the lifecycle calls
 * the captured stops in reverse registration order, collecting errors so a
 * single failed stop does not strand the rest of the schedulers.
 *
 * Why this exists:
 *   - Today the boot sequence in `server.js` is ~30 inline lines with mixed
 *     `await/then` patterns and the schedulers stop on `beforeExit` (which
 *     Node only fires when the event loop is empty — i.e. NOT on SIGTERM).
 *     Only the OEE simulator was wired to SIGTERM/SIGINT, so under a normal
 *     container shutdown most schedulers were never asked to stop cleanly.
 *   - A1's acceptance criterion is "every scheduler SIGTERM-safe": the
 *     lifecycle hooks SIGTERM/SIGINT/beforeExit to a single `stop()` call.
 *
 * What this is NOT:
 *   - A DI container. Wiring of which services run in this process stays in
 *     `server.js` (in A1) and moves to `src/bootstrap/load-config.js` (A3).
 *   - A health-check framework. `isReady()` is a simple boolean; a richer
 *     health endpoint can sit on top of it later.
 */

class Lifecycle {
  /**
   * @param {{ logger?: { info?: Function, warn?: Function, error?: Function } }} [opts]
   */
  constructor(opts = {}) {
    this._logger = opts.logger || null;
    /** @type {Array<{ name: string, run: Function, explicitStop: Function | null }>} */
    this._registrations = [];
    /** @type {Array<{ name: string, stop: Function | null }>} */
    this._captured = [];
    this._started = false;
    this._stopping = false;
  }

  /**
   * Register a startup step.
   *
   * @param {object} reg
   * @param {string} reg.name human-readable id, e.g. `db:sequelize`.
   * @param {() => any | Promise<any>} reg.run idempotent start. May return a
   *   `stop` function (sync or async) which the lifecycle will call on
   *   shutdown. Returning `undefined` is fine — the explicit `reg.stop` (if
   *   any) is used in that case.
   * @param {(() => any | Promise<any>) | null} [reg.stop] explicit stop, used
   *   when `run` does not return one.
   */
  register(reg) {
    if (!reg || typeof reg.name !== 'string' || reg.name === '') {
      throw new TypeError('Lifecycle.register: name is required');
    }
    if (typeof reg.run !== 'function') {
      throw new TypeError(`Lifecycle.register(${reg.name}): run must be a function`);
    }
    if (this._started) {
      throw new Error(`Lifecycle.register(${reg.name}): cannot register after start()`);
    }
    this._registrations.push({
      name: reg.name,
      run: reg.run,
      explicitStop: typeof reg.stop === 'function' ? reg.stop : null,
    });
  }

  /**
   * Run every registration in registration order. If any `run()` throws, the
   * lifecycle unwinds previously-captured stops (in reverse) and re-throws so
   * the caller can `process.exit(1)`.
   *
   * Each step's logging is structured so an operator can see exactly which
   * step is running and how long it took, which is the main debugging tool
   * for "why did boot get stuck?".
   */
  async start() {
    if (this._started) {
      throw new Error('Lifecycle.start: already started');
    }
    for (const reg of this._registrations) {
      const t0 = Date.now();
      let stopFn = null;
      try {
        const out = await reg.run();
        if (typeof out === 'function') {
          stopFn = out;
        } else if (reg.explicitStop) {
          stopFn = reg.explicitStop;
        }
        this._captured.push({ name: reg.name, stop: stopFn });
        this._log('info', { step: reg.name, durationMs: Date.now() - t0 }, 'lifecycle step started');
      } catch (err) {
        this._log('error', { step: reg.name, err: errMessage(err) }, 'lifecycle step failed; unwinding');
        await this._unwind();
        throw err;
      }
    }
    this._started = true;
  }

  /**
   * Run captured stops in reverse registration order. Errors per stop are
   * collected and returned (never rethrown) so a single misbehaving scheduler
   * does not block the others. Idempotent: subsequent calls return [].
   *
   * @returns {Promise<Array<{ name: string, error: string }>>}
   */
  async stop() {
    if (this._stopping || (!this._started && this._captured.length === 0)) {
      return [];
    }
    this._stopping = true;
    const errors = await this._unwind();
    this._started = false;
    this._stopping = false;
    return errors;
  }

  /**
   * @returns {boolean} true once `start()` resolved without unwinding.
   */
  isReady() {
    return this._started;
  }

  /**
   * Snapshot of currently registered step names (in order). Useful for tests
   * and the eventual `/admin/architecture-info` endpoint.
   *
   * @returns {string[]}
   */
  steps() {
    return this._registrations.map((r) => r.name);
  }

  async _unwind() {
    /** @type {Array<{ name: string, error: string }>} */
    const errors = [];
    while (this._captured.length > 0) {
      const { name, stop } = this._captured.pop();
      if (typeof stop !== 'function') continue;
      const t0 = Date.now();
      try {
        await stop();
        this._log('info', { step: name, durationMs: Date.now() - t0 }, 'lifecycle step stopped');
      } catch (err) {
        const msg = errMessage(err);
        errors.push({ name, error: msg });
        this._log('warn', { step: name, err: msg }, 'lifecycle step stop failed (continuing)');
      }
    }
    return errors;
  }

  _log(level, ctx, msg) {
    if (!this._logger) return;
    const fn = this._logger[level];
    if (typeof fn === 'function') fn.call(this._logger, ctx, msg);
  }
}

function errMessage(err) {
  if (err == null) return String(err);
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

/**
 * Install signal handlers that drive a clean shutdown via `lifecycle.stop()`.
 * Safe to call once per process. The `onExit` callback fires AFTER the
 * lifecycle has finished unwinding so the caller can decide whether to
 * `process.exit(0)` or let Node drain naturally.
 *
 * @param {object} args
 * @param {Lifecycle} args.lifecycle
 * @param {{ info?: Function, warn?: Function, error?: Function }} [args.logger]
 * @param {(errors: Array<{ name: string, error: string }>) => void} [args.onExit]
 * @param {NodeJS.Process} [args.proc] override for tests.
 * @returns {() => void} disposer that removes the handlers.
 */
function installShutdownHandlers({ lifecycle, logger, onExit, proc = process }) {
  let invoked = false;
  async function shutdown(signal) {
    if (invoked) return;
    invoked = true;
    if (logger?.info) logger.info({ signal }, 'shutdown signal received');
    let errors = [];
    try {
      errors = await lifecycle.stop();
    } catch (err) {
      if (logger?.error) logger.error({ err: errMessage(err) }, 'lifecycle.stop unexpectedly threw');
    }
    if (typeof onExit === 'function') onExit(errors);
  }

  const sigterm = () => shutdown('SIGTERM');
  const sigint = () => shutdown('SIGINT');
  const beforeExit = () => shutdown('beforeExit');

  proc.on('SIGTERM', sigterm);
  proc.on('SIGINT', sigint);
  proc.on('beforeExit', beforeExit);

  return () => {
    proc.removeListener('SIGTERM', sigterm);
    proc.removeListener('SIGINT', sigint);
    proc.removeListener('beforeExit', beforeExit);
  };
}

module.exports = { Lifecycle, installShutdownHandlers };
