'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();
const { buildLatestSnapshotDetail } = proxyquire('./traffic-corridor.service', {
  '../../models': { TrafficCorridor: class {} },
  './traffic-corridor-snapshot.repository': {
    findLatestSnapshotsByCorridorIds: async () => new Map(),
    listSnapshotsForCorridor: async () => [],
  },
});

test('buildLatestSnapshotDetail strips raw and surfaces warning', () => {
  const d = buildLatestSnapshotDetail(
    { baselineTravelTimeMin: 10 },
    {
      currentTravelTimeMin: 12,
      baselineTravelTimeMin: 10,
      snapshotTs: '2026-01-01T12:00:00.000Z',
      source: 'tomtom',
      delayPercent: 20,
      delayMin: 2,
      rawPayloadJson: {
        normalized: {
          routeDistanceMeters: 5000,
          travelTimeSeconds: 720,
          trafficDelaySeconds: 120,
          delayPercent: 20,
          providerStatus: 'warning',
          providerErrorCode: 'X',
          providerErrorMessage: 'Y',
          sampledAt: '2026-01-01T12:00:00.000Z',
          providerRawResponse: { secret: 'nope' },
        },
      },
    }
  );
  assert.equal(d.providerStatus, 'warning');
  assert.equal(d.routeLooksUnrealistic, true);
  assert.equal(d.routeDistanceMeters, 5000);
});
