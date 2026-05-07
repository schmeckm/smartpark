'use strict';

/**
 * Smart Park OS — boot orchestrator (Phase A3).
 *
 * `loadConfig({ app, logger })` builds a fresh `Lifecycle`, registers the
 * default 12-step boot sequence, and hands the lifecycle back to the caller
 * along with a few introspection helpers. The caller (`server.js`) is then
 * responsible for `lifecycle.start()` and signal handling — `loadConfig`
 * itself does no I/O so it remains test-friendly.
 *
 * Why this exists
 *   - Keeps `server.js` to ~25 lines of "create lifecycle → start → handle
 *     signals → on failure exit(1)" without business logic mixed in.
 *   - Gives tests a single function to call when they want a real-shape
 *     lifecycle without booting the process.
 *   - Provides one obvious place where a future PR can add conditional
 *     registration or alternative scheduler sets (e.g. for a dedicated
 *     "worker-only" deployment that excludes `http:listen`).
 */

const { Lifecycle } = require('./lifecycle');
const { registerDefaultBoot, DEFAULT_BOOT_STEP_ORDER } = require('./registrations/default');

/**
 * @typedef {object} LoadConfigArgs
 * @property {import('express').Application} app
 * @property {{ info?: Function, warn?: Function, error?: Function, fatal?: Function }} logger
 * @property {number} [port] override port (tests).
 */

/**
 * Build a `Lifecycle` with the default registrations applied.
 *
 * @param {LoadConfigArgs} args
 * @returns {{
 *   lifecycle: import('./lifecycle').Lifecycle,
 *   getHttpServer: () => import('http').Server | null,
 *   stepOrder: ReadonlyArray<string>,
 * }}
 */
function loadConfig(args) {
  if (!args || !args.app || !args.logger) {
    throw new TypeError('loadConfig: { app, logger } are required');
  }
  const lifecycle = new Lifecycle({ logger: args.logger });
  const { getHttpServer } = registerDefaultBoot(lifecycle, args);
  return {
    lifecycle,
    getHttpServer,
    stepOrder: DEFAULT_BOOT_STEP_ORDER,
  };
}

module.exports = { loadConfig, DEFAULT_BOOT_STEP_ORDER };
