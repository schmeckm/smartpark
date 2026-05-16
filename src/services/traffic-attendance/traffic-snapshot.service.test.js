'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TrafficSnapshotService } = require('./traffic-snapshot.service');

test('pollEnabledCorridors: operator baseline delay + warning when current far above baseline', async () => {
  let createdPayload;
  const corridorRow = {
    id: '00000000-0000-4000-8000-0000000000c1',
    parkId: '00000000-0000-4000-8000-0000000000p1',
    name: 'Gate A',
    originLat: 52.1,
    originLng: 5.1,
    destinationLat: 52.2,
    destinationLng: 5.2,
    direction: 'inbound',
    baselineTravelTimeMin: 10,
    weight: 1,
    enabled: true,
    update: async () => {},
    get: () => ({
      id: '00000000-0000-4000-8000-0000000000c1',
      parkId: '00000000-0000-4000-8000-0000000000p1',
      name: 'Gate A',
      originLat: 52.1,
      originLng: 5.1,
      destinationLat: 52.2,
      destinationLng: 5.2,
      direction: 'inbound',
      baselineTravelTimeMin: 10,
      weight: 1,
      enabled: true,
    }),
  };

  const provider = {
    fetchRouteForCorridor: async () => ({
      normalized: {
        corridorId: '00000000-0000-4000-8000-0000000000c1',
        provider: 'tomtom',
        originLat: 52.1,
        originLng: 5.1,
        destinationLat: 52.2,
        destinationLng: 5.2,
        travelTimeSeconds: 50 * 60,
        routeDistanceMeters: 5000,
        trafficDelaySeconds: 0,
        noTrafficTravelTimeSeconds: null,
        delayPercent: 0,
        sampledAt: new Date().toISOString(),
        providerStatus: 'ok',
      },
      providerRawResponse: { routes: [{ summary: { travelTimeInSeconds: 3000 } }] },
    }),
  };

  const svc = new TrafficSnapshotService({
    TrafficCorridor: {
      findAll: async () => [corridorRow],
    },
    TrafficCorridorSnapshot5m: {
      create: async (payload) => {
        createdPayload = payload;
        return {
          get: () => ({ ...payload, id: '00000000-0000-4000-8000-0000000000s1' }),
        };
      },
    },
    provider,
    trafficProviderConfigService: {
      getTomTomRuntimeOrThrow: async () => ({
        apiKey: 'k',
        baseUrl: 'https://api.tomtom.com/routing/1/calculateRoute',
        timeoutMs: 15000,
      }),
    },
  });

  const out = await svc.pollEnabledCorridors();
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, true);
  assert.ok(createdPayload);
  assert.equal(createdPayload.baselineTravelTimeMin, 10);
  assert.equal(createdPayload.currentTravelTimeMin, 50);
  assert.equal(createdPayload.delayMin, 40);
  const norm = createdPayload.rawPayloadJson.normalized;
  assert.equal(norm.providerStatus, 'warning');
  assert.ok(String(norm.providerErrorCode || '').includes('CURRENT_FAR_ABOVE_BASELINE'));
  assert.equal(norm.trafficDelaySeconds, 40 * 60);
});

test('pollEnabledCorridors: rejects invalid WGS84 before provider call', async () => {
  let calls = 0;
  const corridorRow = {
    id: '00000000-0000-4000-8000-0000000000c2',
    parkId: '00000000-0000-4000-8000-0000000000p1',
    name: 'Bad',
    originLat: 200,
    originLng: 5,
    destinationLat: 52.2,
    destinationLng: 5.2,
    direction: 'inbound',
    baselineTravelTimeMin: 10,
    weight: 1,
    enabled: true,
    update: async () => {},
    get: () => ({
      id: '00000000-0000-4000-8000-0000000000c2',
      parkId: '00000000-0000-4000-8000-0000000000p1',
      name: 'Bad',
      originLat: 200,
      originLng: 5,
      destinationLat: 52.2,
      destinationLng: 5.2,
      direction: 'inbound',
      baselineTravelTimeMin: 10,
      weight: 1,
      enabled: true,
    }),
  };

  const provider = {
    fetchRouteForCorridor: async () => {
      calls += 1;
      return { normalized: {}, providerRawResponse: {} };
    },
  };

  const svc = new TrafficSnapshotService({
    TrafficCorridor: { findAll: async () => [corridorRow] },
    TrafficCorridorSnapshot5m: { create: async () => ({ get: () => ({}) }) },
    provider,
    trafficProviderConfigService: {
      getTomTomRuntimeOrThrow: async () => ({
        apiKey: 'k',
        baseUrl: 'https://api.tomtom.com/routing/1/calculateRoute',
        timeoutMs: 15000,
      }),
    },
  });

  const out = await svc.pollEnabledCorridors();
  assert.equal(calls, 0);
  assert.equal(out.results[0].ok, false);
  assert.equal(out.results[0].error.code, 'COORD_WGS84_INVALID');
});
