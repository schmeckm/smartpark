'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAny, parseV1, parseV2, buildV1, buildV2, detectLayout } = require('./topic-layout.resolve');

test('parseV1 returns identity with level null', () => {
  const topic = 'tpuns/europa_park/v1/entities/blue_fire/queue_time';
  const id = parseV1(topic);
  assert.equal(id.layout, 'v1');
  assert.equal(id.parkSlug, 'europa_park');
  assert.equal(id.level, null);
  assert.equal(id.domain, 'entities');
  assert.equal(id.assetSlug, 'blue_fire');
  assert.equal(id.metric, 'queue_time');
  assert.equal(id.signalKey, 'entities.queue_time');
});

test('buildV1 roundtrips parseV1 for slug-safe segments', () => {
  const topic = 'tpuns/europa_park/v1/entities/blue_fire/queue_time';
  const id = parseV1(topic);
  const rebuilt = buildV1({
    parkSlug: id.parkSlug,
    domain: id.domain,
    assetSlug: id.assetSlug,
    metric: id.metric,
  });
  assert.equal(rebuilt, topic);
});

test('buildV1 slugifies like existing topic generator', () => {
  const topic = buildV1({
    parkSlug: 'Europa Park',
    domain: 'Queue Domain',
    assetSlug: 'Blue Fire',
    metric: 'Wait Time',
  });
  assert.equal(topic, 'tpuns/europa_park/v1/queue_domain/blue_fire/wait_time');
});

test('parseV2 returns identity with level and domain', () => {
  const topic = 'tpuns/europa_park/v1/rides/blue_fire/queue/wait_time_min';
  const id = parseV2(topic);
  assert.equal(id.layout, 'v2');
  assert.equal(id.parkSlug, 'europa_park');
  assert.equal(id.level, 'rides');
  assert.equal(id.assetSlug, 'blue_fire');
  assert.equal(id.domain, 'queue');
  assert.equal(id.metric, 'wait_time_min');
  assert.equal(id.signalKey, 'queue.wait_time_min');
});

test('buildV2 roundtrips parseV2', () => {
  const topic = 'tpuns/europa_park/v1/rides/blue_fire/operations/cycle_time_s';
  const id = parseV2(topic);
  const rebuilt = buildV2({
    parkSlug: id.parkSlug,
    level: id.level,
    assetSlug: id.assetSlug,
    domain: id.domain,
    metric: id.metric,
  });
  assert.equal(rebuilt, topic);
});

test('parseAny selects v2 when seven segments and known level', () => {
  const topic = 'tpuns/europa_park/v1/zones/zone_a/weather/temperature_c';
  const id = parseAny(topic);
  assert.equal(id.layout, 'v2');
  assert.equal(id.level, 'zones');
  assert.equal(id.domain, 'weather');
});

test('parseAny selects v1 for six segments', () => {
  const topic = 'tpuns/europa_park/v1/entities/blue_fire/queue_time';
  const id = parseAny(topic);
  assert.equal(id.layout, 'v1');
  assert.equal(id.domain, 'entities');
});

test('detectLayout returns null for non-tpuns', () => {
  assert.equal(detectLayout('park/x/y'), null);
});

test('parseAny throws for unsupported segment count', () => {
  assert.throws(() => parseAny('tpuns/europa_park/v1/a/b'), /unsupported segment count/i);
});

test('buildV2 rejects unsupported domain', () => {
  assert.throws(
    () =>
      buildV2({
        parkSlug: 'europa_park',
        level: 'rides',
        assetSlug: 'blue_fire',
        domain: 'unknown_domain',
        metric: 'x',
      }),
    /Unsupported domain/i
  );
});

test('buildV2 rejects unsupported level', () => {
  assert.throws(
    () =>
      buildV2({
        parkSlug: 'europa_park',
        level: 'attractions',
        assetSlug: 'blue_fire',
        domain: 'queue',
        metric: 'x',
      }),
    /Unsupported level/i
  );
});
