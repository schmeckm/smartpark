'use strict';

/**
 * Smart Park OS — default boot registrations (Phase A3).
 *
 * Registers the default lifecycle steps that compose the production boot
 * sequence. The set is identical to the pre-A3 inline wiring in
 * `server.js`; A3 only relocates the wiring to a dedicated module so
 * `server.js` shrinks to a thin entry point.
 *
 * Registration is **unconditional**: every step is always registered, and
 * each scheduler's own service still self-checks its enable flag and
 * returns a no-op stop when disabled. This preserves the pre-A3 behavior
 * exactly (e.g. the AI orchestrator's "ai disabled" log line still fires
 * when `AI_SAMPLING_ENABLED!=true`).
 *
 * Follow-up (audit's full A3 vision): once each scheduler's internal flag
 * has been audited and matched 1:1 with a typed-flags path, registration
 * itself can become conditional so `lifecycle.steps()` reflects exactly
 * what is running in this process. Out of scope for the current commit
 * because mis-gating a scheduler would be a hard-to-detect regression.
 */

const http = require('http');
const env = require('../../config/env');
const { sequelize } = require('../../models');
const { initSocket } = require('../../sockets');
const { startMqtt, stopMqtt } = require('../../services/mqtt-connector.service');
const { AiOrchestratorService } = require('../../services/ai-orchestrator.service');
const { IntegrationOrchestratorService } = require('../../services/integration-orchestrator.service');
const { AdapterInstalledSchedulerService } = require('../../modules/integrations/adapter-framework/adapter-installed-scheduler.service');
const { WeatherOpenMeteoSchedulerService } = require('../../services/weather-open-meteo-scheduler.service');
const { MlTrainingSchedulerService } = require('../../services/ml/ml-training-scheduler.service');
const { IntegrationFlowSchedulerService } = require('../../modules/integration-flow/services/integration-flow-scheduler.service');
const { IntegrationFlowRetrySchedulerService } = require('../../modules/integration-flow/services/integration-flow-retry-scheduler.service');
const {
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
} = require('../../services/attraction-oee-simulator.service');
const { getPlatformSettingsService } = require('../../services/platform-settings.service');
const { getFlags } = require('../feature-flags');

/**
 * @typedef {object} DefaultBootCtx
 * @property {import('express').Application} app
 * @property {{ info?: Function, warn?: Function, error?: Function, fatal?: Function }} logger
 * @property {number} [port]
 */

/**
 * Register the default boot steps on `lifecycle`. Returns a tiny
 * controls object so the caller can introspect the http server (e.g. for
 * tests or a future health endpoint).
 *
 * @param {import('../lifecycle').Lifecycle} lifecycle
 * @param {DefaultBootCtx} ctx
 * @returns {{ getHttpServer: () => import('http').Server | null }}
 */
function registerDefaultBoot(lifecycle, ctx) {
  if (!lifecycle) throw new TypeError('registerDefaultBoot: lifecycle is required');
  if (!ctx || !ctx.app || !ctx.logger) {
    throw new TypeError('registerDefaultBoot: ctx.app and ctx.logger are required');
  }
  const { app, logger } = ctx;
  const port = typeof ctx.port === 'number' ? ctx.port : env.port;

  /** @type {import('http').Server | null} */
  let httpServer = null;

  lifecycle.register({
    name: 'boot:feature-flags',
    run: () => {
      const flags = getFlags();
      const warnings = flags.warnings();
      if (warnings.length > 0) {
        logger.warn?.({ warnings }, 'feature flags validation produced warnings (lenient mode)');
      }
      logger.info?.({ flags: flags.toLogPayload() }, 'feature flags resolved');
    },
  });

  lifecycle.register({
    name: 'db:sequelize',
    run: async () => {
      await sequelize.authenticate();
      logger.info?.('database connection established');
      return async () => {
        try {
          await sequelize.close();
        } catch (e) {
          logger.warn?.({ err: e?.message }, 'sequelize close failed');
        }
      };
    },
  });

  lifecycle.register({
    name: 'cache:platform-settings',
    run: async () => {
      await getPlatformSettingsService().warmupCache();
    },
  });

  lifecycle.register({
    name: 'cache:influx-streaming-gate',
    run: async () => {
      const { warmupInfluxStreamingGate } = require('../../services/influx-ot-metrics.service');
      await warmupInfluxStreamingGate();
    },
  });

  lifecycle.register({
    name: 'http:server-init',
    run: () => {
      httpServer = http.createServer(app);
      initSocket(httpServer);
    },
  });

  lifecycle.register({
    name: 'scheduler:ai-orchestrator',
    run: async () => {
      const stop = await new AiOrchestratorService().startIfEnabled();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:integration-orchestrator',
    run: async () => {
      const orchestrator = new IntegrationOrchestratorService();
      await orchestrator.bootstrap();
      const stop = orchestrator.startPollingIfEnabled();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:adapter-installed',
    run: async () => {
      const stop = await new AdapterInstalledSchedulerService().start();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:weather-open-meteo',
    run: async () => {
      const stop = await new WeatherOpenMeteoSchedulerService().start();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:ml-training',
    run: async () => {
      const stop = await new MlTrainingSchedulerService().start();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:integration-flow',
    run: async () => {
      if (!env.integrationFlowEngineEnabled) {
        return null;
      }
      const stop = new IntegrationFlowSchedulerService().startIfEnabled();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'scheduler:integration-flow-retry',
    run: async () => {
      if (!env.integrationFlowEngineEnabled) {
        return null;
      }
      const stop = new IntegrationFlowRetrySchedulerService().startIfEnabled();
      return typeof stop === 'function' ? stop : null;
    },
  });

  lifecycle.register({
    name: 'http:listen',
    run: () =>
      new Promise((resolve, reject) => {
        if (!httpServer) {
          reject(new Error('http:listen invoked before http:server-init'));
          return;
        }
        const server = httpServer;
        const onError = (err) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          logger.info?.({ port }, 'Smart Park OS API listening');
          resolve(
            () =>
              new Promise((resolveClose) => {
                server.close(() => resolveClose());
              })
          );
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
      }),
  });

  lifecycle.register({
    name: 'influx:ot-metrics-flush',
    run: () => {
      return async () => {
        const { flushInfluxOtWrites } = require('../../services/influx-ot-metrics.service');
        try {
          await flushInfluxOtWrites();
        } catch (e) {
          logger.warn?.({ err: e?.message }, 'influx ot metrics flush failed');
        }
      };
    },
  });

  lifecycle.register({
    name: 'mqtt:connector',
    run: () => {
      startMqtt();
      return () => {
        try {
          stopMqtt();
        } catch (e) {
          logger.warn?.({ err: e?.message }, 'stopMqtt failed');
        }
      };
    },
  });

  lifecycle.register({
    name: 'sim:oee-auto-start',
    run: () => {
      if (env.simOeeEnabled && env.simOeeAutoStart) {
        startAttractionOeeSimulator({})
          .then((r) => logger.info?.({ r }, 'attraction OEE simulator auto-start'))
          .catch((e) => logger.warn?.({ err: e.message }, 'attraction OEE simulator auto-start failed'));
      }
      return async () => {
        try {
          await stopAttractionOeeSimulator();
        } catch {
          /* swallow — OEE sim has its own internal guards */
        }
      };
    },
  });

  return { getHttpServer: () => httpServer };
}

/**
 * Canonical step ordering. Exposed so tests can assert that the wiring
 * still produces this exact sequence; any reorder must be deliberate.
 */
const DEFAULT_BOOT_STEP_ORDER = Object.freeze([
  'boot:feature-flags',
  'db:sequelize',
  'cache:platform-settings',
  'cache:influx-streaming-gate',
  'http:server-init',
  'scheduler:ai-orchestrator',
  'scheduler:integration-orchestrator',
  'scheduler:adapter-installed',
  'scheduler:weather-open-meteo',
  'scheduler:ml-training',
  'scheduler:integration-flow',
  'scheduler:integration-flow-retry',
  'http:listen',
  'influx:ot-metrics-flush',
  'mqtt:connector',
  'sim:oee-auto-start',
]);

module.exports = { registerDefaultBoot, DEFAULT_BOOT_STEP_ORDER };
