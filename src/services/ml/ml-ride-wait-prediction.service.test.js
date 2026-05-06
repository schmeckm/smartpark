const test = require('node:test');
const assert = require('node:assert/strict');
const { findWaitAtHorizon, DEFAULT_HORIZONS } = require('./ride-dataset.service');
const { fitRidge, predictRidge, maeRmse } = require('./ride-ridge.util');
const { baselineForecastFromSnapshot } = require('./ride-baseline-forecast.service');
const { topFactorsFromImportance } = require('./feature-importance.util');

test('findWaitAtHorizon picks nearest bucket inside window', () => {
  const rows = [
    { snapshotAt: '2026-05-04T10:00:00.000Z', waitTime: 20 },
    { snapshotAt: '2026-05-04T10:14:00.000Z', waitTime: 42 },
    { snapshotAt: '2026-05-04T10:16:00.000Z', waitTime: 99 },
  ];
  const y = findWaitAtHorizon(rows, 0, 15);
  assert.equal(y, 42);
  assert.equal(DEFAULT_HORIZONS.length, 3);
});

test('ridge fit reproduces roughly linear trend', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 40; i++) {
    X.push([i * 0.5, i % 3]);
    y.push(10 + i * 0.3 + (i % 3) * 0.1);
  }
  const { Xtr, ytr, Xva, yva } = {
    Xtr: X.slice(0, 32),
    ytr: y.slice(0, 32),
    Xva: X.slice(32),
    yva: y.slice(32),
  };
  const fit = fitRidge(Xtr, ytr, 1);
  const pred = Xva.map((row) => predictRidge(fit, row));
  const { mae } = maeRmse(yva, pred);
  assert.ok(mae < 5);
});

test('baseline returns BASELINE_ONLY and finite predictions', () => {
  const snap = {
    snapshotAt: '2026-05-04T12:00:00.000Z',
    currentWaitTimeMin: 40,
    waitTimeDelta5m: 2,
    parkCrowdIndex: 55,
    precipitationMm: 1,
    temperatureC: 18,
    isSchoolHoliday: true,
    status: 'OPEN',
    isOpen: true,
    xFeaturesExtras: {},
  };
  const b = baselineForecastFromSnapshot(snap, { horizons: [15, 60] });
  assert.equal(b.predictionMode, 'BASELINE_ONLY');
  assert.equal(b.predictions.length, 2);
  assert.ok(b.predictions.every((p) => p.source === 'BASELINE'));
});

test('topFactorsFromImportance ranks HIGH first', () => {
  const t = topFactorsFromImportance({ a: 0.5, b: 0.3, c: 0.1 }, 3);
  assert.equal(t[0].feature, 'a');
  assert.equal(t[0].impact, 'HIGH');
});
