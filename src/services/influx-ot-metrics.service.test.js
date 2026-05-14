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
  const { maybeWriteSparkplugDdataRow, _resetForTests } = proxyquire('./influx-ot-metrics.service', {
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
