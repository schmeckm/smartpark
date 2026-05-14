import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSignalAvailability,
  computeReadiness,
  DEFAULT_FRESHNESS_MS,
} from './signal-availability-resolver.mjs';

const nowMs = Date.parse('2026-05-10T18:00:00.000Z');

test('LIVE_AVAILABLE when MQTT row within freshness', () => {
  const r = resolveSignalAvailability({
    nowMs,
    freshnessThresholdMs: DEFAULT_FRESHNESS_MS,
    assetSlug: 'arthur',
    signalCode: 'status',
    canonicalUnsTopic: 'tpuns/park/v1/rides/arthur/status',
    sparkplugMetricPreview: null,
    mqttLiveEvents: [
      {
        id: '1',
        receivedAt: '2026-05-10T17:59:30.000Z',
        metric: 'status',
        canonicalUnsTopic: 'tpuns/park/v1/rides/arthur/status',
        sparkplugTopic: 'spBv1.0/park/DDATA/e/arthur',
        value: 'OPERATING',
        quality: 'SIMULATED',
      },
    ],
    unsLatestStates: [],
    signalSource: 'MQTT_EDGE',
    required: false,
    enabled: true,
  });
  assert.equal(r.kind, 'LIVE_AVAILABLE');
  assert.ok(r.lastSeenIso);
});

test('LIVE_STALE when latest observation older than threshold', () => {
  const r = resolveSignalAvailability({
    nowMs,
    freshnessThresholdMs: DEFAULT_FRESHNESS_MS,
    assetSlug: 'arthur',
    signalCode: 'queue_time',
    canonicalUnsTopic: 'tpuns/park/v1/rides/arthur/queue_time',
    sparkplugMetricPreview: null,
    mqttLiveEvents: [
      {
        id: '1',
        receivedAt: '2026-05-10T17:58:00.000Z',
        metric: 'queue_time',
        canonicalUnsTopic: 'tpuns/park/v1/rides/arthur/queue_time',
        sparkplugTopic: 'x',
        value: 12,
        quality: 'GOOD',
      },
    ],
    unsLatestStates: [],
    signalSource: 'MQTT_EDGE',
    required: true,
    enabled: true,
  });
  assert.equal(r.kind, 'LIVE_STALE');
});

test('MISSING when realtime expected but no MQTT/UNS match', () => {
  const r = resolveSignalAvailability({
    nowMs,
    assetSlug: 'arthur',
    signalCode: 'status',
    canonicalUnsTopic: 'tpuns/park/v1/rides/arthur/status',
    sparkplugMetricPreview: null,
    mqttLiveEvents: [],
    unsLatestStates: [],
    signalSource: 'MQTT_EDGE',
    required: true,
    enabled: true,
  });
  assert.equal(r.kind, 'MISSING');
});

test('NOT_EXPECTED when source is NOT_AVAILABLE and buffer has no match', () => {
  const r = resolveSignalAvailability({
    nowMs,
    assetSlug: 'arthur',
    signalCode: 'status',
    canonicalUnsTopic: null,
    sparkplugMetricPreview: null,
    mqttLiveEvents: [],
    unsLatestStates: [],
    signalSource: 'NOT_AVAILABLE',
    required: false,
    enabled: true,
  });
  assert.equal(r.kind, 'NOT_EXPECTED');
});

test('LIVE_AVAILABLE when source is NOT_AVAILABLE but MQTT matches (observability)', () => {
  const r = resolveSignalAvailability({
    nowMs,
    freshnessThresholdMs: DEFAULT_FRESHNESS_MS,
    assetSlug: 'arthur',
    signalCode: 'status',
    canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/status',
    sparkplugMetricPreview: null,
    mqttLiveEvents: [
      {
        id: '1',
        receivedAt: '2026-05-10T17:59:30.000Z',
        metric: 'status',
        canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/status',
        sparkplugTopic: 'spBv1.0/europa_park/DDATA/welt_der_kinder/arthur',
        value: 'CLOSED',
        quality: 'SIMULATED',
      },
    ],
    unsLatestStates: [],
    signalSource: 'NOT_AVAILABLE',
    required: false,
    enabled: true,
  });
  assert.equal(r.kind, 'LIVE_AVAILABLE');
  assert.equal(r.lastValueDisplay, 'CLOSED');
});

test('computeReadiness: operational + realtime + ML warnings scope', () => {
  const rows = [
    {
      kind: 'LIVE_AVAILABLE',
      required: true,
      signalSource: 'MQTT_EDGE',
      useForMl: false,
      useForForecast: false,
    },
    {
      kind: 'MISSING',
      required: true,
      signalSource: 'MQTT_EDGE',
      useForMl: true,
      useForForecast: false,
    },
    {
      kind: 'NOT_EXPECTED',
      required: false,
      signalSource: 'MASTER_DATA',
      useForMl: true,
      useForForecast: true,
    },
  ];
  const x = computeReadiness(rows);
  assert.equal(x.operationalReady, false);
  assert.equal(x.realtimeHealthy, false);
  assert.equal(x.mlReady, false);
  assert.equal(x.forecastReady, true);
});
