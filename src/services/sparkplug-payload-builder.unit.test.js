'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupMetricsByDdataTopic, buildJsonPayload } = require('./sparkplug-payload-builder.service');

test('groupMetricsByDdataTopic merges metrics that share DDATA topic', () => {
  const rows = [
    {
      groupId: 'p1',
      edgeNodeId: 'park_gateway',
      deviceId: 'dev_a',
      name: 'rides/coaster/a',
      type: 'Float',
      value: 1,
      unit: 'm',
    },
    {
      groupId: 'p1',
      edgeNodeId: 'park_gateway',
      deviceId: 'dev_a',
      name: 'rides/coaster/b',
      type: 'Int32',
      value: 2,
      unit: null,
    },
    {
      groupId: 'p1',
      edgeNodeId: 'park_gateway',
      deviceId: 'dev_b',
      name: 'rides/other/x',
      type: 'String',
      value: 'ok',
      unit: null,
    },
  ];
  const map = groupMetricsByDdataTopic(rows);
  assert.equal(map.size, 2);
  for (const [, bundle] of map) {
    if (bundle.deviceId === 'dev_a') assert.equal(bundle.metrics.length, 2);
    if (bundle.deviceId === 'dev_b') assert.equal(bundle.metrics.length, 1);
  }
});

test('buildJsonPayload shapes MVP JSON', () => {
  const body = buildJsonPayload([{ name: 'rides/x/y', type: 'Float', value: 3.5, unit: 'min' }], {
    seq: 7,
    timestamp: 99,
  });
  assert.equal(body.seq, 7);
  assert.equal(body.timestamp, 99);
  assert.equal(body.metrics[0].name, 'rides/x/y');
});
