'use strict';

/**
 * Smart Park OS — process entry point.
 *
 * Boot orchestration (which services run, in what order, how they stop) lives
 * in `src/bootstrap/load-config.js` and `src/bootstrap/registrations/`. This
 * file is intentionally tiny: it wires the default lifecycle, starts it,
 * binds shutdown signals, and exits on failure. Anything more substantial
 * belongs under `src/bootstrap/`.
 */

const { app } = require('./src/app');
const { logger } = require('./src/utils/logger');
const { loadConfig } = require('./src/bootstrap/load-config');
const { installShutdownHandlers } = require('./src/bootstrap/lifecycle');

async function start() {
  const { lifecycle } = loadConfig({ app, logger });
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

module.exports = { start };
