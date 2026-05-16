/**
 * Optional InfluxDB 2.x writer for numeric Sparkplug DDATA samples (OT historian path).
 * Writes only when value changes beyond epsilon (and optional min interval for heartbeats).
 */
'use strict';

const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const env = require('../config/env');
const { logger } = require('../utils/logger');

const MEASUREMENT = 'sparkplug_metric';
const ML_MEASUREMENT = 'ml_metric';

const STREAMING_GATE_TTL_MS = 45_000;
const INFLUX_STREAMING_SETTING_KEY = 'INFLUX_OT_STREAMING_ENABLED';

/** @type {{ active: boolean; checkedAt: number }} */
let streamingGate = { active: false, checkedAt: 0 };

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

/**
 * Reload platform setting gate (DB → ENV → default). Safe when DB is not ready yet.
 * @returns {Promise<boolean>}
 */
async function refreshInfluxStreamingGate() {
  if (!env.influxEnabled) {
    streamingGate = { active: false, checkedAt: Date.now() };
    return false;
  }
  try {
    const { getPlatformSettingsService } = require('./platform-settings.service');
    const on = await getPlatformSettingsService().getBoolean(INFLUX_STREAMING_SETTING_KEY, false);
    streamingGate = { active: on, checkedAt: Date.now() };
    return on;
  } catch (e) {
    logger.warn?.({ err: e?.message }, 'influx ot: streaming gate refresh failed');
    streamingGate = { active: false, checkedAt: Date.now() };
    return false;
  }
}

/** @returns {Promise<void>} */
async function warmupInfluxStreamingGate() {
  await refreshInfluxStreamingGate();
}

/**
 * True when Influx is configured (INFLUX_ENABLED) and platform setting allows streaming.
 */
function isInfluxStreamingActive() {
  if (!env.influxEnabled) return false;
  const age = Date.now() - streamingGate.checkedAt;
  if (age >= STREAMING_GATE_TTL_MS) {
    refreshInfluxStreamingGate().catch(() => {});
  }
  return streamingGate.active;
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
  if (!isInfluxStreamingActive()) return;
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
 * @param {unknown} n
 * @returns {n is number}
 */
function isFiniteMlNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Append a predictive-maintenance / ML output sample to Influx (`ml_metric` measurement).
 * No-op when Influx is disabled or inputs are invalid (NaN, Infinity, empty ids).
 *
 * @param {string} assetId - park asset UUID
 * @param {string} metricName - e.g. `predictive_anomaly_score`, `predictive_rul_days`
 * @param {number} value
 * @param {number|null} [confidence] - optional 0–1 confidence
 */
function writeMlMetricPoint(assetId, metricName, value, confidence = null) {
  if (!isInfluxStreamingActive()) return;

  const aid = assetId != null ? String(assetId).trim() : '';
  const metric = metricName != null ? String(metricName).trim() : '';
  if (!aid || !metric) return;
  if (!isFiniteMlNumber(value)) return;

  const point = new Point(ML_MEASUREMENT)
    .tag('asset_id', aid.slice(0, 160))
    .tag('metric', metric.slice(0, 160))
    .floatField('value', value)
    .timestamp(Date.now());

  if (confidence != null && isFiniteMlNumber(confidence)) {
    point.floatField('confidence', confidence);
  }

  try {
    ensureWriteApi().writePoint(point);
  } catch (e) {
    logger.warn({ err: e.message, assetId: aid, metric }, 'influx ml: writePoint failed');
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
  writeMlMetricPoint,
  flushInfluxOtWrites,
  refreshInfluxStreamingGate,
  warmupInfluxStreamingGate,
  isInfluxStreamingActive,
  INFLUX_STREAMING_SETTING_KEY,
  /** @internal */
  _resetForTests() {
    lastValueByKey.clear();
    lastWriteMsByKey.clear();
    writeApi = null;
    client = null;
    streamingGate = { active: false, checkedAt: 0 };
  },
  /** @internal */
  _setInfluxStreamingGateForTests(active) {
    streamingGate = { active: Boolean(active), checkedAt: Date.now() };
  },
};
