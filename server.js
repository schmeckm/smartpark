'use strict';

/**
 * Smart Park OS — process entry point.
 *
 * Boot sequence is delegated to the `Lifecycle` registry (Phase A1) so every
 * scheduler is started in deterministic order and asked to stop in reverse
 * order on SIGTERM/SIGINT/beforeExit. The wiring below registers exactly the
 * services that ran in the previous inline `server.js`, in the same order,
 * with the same start/stop functions — A1 is structural only, not behavioral.
 *
 * In Phase A3 the wiring block moves to `src/bootstrap/load-config.js` and
 * each registration becomes one tiny file under `src/bootstrap/registrations/`.
 */

const http = require('http');
const env = require('./src/config/env');
const { app } = require('./src/app');
const { sequelize } = require('./src/models');
const { initSocket } = require('./src/sockets');
const { startMqtt, stopMqtt } = require('./src/services/mqtt-connector.service');
const { AiOrchestratorService } = require('./src/services/ai-orchestrator.service');
const { IntegrationOrchestratorService } = require('./src/services/integration-orchestrator.service');
const { AdapterInstalledSchedulerService } = require('./src/services/adapter-installed-scheduler.service');
const { WeatherOpenMeteoSchedulerService } = require('./src/services/weather-open-meteo-scheduler.service');
const { logger } = require('./src/utils/logger');
const { getPlatformSettingsService } = require('./src/services/platform-settings.service');
const {
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
} = require('./src/services/attraction-oee-simulator.service');
const { MlTrainingSchedulerService } = require('./src/services/ml/ml-training-scheduler.service');
const { getFlags } = require('./src/bootstrap/feature-flags');
const { Lifecycle, installShutdownHandlers } = require('./src/bootstrap/lifecycle');

/**
 * Register the default Smart Park OS boot sequence on `lifecycle`.
 *
 * Each step matches the pre-A1 inline ordering in this file. The `httpServer`
 * is exposed via the closure so the listen step can return a stop that calls
 * `server.close()` on shutdown.
 *
 * @param {Lifecycle} lifecycle
 * @param {object} ctx
 * @param {number} ctx.port HTTP port from env.
 * @returns {{ getHttpServer: () => import('http').Server | null }}
 */
function registerDefaultBoot(lifecycle, ctx) {
  /** @type {import('http').Server | null} */
  let httpServer = null;

  lifecycle.register({
    name: 'boot:feature-flags',
    run: () => {
      const flags = getFlags();
      const warnings = flags.warnings();
      if (warnings.length > 0) {
        logger.warn({ warnings }, 'feature flags validation produced warnings (lenient mode)');
      }
      logger.info({ flags: flags.toLogPayload() }, 'feature flags resolved');
    },
  });

  lifecycle.register({
    name: 'db:sequelize',
    run: async () => {
      await sequelize.authenticate();
      logger.info('database connection established');
      return async () => {
        try {
          await sequelize.close();
        } catch (e) {
          logger.warn({ err: e?.message }, 'sequelize close failed');
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
          logger.info({ port: ctx.port }, 'Smart Park OS API listening');
          resolve(
            () =>
              new Promise((resolveClose) => {
                server.close(() => resolveClose());
              })
          );
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(ctx.port);
      }),
  });

  lifecycle.register({
    name: 'mqtt:connector',
    run: () => {
      startMqtt();
      return () => {
        try {
          stopMqtt();
        } catch (e) {
          logger.warn({ err: e?.message }, 'stopMqtt failed');
        }
      };
    },
  });

  lifecycle.register({
    name: 'sim:oee-auto-start',
    run: () => {
      if (env.simOeeEnabled && env.simOeeAutoStart) {
        startAttractionOeeSimulator({})
          .then((r) => logger.info({ r }, 'attraction OEE simulator auto-start'))
          .catch((e) => logger.warn({ err: e.message }, 'attraction OEE simulator auto-start failed'));
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

async function start() {
  const lifecycle = new Lifecycle({ logger });
  registerDefaultBoot(lifecycle, { port: env.port });

  installShutdownHandlers({
    lifecycle,
    logger,
    onExit: (errors) => {
      if (errors.length > 0) {
        logger.warn({ errors }, 'lifecycle shutdown completed with errors');
      } else {
        logger.info('lifecycle shutdown completed cleanly');
      }
    },
  });

  await lifecycle.start();
}

if (require.main === module) {
  start().catch((err) => {
    logger.fatal({ err }, 'failed to start server');
    process.exit(1);
  });
}

module.exports = { start, registerDefaultBoot };
