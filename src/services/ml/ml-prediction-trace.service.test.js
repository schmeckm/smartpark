'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const env = require('../../config/env');
const { MlPredictionTrace, MlPredictionResult, MlParkProfile, MlRideProfile } = require('../../models');
const {
  hashFeatureVector,
  logPredictionTrace,
  listPredictionTraces,
  listPredictionTraceFilterOptions,
  getPredictionTraceByPredictionId,
  scheduleRideWaitMlTrace,
  runRideWaitMlTrace,
} = require('./ml-prediction-trace.service');
const { snapshotToFeatureMap, TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');

const PID = randomUUID();

test('hashFeatureVector is stable for TRAINING_FEATURE_NAMES order', () => {
  const snap = {
    currentWaitTimeMin: 10,
    snapshotAt: '2026-06-01T12:00:00.000Z',
    status: 'OPEN',
    isOpen: true,
    parkCrowdIndex: 40,
    xFeaturesExtras: {},
    precipitationMm: 0,
    temperatureC: 20,
    isSchoolHoliday: false,
  };
  const m = snapshotToFeatureMap(snap);
  const a = hashFeatureVector(m);
  const b = hashFeatureVector(m);
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('logPredictionTrace returns null and does not write when ML_TRACE is off', async () => {
  const prev = env.mlTraceEnabled;
  env.mlTraceEnabled = false;
  let calls = 0;
  const orig = MlPredictionTrace.create;
  MlPredictionTrace.create = async () => {
    calls++;
    return { get: () => ({}) };
  };
  try {
    const row = await logPredictionTrace({
      predictionId: PID,
      parkId: randomUUID(),
      rideId: randomUUID(),
      modelName: 'ride_wait_forecast',
      modelVersion: null,
      targetName: 'ride_wait_minutes',
      horizonMinutes: null,
      featureVectorJson: {},
      featureSourcesJson: {},
      featureStatusJson: {},
      missingFeaturesJson: [],
      fallbackUsed: false,
      predictionInputHash: null,
    });
    assert.equal(row, null);
    assert.equal(calls, 0);
  } finally {
    MlPredictionTrace.create = orig;
    env.mlTraceEnabled = prev;
  }
});

test('logPredictionTrace persists row when ML_TRACE is on', async () => {
  const prev = env.mlTraceEnabled;
  env.mlTraceEnabled = true;
  let payload;
  const orig = MlPredictionTrace.create;
  MlPredictionTrace.create = async (p) => {
    payload = p;
    return {
      get(opts) {
        if (opts && opts.plain) {
          return { id: 'test-row', ...p, featureVectorJson: p.featureVectorJson };
        }
        return {};
      },
    };
  };
  try {
    const fv = { current_wait_time: 5 };
    const out = await logPredictionTrace({
      predictionId: PID,
      parkId: randomUUID(),
      rideId: randomUUID(),
      modelName: 'ride_wait_forecast',
      targetName: 'ride_wait_minutes',
      featureVectorJson: fv,
      featureSourcesJson: {},
      featureStatusJson: {},
      missingFeaturesJson: [],
      fallbackUsed: true,
    });
    assert.ok(out);
    assert.deepEqual(payload.featureVectorJson, fv);
    assert.deepEqual(payload.weightedFeatureVectorJson, {});
    assert.deepEqual(out.featureVectorJson, fv);
  } finally {
    MlPredictionTrace.create = orig;
    env.mlTraceEnabled = prev;
  }
});

test('logPredictionTrace swallows DB errors (never throws)', async () => {
  const prev = env.mlTraceEnabled;
  env.mlTraceEnabled = true;
  const orig = MlPredictionTrace.create;
  MlPredictionTrace.create = async () => {
    throw new Error('simulated DB failure');
  };
  try {
    const out = await logPredictionTrace({
      predictionId: PID,
      modelName: 'm',
      targetName: 'ride_wait_minutes',
      featureVectorJson: {},
      featureSourcesJson: {},
      featureStatusJson: {},
      missingFeaturesJson: [],
      fallbackUsed: false,
    });
    assert.equal(out, null);
  } finally {
    MlPredictionTrace.create = orig;
    env.mlTraceEnabled = prev;
  }
});

test('listPredictionTraces returns rows including featureVectorJson', async () => {
  const fv = Object.fromEntries(TRAINING_FEATURE_NAMES.map((k) => [k, 0]));
  const orig = MlPredictionTrace.findAll;
  MlPredictionTrace.findAll = async () => [
    {
      get(opts) {
        return opts && opts.plain
          ? {
              id: randomUUID(),
              predictionId: PID,
              featureVectorJson: fv,
            }
          : this;
      },
    },
  ];
  try {
    const rows = await listPredictionTraces({ parkId: randomUUID(), limit: 10 });
    assert.equal(rows.length, 1);
    assert.ok(rows[0].featureVectorJson);
    assert.equal(typeof rows[0].featureVectorJson.current_wait_time, 'number');
  } finally {
    MlPredictionTrace.findAll = orig;
  }
});

test('listPredictionTraceFilterOptions runs distinct queries scoped by park_id', async () => {
  const park = randomUUID();
  const calls = [];
  const origSq = MlPredictionTrace.sequelize;
  const mockSequelize = {
    QueryTypes: { SELECT: 'SELECT' },
    query: async (sql, opts) => {
      calls.push({ sql: String(sql), opts });
      assert.equal(opts.replacements.parkId, park);
      if (String(sql).includes('model_name')) {
        return [{ modelName: 'alpha' }, { modelName: 'beta' }];
      }
      return [{ targetName: 't_a' }, { targetName: 't_b' }];
    },
  };
  MlPredictionTrace.sequelize = mockSequelize;
  try {
    const out = await listPredictionTraceFilterOptions(park);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].sql.includes('DISTINCT'));
    assert.ok(calls[1].sql.includes('DISTINCT'));
    assert.deepEqual(out.modelNames, ['alpha', 'beta']);
    assert.deepEqual(out.targetNames, ['t_a', 't_b']);
  } finally {
    MlPredictionTrace.sequelize = origSq;
  }
});

test('listPredictionTraceFilterOptions returns empty lists when parkId missing', async () => {
  const out = await listPredictionTraceFilterOptions('');
  assert.deepEqual(out, { modelNames: [], targetNames: [] });
});

test('getPredictionTraceByPredictionId returns trace and results', async () => {
  const pred = randomUUID();
  const tracePlain = { predictionId: pred, id: randomUUID(), parkId: randomUUID() };
  const resultPlain = { predictionId: pred, horizonMinutes: 15, predictedValue: '12.5000' };
  const origT = MlPredictionTrace.findOne;
  const origR = MlPredictionResult.findAll;
  MlPredictionTrace.findOne = async () => ({
    get(opts) {
      return opts && opts.plain ? tracePlain : tracePlain;
    },
  });
  MlPredictionResult.findAll = async () => [
    {
      get(opts) {
        return opts && opts.plain ? resultPlain : resultPlain;
      },
    },
  ];
  try {
    const { trace, results } = await getPredictionTraceByPredictionId(pred);
    assert.ok(trace);
    assert.equal(trace.predictionId, pred);
    assert.equal(results.length, 1);
    assert.equal(results[0].horizonMinutes, 15);
  } finally {
    MlPredictionTrace.findOne = origT;
    MlPredictionResult.findAll = origR;
  }
});

test('scheduleRideWaitMlTrace is a no-op when ML_TRACE is off', async () => {
  const prev = env.mlTraceEnabled;
  env.mlTraceEnabled = false;
  let calls = 0;
  const origT = MlPredictionTrace.create;
  MlPredictionTrace.create = async () => {
    calls++;
    return { get: () => ({}) };
  };
  try {
    scheduleRideWaitMlTrace({
      parkId: randomUUID(),
      rideId: randomUUID(),
      rawFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 1,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 0,
        xFeaturesExtras: {},
      }),
      maskedFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 1,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 0,
        xFeaturesExtras: {},
      }),
      maskedKeys: new Set(),
      predictions: [{ horizonMinutes: 15, value: 10, unit: 'min', source: 'BASELINE' }],
      horizonMeta: [
        { source: 'BASELINE', fallbackUsed: true, resultModelName: 'baseline_forecast', resultModelVersion: null },
      ],
      overallConfidence: 0.45,
      registryModelId: null,
      topFactors: [],
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 0);
  } finally {
    MlPredictionTrace.create = origT;
    env.mlTraceEnabled = prev;
  }
});

test('scheduleRideWaitMlTrace does not reject when trace write fails', async () => {
  const prev = env.mlTraceEnabled;
  env.mlTraceEnabled = true;
  const origT = MlPredictionTrace.create;
  const origR = MlPredictionResult.create;
  MlPredictionTrace.create = async () => {
    throw new Error('db down');
  };
  MlPredictionResult.create = async () => ({ get: () => ({}) });
  try {
    scheduleRideWaitMlTrace({
      parkId: randomUUID(),
      rideId: randomUUID(),
      rawFeatureMap: {},
      maskedFeatureMap: {},
      maskedKeys: new Set(),
      predictions: [{ horizonMinutes: 15, value: 10 }],
      horizonMeta: [{}],
      overallConfidence: 0.5,
      registryModelId: null,
      topFactors: [],
    });
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    MlPredictionTrace.create = origT;
    MlPredictionResult.create = origR;
    env.mlTraceEnabled = prev;
  }
});

test('runRideWaitMlTrace keeps weightedFeatureVectorJson empty when ML_FEATURE_WEIGHTS_ENABLED is off', async () => {
  const prevT = env.mlTraceEnabled;
  const prevW = env.mlFeatureWeightsEnabled;
  env.mlTraceEnabled = true;
  env.mlFeatureWeightsEnabled = false;
  let payload;
  const origTrace = MlPredictionTrace.create;
  const origRes = MlPredictionResult.create;
  MlPredictionTrace.create = async (p) => {
    payload = p;
    return { get: (opts) => (opts && opts.plain ? { ...p } : {}) };
  };
  MlPredictionResult.create = async () => ({ get: () => ({}) });
  try {
    await runRideWaitMlTrace({
      parkId: randomUUID(),
      rideId: randomUUID(),
      rawFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 1,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 0,
        xFeaturesExtras: {},
      }),
      maskedFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 1,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 0,
        xFeaturesExtras: {},
      }),
      maskedKeys: new Set(),
      predictions: [{ horizonMinutes: 15, value: 10 }],
      horizonMeta: [{}],
      overallConfidence: 0.5,
      registryModelId: null,
      topFactors: [],
    });
    assert.ok(payload);
    assert.deepEqual(payload.weightedFeatureVectorJson, {});
  } finally {
    MlPredictionTrace.create = origTrace;
    MlPredictionResult.create = origRes;
    env.mlTraceEnabled = prevT;
    env.mlFeatureWeightsEnabled = prevW;
  }
});

test('runRideWaitMlTrace fills weightedFeatureVectorJson when ML_FEATURE_WEIGHTS_ENABLED is on', async () => {
  const prevT = env.mlTraceEnabled;
  const prevW = env.mlFeatureWeightsEnabled;
  env.mlTraceEnabled = true;
  env.mlFeatureWeightsEnabled = true;
  let payload;
  const origTrace = MlPredictionTrace.create;
  const origRes = MlPredictionResult.create;
  const origPark = MlParkProfile.findOne;
  const origRide = MlRideProfile.findOne;
  MlPredictionTrace.create = async (p) => {
    payload = p;
    return { get: (opts) => (opts && opts.plain ? { ...p } : {}) };
  };
  MlPredictionResult.create = async () => ({ get: () => ({}) });
  MlParkProfile.findOne = async () => null;
  MlRideProfile.findOne = async () => null;
  try {
    await runRideWaitMlTrace({
      parkId: randomUUID(),
      rideId: randomUUID(),
      rawFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 2,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 5,
        xFeaturesExtras: {},
      }),
      maskedFeatureMap: snapshotToFeatureMap({
        currentWaitTimeMin: 2,
        snapshotAt: '2026-06-01T12:00:00.000Z',
        status: 'OPEN',
        isOpen: true,
        parkCrowdIndex: 5,
        xFeaturesExtras: {},
      }),
      maskedKeys: new Set(),
      predictions: [{ horizonMinutes: 15, value: 10 }],
      horizonMeta: [{}],
      overallConfidence: 0.5,
      registryModelId: null,
      topFactors: [],
    });
    const wfv = payload.weightedFeatureVectorJson;
    assert.ok(wfv && typeof wfv === 'object');
    assert.equal(Object.keys(wfv).length, TRAINING_FEATURE_NAMES.length);
    assert.equal(wfv.current_wait_time.weight, 1);
    assert.ok(Number.isFinite(Number(wfv.current_wait_time.weightedValue)));
  } finally {
    MlPredictionTrace.create = origTrace;
    MlPredictionResult.create = origRes;
    MlParkProfile.findOne = origPark;
    MlRideProfile.findOne = origRide;
    env.mlTraceEnabled = prevT;
    env.mlFeatureWeightsEnabled = prevW;
  }
});
