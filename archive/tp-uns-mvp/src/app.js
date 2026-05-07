const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { apiRouter } = require('./routes');
const { notFound, errorHandler } = require('./utils/error-middleware');
const { registerSwagger } = require('./swagger');
const env = require('./config/env');

function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ success: true, status: 'ok' }));
  app.use('/api/v1', apiRouter);
  if (env.swaggerEnabled) registerSwagger(app);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
