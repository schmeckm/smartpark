const test = require('node:test');
const assert = require('node:assert/strict');
const {
  trainWithAlgorithm,
  predictFeatureStorePayload,
  predictGradientBoosting,
} = require('./ai-studio-feature-store-ml.util');

function rngFixed() {
  let s = 123456789;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mkRows(n) {
  const rows = [];
  const t0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const time_of_day = (i % 24) + (i % 7) * 0.1;
    const current_wait_time = 10 + Math.sin(i / 4) * 8 + (i % 5);
    rows.push({
      snapshotAt: new Date(t0 + i * 300_000),
      features: {
        time_of_day: current_wait_time * 0.3 + (i % 3),
        current_wait_time: current_wait_time,
        wait_time_trend_30m: current_wait_time * 0.9,
        ride_status_num: 1,
        park_crowd_index: 0.4 + (i % 10) * 0.02,
        zone_congestion_score: 0.2,
        rain_mm: 0,
        temperature_c: 18,
        school_holiday: i % 11 === 0 ? 1 : 0,
      },
      targetWaitPlusHorizon: Math.max(0, current_wait_time + 2 + (i % 4) - 1),
    });
  }
  return rows;
}

test('linear regression on synthetic snapshot rows has finite metrics and round-trip predict', () => {
  const rows = mkRows(80);
  const featureKeys = Object.keys(rows[0].features);
  const split = 64;
  const trainRows = rows.slice(0, split);
  const holdRows = rows.slice(split);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'linear_regression', rng, 15);
  assert.ok(Number.isFinite(out.mae));
  assert.ok(out.modelPayload.weights);
  assert.ok(out.modelPayload.trainingOptionsUsed?.ridgeLambda != null);
  assert.ok(Array.isArray(out.modelPayload.featureImportances));
  assert.ok(out.modelPayload.featureImportances.length > 0);
  assert.ok(out.modelPayload.featureImportances[0].feature);
  assert.ok(Number.isFinite(out.modelPayload.featureImportances[0].importance));
  const x = { ...holdRows[0].features };
  const pred = predictFeatureStorePayload(out.modelPayload, x, featureKeys);
  assert.ok(Number.isFinite(pred));
});

test('random forest trains and predicts', () => {
  const rows = mkRows(100);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 80);
  const holdRows = rows.slice(80);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'random_forest', rng, 15);
  assert.ok(out.modelPayload.rf?.trees?.length > 0);
  const pred = predictFeatureStorePayload(out.modelPayload, { ...holdRows[0].features }, featureKeys);
  assert.ok(Number.isFinite(pred));
});

test('random forest respects custom nTrees option', () => {
  const rows = mkRows(100);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 80);
  const holdRows = rows.slice(80);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'random_forest', rng, 15, {
    randomForest: { nTrees: 12 },
  });
  assert.equal(out.modelPayload.trainingOptionsUsed.randomForest.nTrees, 12);
  assert.equal(out.modelPayload.rf.trees.length, 12);
});

test('gradient boosting trains and predicts', () => {
  const rows = mkRows(90);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 72);
  const holdRows = rows.slice(72);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'gradient_boosting', rng, 15);
  assert.ok(out.modelPayload.gbm?.trees?.length > 0);
  const pred = predictFeatureStorePayload(out.modelPayload, { ...holdRows[0].features }, featureKeys);
  assert.ok(Number.isFinite(pred));
});

test('random_forest live prediction differs when maxDepth (tree complexity) changes', () => {
  const rows = mkRows(130);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 100);
  const holdRows = rows.slice(100);
  const rng = rngFixed();
  const shallow = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'random_forest', rng, 15, {
    randomForest: { maxDepth: 2, nTrees: 20 },
  });
  const rng2 = rngFixed();
  const deep = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'random_forest', rng2, 15, {
    randomForest: { maxDepth: 12, nTrees: 20 },
  });
  const x = { ...holdRows[0].features };
  const p1 = predictFeatureStorePayload(shallow.modelPayload, x, featureKeys);
  const p2 = predictFeatureStorePayload(deep.modelPayload, x, featureKeys);
  assert.ok(Number.isFinite(p1) && Number.isFinite(p2));
  assert.notEqual(p1, p2);
});

test('gradient_boosting live prediction differs when treeDepth changes', () => {
  const rows = mkRows(100);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 80);
  const holdRows = rows.slice(80);
  const rng = rngFixed();
  const shallow = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'gradient_boosting', rng, 15, {
    gradientBoosting: { treeDepth: 1, rounds: 20 },
  });
  const rng2 = rngFixed();
  const deep = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'gradient_boosting', rng2, 15, {
    gradientBoosting: { treeDepth: 8, rounds: 20 },
  });
  const x = { ...holdRows[0].features };
  const p1 = predictFeatureStorePayload(shallow.modelPayload, x, featureKeys);
  const p2 = predictFeatureStorePayload(deep.modelPayload, x, featureKeys);
  assert.ok(Number.isFinite(p1) && Number.isFinite(p2));
  assert.notEqual(p1, p2);
});

test('gradient_boosting shrinkage scales tree contributions (same trees, different eta)', () => {
  const rows = mkRows(80);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 64);
  const holdRows = rows.slice(64);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'gradient_boosting', rng, 15, {
    gradientBoosting: { rounds: 15, treeDepth: 4, shrinkage: 0.09 },
  });
  const g = out.modelPayload.gbm;
  const z = featureKeys.map((k) => {
    const raw = Number(holdRows[0].features[k]);
    const meta = out.modelPayload.normalization[k];
    return (raw - meta.mean) / meta.std;
  });
  const a = predictGradientBoosting({ ...g, shrink: 0.09 }, z);
  const b = predictGradientBoosting({ ...g, shrink: 0.03 }, z);
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  assert.notEqual(a, b);
});

test('legacy gradient_boosting payload resolves shrinkage from trainingOptionsUsed when gbm.shrink omitted', () => {
  const rows = mkRows(85);
  const featureKeys = Object.keys(rows[0].features);
  const trainRows = rows.slice(0, 68);
  const holdRows = rows.slice(68);
  const rng = rngFixed();
  const out = trainWithAlgorithm(trainRows, holdRows, featureKeys, 'gradient_boosting', rng, 15, {
    gradientBoosting: { shrinkage: 0.08, rounds: 12, treeDepth: 3 },
  });
  const payload = { ...out.modelPayload, gbm: { ...out.modelPayload.gbm } };
  delete payload.gbm.shrink;
  const x = { ...holdRows[0].features };
  const pFromMeta = predictFeatureStorePayload(payload, x, featureKeys);
  assert.ok(Number.isFinite(pFromMeta));
  const payloadDefault = structuredClone(payload);
  delete payloadDefault.trainingOptionsUsed.gradientBoosting.shrinkage;
  const pDefaultShrink = predictFeatureStorePayload(payloadDefault, x, featureKeys);
  assert.ok(Number.isFinite(pDefaultShrink));
  assert.notEqual(pFromMeta, pDefaultShrink);
});
