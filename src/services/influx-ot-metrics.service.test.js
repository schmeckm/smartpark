'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

beforeEach(() => {
  delete process.env.INFLUX_ENABLED;
});

test('maybeWriteSparkplugDdataRow is no-op when INFLUX_ENABLED is not set', () => {
  const { maybeWriteSparkplugDdataRow, _resetForTests } = proxyquire('./influx-ot-metrics.service', {
    '../config/env': {
      influxEnabled: false,
      influxUrl: '',
      influxToken: '',
      influxOrg: 'smartpark',
      influxBucket: 'ot_metrics',
      influxFloatEpsilon: 1e-9,
      influxMinWriteIntervalMs: 0,
    },
    '../utils/logger': { logger: { warn() {} } },
  });
  _resetForTests();
  maybeWriteSparkplugDdataRow({
    messageType: 'DDATA',
    metric: 'temp',
    value: 42,
    groupId: 'g',
    edgeNodeId: 'e',
    deviceId: 'd',
    receivedAt: new Date().toISOString(),
  });
});

test('maybeWriteSparkplugDdataRow skips non-DDATA', () => {
  let writes = 0;
  const { maybeWriteSparkplugDdataRow, _resetForTests, _setInfluxStreamingGateForTests } = proxyquire(
    './influx-ot-metrics.service',
    {
    '../config/env': {
      influxEnabled: true,
      influxUrl: 'http://localhost:8086',
      influxToken: 't',
      influxOrg: 'o',
      influxBucket: 'b',
      influxFloatEpsilon: 0,
      influxMinWriteIntervalMs: 0,
    },
    '../utils/logger': { logger: { warn() {} } },
    '@influxdata/influxdb-client': {
      InfluxDB: class {
        getWriteApi() {
          return {
            writePoint() {
              writes += 1;
            },
            close: async () => {},
          };
        }
      },
      Point: class {
        constructor() {
          this._tags = [];
        }
        tag() {
          return this;
        }
        floatField() {
          return this;
        }
        timestamp() {
          return this;
        }
      },
    },
  });
  _resetForTests();
  _setInfluxStreamingGateForTests(true);
  maybeWriteSparkplugDdataRow({
    messageType: 'NBIRTH',
    metric: 'x',
    value: 1,
    groupId: 'g',
    edgeNodeId: 'e',
    deviceId: 'd',
    receivedAt: new Date().toISOString(),
  });
  assert.equal(writes, 0);
});

test('maybeWriteSparkplugDdataRow is no-op when platform streaming gate is off', () => {
  let writes = 0;
  const { maybeWriteSparkplugDdataRow, _resetForTests, _setInfluxStreamingGateForTests } = proxyquire(
    './influx-ot-metrics.service',
    {
      '../config/env': {
        influxEnabled: true,
        influxUrl: 'http://localhost:8086',
        influxToken: 't',
        influxOrg: 'o',
        influxBucket: 'b',
        influxFloatEpsilon: 0,
        influxMinWriteIntervalMs: 0,
      },
      '../utils/logger': { logger: { warn() {} } },
      '@influxdata/influxdb-client': {
        InfluxDB: class {
          getWriteApi() {
            return { writePoint() { writes += 1; }, close: async () => {} };
          }
        },
        Point: class {
          tag() { return this; }
          floatField() { return this; }
          timestamp() { return this; }
        },
      },
    }
  );
  _resetForTests();
  _setInfluxStreamingGateForTests(false);
  maybeWriteSparkplugDdataRow({
    messageType: 'DDATA',
    metric: 'temp',
    value: 42,
    groupId: 'g',
    edgeNodeId: 'e',
    deviceId: 'd',
    receivedAt: new Date().toISOString(),
  });
  assert.equal(writes, 0);
});

test('writeMlMetricPoint is no-op when INFLUX_ENABLED is not set', () => {
  let writes = 0;
  const { writeMlMetricPoint, _resetForTests } = proxyquire('./influx-ot-metrics.service', {
    '../config/env': {
      influxEnabled: false,
      influxUrl: '',
      influxToken: '',
      influxOrg: 'smartpark',
      influxBucket: 'ot_metrics',
      influxFloatEpsilon: 1e-9,
      influxMinWriteIntervalMs: 0,
    },
    '../utils/logger': { logger: { warn() {} } },
    '@influxdata/influxdb-client': {
      InfluxDB: class {
        getWriteApi() {
          return { writePoint() { writes += 1; }, close: async () => {} };
        }
      },
      Point: class {
        tag() { return this; }
        floatField() { return this; }
        timestamp() { return this; }
      },
    },
  });
  _resetForTests();
  writeMlMetricPoint('asset-1', 'predictive_anomaly_score', 0.42, 0.9);
  assert.equal(writes, 0);
});

test('writeMlMetricPoint skips NaN, Infinity, and empty ids', () => {
  let writes = 0;
  const { writeMlMetricPoint, _resetForTests, _setInfluxStreamingGateForTests } = proxyquire(
    './influx-ot-metrics.service',
    {
    '../config/env': {
      influxEnabled: true,
      influxUrl: 'http://localhost:8086',
      influxToken: 't',
      influxOrg: 'o',
      influxBucket: 'ot_metrics',
      influxFloatEpsilon: 1e-9,
      influxMinWriteIntervalMs: 0,
    },
    '../utils/logger': { logger: { warn() {} } },
    '@influxdata/influxdb-client': {
      InfluxDB: class {
        getWriteApi() {
          return { writePoint() { writes += 1; }, close: async () => {} };
        }
      },
      Point: class {
        tag() { return this; }
        floatField() { return this; }
        timestamp() { return this; }
      },
    },
  });
  _resetForTests();
  _setInfluxStreamingGateForTests(true);
  writeMlMetricPoint('', 'predictive_anomaly_score', 0.5);
  writeMlMetricPoint('a1', 'predictive_anomaly_score', NaN);
  writeMlMetricPoint('a1', 'predictive_anomaly_score', Infinity);
  writeMlMetricPoint('a1', '', 0.5);
  assert.equal(writes, 0);
});

test('writeMlMetricPoint writes ml_metric with value and optional confidence', () => {
  /** @type {Array<{ measurement: string; tags: Record<string, string>; fields: Record<string, number> }>} */
  const captured = [];
  const { writeMlMetricPoint, _resetForTests, _setInfluxStreamingGateForTests } = proxyquire(
    './influx-ot-metrics.service',
    {
    '../config/env': {
      influxEnabled: true,
      influxUrl: 'http://localhost:8086',
      influxToken: 't',
      influxOrg: 'o',
      influxBucket: 'ot_metrics',
      influxFloatEpsilon: 1e-9,
      influxMinWriteIntervalMs: 0,
    },
    '../utils/logger': { logger: { warn() {} } },
    '@influxdata/influxdb-client': {
      InfluxDB: class {
        getWriteApi() {
          return {
            writePoint(p) {
              captured.push(p);
            },
            close: async () => {},
          };
        }
      },
      Point: class {
        constructor(name) {
          this._name = name;
          this._tags = {};
          this._fields = {};
        }
        tag(k, v) {
          this._tags[k] = v;
          return this;
        }
        floatField(k, v) {
          this._fields[k] = v;
          return this;
        }
        timestamp() {
          return this;
        }
      },
    },
  });
  _resetForTests();
  _setInfluxStreamingGateForTests(true);
  writeMlMetricPoint('550e8400-e29b-41d4-a716-446655440000', 'predictive_rul_days', 120.5, 0.65);
  writeMlMetricPoint('550e8400-e29b-41d4-a716-446655440000', 'predictive_anomaly_score', 0.31, NaN);

  assert.equal(captured.length, 2);
  assert.equal(captured[0]._name, 'ml_metric');
  assert.equal(captured[0]._tags.asset_id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(captured[0]._tags.metric, 'predictive_rul_days');
  assert.equal(captured[0]._fields.value, 120.5);
  assert.equal(captured[0]._fields.confidence, 0.65);
  assert.equal(captured[1]._fields.value, 0.31);
  assert.equal(captured[1]._fields.confidence, undefined);
});
