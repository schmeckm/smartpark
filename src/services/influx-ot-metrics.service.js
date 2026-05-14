/**
 * Optional InfluxDB 2.x writer for numeric Sparkplug DDATA samples (OT historian path).
 * Writes only when value changes beyond epsilon (and optional min interval for heartbeats).
 */
'use strict';

const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const env = require('../config/env');
const { logger } = require('../utils/logger');

const MEASUREMENT = 'sparkplug_metric';

/** @type {Map<string, number>} */
const lastValueByKey = new Map();
/** @type {Map<string, number>} */
const lastWriteMsByKey = new Map();

const MAX_TRACKED_KEYS = 8000;

/** @type {InfluxDB | null} */
let client;
/** @type {import('@influxdata/influxdb-client').WriteApi | null} */
let writeApi;

function trackingKey(row) {
  const g = row.groupId != null ? String(row.groupId) : '';
  const d = row.deviceId != null ? String(row.deviceId) : '';
  const m = row.metric != null ? String(row.metric) : '';
  return `${g}\0${d}\0${m}`;
}

function pruneTrackingIfNeeded() {
  if (lastValueByKey.size <= MAX_TRACKED_KEYS) return;
  lastValueByKey.clear();
  lastWriteMsByKey.clear();
  logger.warn({ max: MAX_TRACKED_KEYS }, 'influx ot: cleared delta tracking map (size cap)');
}

function ensureWriteApi() {
  if (writeApi) return writeApi;
  if (!env.influxUrl || !env.influxToken || !env.influxOrg || !env.influxBucket) {
    throw new Error('Influx enabled but URL/token/org/bucket incomplete');
  }
  client = new InfluxDB({ url: env.influxUrl, token: env.influxToken });
  writeApi = client.getWriteApi(env.influxOrg, env.influxBucket, 'ms', {
    batchSize: 50,
    flushInterval: 2000,
    maxRetries: 1,
    maxRetryTime: 5000,
  });
  return writeApi;
}

/**
 * Fire-and-forget: append numeric DDATA row to Influx when enabled and delta rules pass.
 * @param {Record<string, unknown>} row - live buffer row (Sparkplug flattened)
 */
function maybeWriteSparkplugDdataRow(row) {
  if (!env.influxEnabled) return;
  const mt = String(row.messageType || '').toUpperCase();
  if (mt !== 'DDATA') return;
  const metric = row.metric != null ? String(row.metric) : '';
  if (!metric) return;
  const v = row.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) return;

  const k = trackingKey(row);
  const now = Date.now();
  const prev = lastValueByKey.get(k);
  const eps = env.influxFloatEpsilon;
  const minIv = env.influxMinWriteIntervalMs;

  if (prev != null && Math.abs(v - prev) <= eps) {
    if (!minIv) return;
    const lastAt = lastWriteMsByKey.get(k) || 0;
    if (now - lastAt < minIv) return;
  }

  lastValueByKey.set(k, v);
  lastWriteMsByKey.set(k, now);
  pruneTrackingIfNeeded();

  let tsMs = now;
  if (row.receivedAt) {
    const t = Date.parse(String(row.receivedAt));
    if (!Number.isNaN(t)) tsMs = t;
  }

  const point = new Point(MEASUREMENT)
    .tag('group_id', String(row.groupId || ''))
    .tag('edge_node_id', String(row.edgeNodeId || ''))
    .tag('device_id', String(row.deviceId || ''))
    .tag('metric', metric.slice(0, 160))
    .tag('quality', String(row.quality || ''))
    .floatField('value', v)
    .timestamp(tsMs);

  try {
    ensureWriteApi().writePoint(point);
  } catch (e) {
    logger.warn({ err: e.message }, 'influx ot: writePoint failed');
  }
}

/**
 * Flush pending batches (e.g. before process exit). Safe no-op if disabled.
 * @returns {Promise<void>}
 */
async function flushInfluxOtWrites() {
  if (!writeApi) return;
  try {
    await writeApi.close();
  } catch (e) {
    logger.warn({ err: e.message }, 'influx ot: writeApi close failed');
  }
  writeApi = null;
  client = null;
}

module.exports = {
  maybeWriteSparkplugDdataRow,
  flushInfluxOtWrites,
  /** @internal */
  _resetForTests() {
    lastValueByKey.clear();
    lastWriteMsByKey.clear();
    writeApi = null;
    client = null;
  },
};
