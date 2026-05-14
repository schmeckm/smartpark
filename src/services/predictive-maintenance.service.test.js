'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('evaluatePredictiveMaintenanceForAsset aggregates CRITICAL over WARN', () => {
  const {
    evaluatePredictiveMaintenanceForAsset,
  } = proxyquire('./predictive-maintenance.service', {
    './mqtt-sparkplug-live-buffer.service': {
      findLatestSparkplugLiveMetricRow: () => ({ value: 95, receivedAt: '2026-01-01T00:00:00.000Z' }),
    },
    '../models': {
      ParkAsset: {},
      ParkAssetPdmRule: {},
      Park: {},
      ParkAssetPdmEvaluationLog: {},
    },
  });

  const asset = { assetId: 'a', slug: 'ride-a', name: 'Ride A' };
  const rules = [
    {
      id: '1',
      metricName: 'temp',
      label: 'Temp',
      enabled: true,
      warnAbove: 80,
      criticalAbove: 90,
      warnBelow: null,
      criticalBelow: null,
    },
  ];
  const out = evaluatePredictiveMaintenanceForAsset(asset, 'park', rules);
  assert.equal(out.riskLevel, 'CRITICAL');
  assert.equal(out.signals[0].status, 'CRITICAL');
});

test('evaluatePredictiveMaintenanceForAsset NO_DATA yields MEDIUM when rules exist', () => {
  const {
    evaluatePredictiveMaintenanceForAsset,
  } = proxyquire('./predictive-maintenance.service', {
    './mqtt-sparkplug-live-buffer.service': {
      findLatestSparkplugLiveMetricRow: () => null,
    },
    '../models': {
      ParkAsset: {},
      ParkAssetPdmRule: {},
      Park: {},
      ParkAssetPdmEvaluationLog: {},
    },
  });

  const out = evaluatePredictiveMaintenanceForAsset(
    { assetId: 'a', slug: 'x', name: 'X' },
    'park',
    [{ id: '1', metricName: 'x', enabled: true, warnAbove: 1, criticalAbove: null, warnBelow: null, criticalBelow: null }]
  );
  assert.equal(out.riskLevel, 'MEDIUM');
  assert.equal(out.signals[0].status, 'NO_DATA');
});

test('pdmEvaluationFingerprint ignores signal order and live numeric values', () => {
  const { pdmEvaluationFingerprint } = proxyquire('./predictive-maintenance.service', {
    './mqtt-sparkplug-live-buffer.service': {},
    '../models': {
      ParkAsset: {},
      ParkAssetPdmRule: {},
      Park: {},
      ParkAssetPdmEvaluationLog: {},
    },
  });
  const a = {
    riskLevel: 'HIGH',
    signals: [
      { metricName: 'm2', status: 'WARN', value: 1 },
      { metricName: 'm1', status: 'OK', value: 99 },
    ],
  };
  const b = {
    riskLevel: 'HIGH',
    signals: [
      { metricName: 'm1', status: 'OK', value: 0 },
      { metricName: 'm2', status: 'WARN', value: 2 },
    ],
  };
  assert.equal(pdmEvaluationFingerprint(a), pdmEvaluationFingerprint(b));
});
