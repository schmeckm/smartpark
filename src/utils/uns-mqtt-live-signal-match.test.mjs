/**
 * Contract: Asset master-data „Signale“ ↔ UNS Live buffer (same matching as telemetry side panel).
 *
 * Fixtures mirror live shapes: Sparkplug DDATA for ride `arthur`, canonical tpuns topics, metric names.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMatchingLiveEvents } from './uns-mqtt-live-signal-match.mjs';

/** Typical UNS Live rows when filtering „Arthur“ (screenshot: europa_park / welt_der_kinder / arthur). */
function arthurBufferFixture() {
  const base = '2026-05-09T20:03:15.000Z';
  return [
    {
      id: 'ev-1',
      timestamp: base,
      receivedAt: '2026-05-09T20:03:15.100Z',
      source: 'parks_wiki',
      messageType: 'DDATA',
      sparkplugTopic: 'spBv1.0/europa_park/DDATA/welt_der_kinder/arthur',
      groupId: 'europa_park',
      edgeNodeId: 'welt_der_kinder',
      deviceId: 'arthur',
      metric: 'queue_time',
      value: 25,
      quality: 'SIMULATED',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/queue_time',
      payloadPreview: '{"name":"queue_time","value":25}',
    },
    {
      id: 'ev-2',
      timestamp: base,
      receivedAt: '2026-05-09T20:03:14.050Z',
      source: 'parks_wiki',
      messageType: 'DDATA',
      sparkplugTopic: 'spBv1.0/europa_park/DDATA/welt_der_kinder/arthur',
      groupId: 'europa_park',
      edgeNodeId: 'welt_der_kinder',
      deviceId: 'arthur',
      metric: 'status',
      value: 'OPERATING',
      quality: 'SIMULATED',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/status',
      payloadPreview: '{"name":"status","value":"OPERATING"}',
    },
    {
      id: 'ev-3',
      timestamp: base,
      receivedAt: '2026-05-09T20:03:10.000Z',
      source: 'parks_wiki',
      messageType: 'DDATA',
      sparkplugTopic: 'spBv1.0/europa_park/DDATA/other_zone/other_ride',
      groupId: 'europa_park',
      edgeNodeId: 'other_zone',
      deviceId: 'other_ride',
      metric: 'throughput',
      value: 120,
      quality: 'SIMULATED',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/other_ride/throughput',
      payloadPreview: '{}',
    },
  ];
}

test('collectMatchingLiveEvents: matches queue_time by canonical UNS topic (Arthur)', () => {
  const events = arthurBufferFixture();
  const signal = {
    signalCode: 'queue_time',
    unsTopicPreview: 'tpuns/europa_park/v1/rides/arthur/queue_time',
    sparkplugMetricPreview: null,
  };
  const got = collectMatchingLiveEvents(signal, events);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'ev-1');
  assert.equal(got[0].value, 25);
});

test('collectMatchingLiveEvents: matches status by metric name when UNS preview empty', () => {
  const events = arthurBufferFixture();
  const signal = {
    signalCode: 'status',
    unsTopicPreview: '',
    sparkplugMetricPreview: '',
  };
  const got = collectMatchingLiveEvents(signal, events);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'ev-2');
  assert.equal(got[0].canonicalUnsTopic, 'tpuns/europa_park/v1/rides/arthur/status');
});

test('collectMatchingLiveEvents: rideAssetSlug scopes metric-only match to one ride', () => {
  const events = [
    ...arthurBufferFixture(),
    {
      id: 'ev-other-status',
      receivedAt: '2026-05-09T20:03:11.000Z',
      source: 'parks_wiki',
      messageType: 'DDATA',
      sparkplugTopic: 'spBv1.0/europa_park/DDATA/other_zone/other_ride',
      deviceId: 'other_ride',
      metric: 'status',
      value: 'CLOSED',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/other_ride/status',
      quality: 'SIMULATED',
      payloadPreview: '{}',
    },
  ];
  const signal = {
    signalCode: 'status',
    unsTopicPreview: '',
    sparkplugMetricPreview: '',
  };
  const unscoped = collectMatchingLiveEvents(signal, events);
  assert.equal(unscoped.length, 2);
  const arthurOnly = collectMatchingLiveEvents(signal, events, { rideAssetSlug: 'arthur' });
  assert.equal(arthurOnly.length, 1);
  assert.equal(arthurOnly[0].deviceId, 'arthur');
});

test('collectMatchingLiveEvents: distinct canonical UNS paths isolate rides (same metric name possible)', () => {
  const events = [
    ...arthurBufferFixture(),
    {
      id: 'ev-other-q',
      receivedAt: '2026-05-09T20:03:09.000Z',
      source: 'parks_wiki',
      messageType: 'DDATA',
      sparkplugTopic: 'spBv1.0/europa_park/DDATA/other_zone/other_ride',
      deviceId: 'other_ride',
      metric: 'queue_time',
      value: 99,
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/other_ride/queue_time',
      quality: 'SIMULATED',
      payloadPreview: '{}',
    },
  ];
  const signalArthur = {
    signalCode: 'queue_time',
    unsTopicPreview: 'tpuns/europa_park/v1/rides/arthur/queue_time',
    sparkplugMetricPreview: null,
  };
  const arthurMatches = collectMatchingLiveEvents(signalArthur, events);
  assert.equal(arthurMatches.length, 1);
  assert.equal(arthurMatches[0].deviceId, 'arthur');

  const signalOther = {
    signalCode: 'queue_time',
    unsTopicPreview: 'tpuns/europa_park/v1/rides/other_ride/queue_time',
    sparkplugMetricPreview: null,
  };
  const otherMatches = collectMatchingLiveEvents(signalOther, events);
  assert.equal(otherMatches.length, 1);
  assert.equal(otherMatches[0].deviceId, 'other_ride');
});

test('collectMatchingLiveEvents: Sparkplug path tail match when previews use metric segment', () => {
  const events = arthurBufferFixture();
  const signal = {
    signalCode: 'actual_dispatch_interval_sec',
    unsTopicPreview: '',
    sparkplugMetricPreview: 'rides/arthur/actual_dispatch_interval_sec',
  };
  const synthetic = {
    id: 'ev-sp',
    timestamp: '2026-05-09T20:05:00.000Z',
    receivedAt: '2026-05-09T20:05:00.100Z',
    source: 'parks_wiki',
    messageType: 'DDATA',
    sparkplugTopic: 'spBv1.0/europa_park/DDATA/welt_der_kinder/arthur',
    metric: 'actual_dispatch_interval_sec',
    value: 42,
    canonicalUnsTopic: null,
    quality: 'SIMULATED',
    payloadPreview: '{}',
  };
  const got = collectMatchingLiveEvents(signal, [...events, synthetic]);
  assert.ok(got.some((r) => r.id === 'ev-sp'));
});

test('collectMatchingLiveEvents: sorts newest receivedAt first', () => {
  const events = [
    {
      id: 'old',
      receivedAt: '2026-05-09T20:01:00.000Z',
      metric: 'queue_time',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/queue_time',
    },
    {
      id: 'new',
      receivedAt: '2026-05-09T20:03:00.000Z',
      metric: 'queue_time',
      canonicalUnsTopic: 'tpuns/europa_park/v1/rides/arthur/queue_time',
    },
  ];
  const signal = {
    signalCode: 'queue_time',
    unsTopicPreview: 'tpuns/europa_park/v1/rides/arthur/queue_time',
  };
  const got = collectMatchingLiveEvents(signal, events);
  assert.deepEqual(
    got.map((x) => x.id),
    ['new', 'old']
  );
});
