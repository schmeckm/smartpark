'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();
const { errorHandler } = require('../middleware/error.middleware');

function makeApp(ctrl, query) {
  const app = express();
  app.use((req, _res, next) => {
    req.parkContext = { id: 'park-1' };
    req.validated = { ...query };
    next();
  });
  app.get('/api/v1/ai/ml/predict/rides/:rideId', ctrl.getPredictRide);
  app.use(errorHandler);
  return app;
}

test('getPredictRide without explain omits explanation', async () => {
  let explainCalls = 0;
  const ctrl = proxyquire('./ml-prediction.controller', {
    '../models': { ParkAsset: { findOne: async () => ({ assetId: 'ride-1' }) } },
    '../services/ml/ride-prediction.service': {
      predictRideWaitTimes: async () => ({
        rideId: 'ride-1',
        predictionMode: 'BASELINE_ONLY',
        confidence: 0.5,
        predictions: [{ horizonMinutes: 30, value: 22, unit: 'min', source: 'BASELINE' }],
        topFactors: [],
      }),
    },
    '../services/ai/prediction-explanation-normalizer.service': {
      buildRidgeRideWaitExplainability: () => {
        explainCalls += 1;
        return { summary: 'x' };
      },
      finalizeExplainabilityMvpEnvelope: (p) => p,
    },
  });
  const app = makeApp(ctrl, { horizon: '15,30,60' });
  const res = await request(app).get('/api/v1/ai/ml/predict/rides/ride-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(explainCalls, 0);
  assert.equal(Object.hasOwn(res.body.data, 'explanation'), false);
});

test('getPredictRide with explain=1 includes explanation', async () => {
  let explainCalls = 0;
  const ctrl = proxyquire('./ml-prediction.controller', {
    '../models': { ParkAsset: { findOne: async () => ({ assetId: 'ride-1' }) } },
    '../services/ml/ride-prediction.service': {
      predictRideWaitTimes: async () => ({
        rideId: 'ride-1',
        predictionMode: 'BASELINE_ONLY',
        confidence: 0.5,
        predictions: [{ horizonMinutes: 30, value: 22, unit: 'min', source: 'BASELINE' }],
        topFactors: [],
      }),
    },
    '../services/ai/prediction-explanation-normalizer.service': {
      buildRidgeRideWaitExplainability: () => {
        explainCalls += 1;
        return { target: 'predicted_queue_time_next_30min' };
      },
      finalizeExplainabilityMvpEnvelope: (p) => p,
    },
  });
  const app = makeApp(ctrl, { horizon: '15,30,60', explain: '1' });
  const res = await request(app).get('/api/v1/ai/ml/predict/rides/ride-1?explain=1');
  assert.equal(res.status, 200);
  assert.equal(explainCalls, 1);
  assert.equal(res.body.data.explanation.target, 'predicted_queue_time_next_30min');
});

test('getPredictRide with explain=true includes explanation', async () => {
  let explainCalls = 0;
  const ctrl = proxyquire('./ml-prediction.controller', {
    '../models': { ParkAsset: { findOne: async () => ({ assetId: 'ride-1' }) } },
    '../services/ml/ride-prediction.service': {
      predictRideWaitTimes: async () => ({
        rideId: 'ride-1',
        predictionMode: 'BASELINE_ONLY',
        confidence: 0.5,
        predictions: [{ horizonMinutes: 30, value: 22, unit: 'min', source: 'BASELINE' }],
        topFactors: [],
      }),
    },
    '../services/ai/prediction-explanation-normalizer.service': {
      buildRidgeRideWaitExplainability: () => {
        explainCalls += 1;
        return { target: 'predicted_queue_time_next_30min' };
      },
      finalizeExplainabilityMvpEnvelope: (p) => p,
    },
  });
  const app = makeApp(ctrl, { horizon: '15,30,60', explain: 'true' });
  const res = await request(app).get('/api/v1/ai/ml/predict/rides/ride-1?explain=true');
  assert.equal(res.status, 200);
  assert.equal(explainCalls, 1);
  assert.ok(res.body.data.explanation);
});

test('getPredictRide with explain=0 omits explanation', async () => {
  let explainCalls = 0;
  const ctrl = proxyquire('./ml-prediction.controller', {
    '../models': { ParkAsset: { findOne: async () => ({ assetId: 'ride-1' }) } },
    '../services/ml/ride-prediction.service': {
      predictRideWaitTimes: async () => ({
        rideId: 'ride-1',
        predictionMode: 'BASELINE_ONLY',
        confidence: 0.5,
        predictions: [{ horizonMinutes: 30, value: 22, unit: 'min', source: 'BASELINE' }],
        topFactors: [],
      }),
    },
    '../services/ai/prediction-explanation-normalizer.service': {
      buildRidgeRideWaitExplainability: () => {
        explainCalls += 1;
        return { target: 'predicted_queue_time_next_30min' };
      },
      finalizeExplainabilityMvpEnvelope: (p) => p,
    },
  });
  const app = makeApp(ctrl, { horizon: '15,30,60', explain: '0' });
  const res = await request(app).get('/api/v1/ai/ml/predict/rides/ride-1?explain=0');
  assert.equal(res.status, 200);
  assert.equal(explainCalls, 0);
  assert.equal(Object.hasOwn(res.body.data, 'explanation'), false);
});
