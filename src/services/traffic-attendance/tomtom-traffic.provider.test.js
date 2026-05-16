'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TomTomTrafficProvider, TomTomTrafficProviderError } = require('./tomtom-traffic.provider');

test('TomTomTrafficProvider: disabled throws TOMTOM_DISABLED', async () => {
  const p = new TomTomTrafficProvider({ apiKey: 'x' });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: false }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_DISABLED'
  );
});

test('TomTomTrafficProvider: missing API key throws TOMTOM_API_KEY_MISSING', async () => {
  const p = new TomTomTrafficProvider({ apiKey: '' });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: true }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_API_KEY_MISSING'
  );
});

test('TomTomTrafficProvider: invalid coordinates throws INVALID_COORDS', async () => {
  const fetchFn = async () => assert.fail('fetch should not run');
  const p = new TomTomTrafficProvider({ apiKey: 'abc', fetchFn });
  await assert.rejects(
    () =>
      p.fetchRouteForCorridor(
        { corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3 },
        { enabled: true }
      ),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'INVALID_COORDS'
  );
});

test('TomTomTrafficProvider: normalizes a valid TomTom JSON response', async () => {
  const body = {
    routes: [
      {
        summary: {
          lengthInMeters: 5000,
          travelTimeInSeconds: 600,
          trafficDelayInSeconds: 60,
          noTrafficTravelTimeInSeconds: 540,
        },
      },
    ],
  };
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });
  const p = new TomTomTrafficProvider({ apiKey: 'k', fetchFn });
  const out = await p.fetchRouteForCorridor(
    { corridorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', originLat: 48.4, originLng: 7.9, destinationLat: 48.5, destinationLng: 8.0 },
    { enabled: true }
  );
  assert.equal(out.normalized.provider, 'tomtom');
  assert.equal(out.normalized.providerStatus, 'ok');
  assert.equal(out.normalized.travelTimeSeconds, 600);
  assert.equal(out.normalized.trafficDelaySeconds, 60);
  assert.equal(out.normalized.noTrafficTravelTimeSeconds, 540);
  assert.equal(out.normalized.routeDistanceMeters, 5000);
  assert.ok(typeof out.normalized.delayPercent === 'number');
  assert.ok(out.providerRawResponse.routes);
});

test('TomTomTrafficProvider: HTTP 429 maps to TOMTOM_RATE_LIMIT', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({}),
  });
  const p = new TomTomTrafficProvider({ apiKey: 'k', fetchFn });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: true }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_RATE_LIMIT'
  );
});

test('TomTomTrafficProvider: malformed JSON body throws TOMTOM_MALFORMED', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => '{not-json',
  });
  const p = new TomTomTrafficProvider({ apiKey: 'k', fetchFn });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: true }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_MALFORMED'
  );
});

test('TomTomTrafficProvider: missing summary throws TOMTOM_MALFORMED', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ routes: [{}] }),
  });
  const p = new TomTomTrafficProvider({ apiKey: 'k', fetchFn });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: true }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_MALFORMED'
  );
});

test('TomTomTrafficProvider: HTTP error throws TOMTOM_HTTP', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ message: 'oops' }),
  });
  const p = new TomTomTrafficProvider({ apiKey: 'k', fetchFn });
  await assert.rejects(
    () => p.fetchRouteForCorridor({ corridorId: 'c', originLat: 1, originLng: 2, destinationLat: 3, destinationLng: 4 }, { enabled: true }),
    (e) => e instanceof TomTomTrafficProviderError && e.code === 'TOMTOM_HTTP'
  );
});
