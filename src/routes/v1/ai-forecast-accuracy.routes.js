'use strict';

const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const mlForecastAccuracyController = require('../../controllers/ml-forecast-accuracy.controller');
const {
  mlForecastAccuracyQuery,
  mlForecastAccuracyLogIdParams,
} = require('../../validators/ml-wait-predict.validators');

/**
 * @param {import('express').Router} v1Router
 */
function registerAiForecastAccuracyRoutes(v1Router) {
  v1Router.get(
    '/ai/ml/forecast-accuracy/kpis',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyQuery, 'query'),
    mlForecastAccuracyController.getMlForecastAccuracyKpis
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/model-win-rates',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlForecastAccuracyController.getMlModelWinRateStats
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/retro-lookback',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlForecastAccuracyController.getMlRetroLookback
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy/:id',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyLogIdParams, 'params'),
    mlForecastAccuracyController.getMlForecastAccuracyById
  );
  v1Router.get(
    '/ai/ml/forecast-accuracy',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlForecastAccuracyQuery, 'query'),
    mlForecastAccuracyController.getMlForecastAccuracyLogs
  );
}

module.exports = { registerAiForecastAccuracyRoutes };
