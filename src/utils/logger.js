const pino = require('pino');
const env = require('../config/env');

const logger = pino({
  level: env.logLevel,
  base: { service: 'smart-park-os' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

module.exports = { logger };
