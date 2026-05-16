'use strict';

const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const mlPredictionTraceController = require('../../controllers/ml-prediction-trace.controller');
const { mlPredictionTracesQuery, predictionTraceIdParams } = require('../../validators/ml-wait-predict.validators');

/**
 * @param {import('express').Router} v1Router
 */
function registerAiPredictionTraceRoutes(v1Router) {
  v1Router.get(
    '/ai/ml/prediction-traces',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(mlPredictionTracesQuery, 'query'),
    mlPredictionTraceController.getMlPredictionTraces
  );
  v1Router.get(
    '/ai/ml/prediction-traces/filter-options',
    requirePermission('ai', 'read'),
    requireParkContext,
    mlPredictionTraceController.getMlPredictionTraceFilterOptions
  );
  v1Router.get(
    '/ai/ml/prediction-traces/:predictionId/coefficients',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictionTraceIdParams, 'params'),
    mlPredictionTraceController.getMlPredictionTraceCoefficients
  );
  v1Router.get(
    '/ai/ml/prediction-traces/:predictionId',
    requirePermission('ai', 'read'),
    requireParkContext,
    validate(predictionTraceIdParams, 'params'),
    mlPredictionTraceController.getMlPredictionTraceById
  );
}

module.exports = { registerAiPredictionTraceRoutes };
