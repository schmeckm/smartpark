/**
 * In-memory buffer of flattened MQTT events for UNS Live (no DB).
 * - Sparkplug: `spBv1.0/...` JSON payloads (metrics array).
 * - TPUNS: `tpuns/.../v1/...` JSON payloads (UNS_JSON / adapter preview publish).
 * Filled from the MQTT `message` handler and from same-process `publish` callbacks
 * (Mosquitto often still delivers self-echo; short dedupe avoids duplicate rows).
 */

const { randomUUID } = require('node:crypto');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { emitUnsMqttLiveEvents } = require('../sockets');
const { maybeWriteSparkplugDdataRow } = require('./influx-ot-metrics.service');
const { buildCanonicalUnsTopic, slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const {
  getRegisteredEntityRowForSparkplugLookup,
  registerFromSparkplugDbirthMetric,
} = require('../modules/uns/theme-parks-entity-domain.service');
const { Park } = require('../models');

const MAX_EVENTS = 1000;
const RATE_WINDOW_MS = 1000;

/** Last numeric queue_time per park+device (for delta in UNS Live). */
const lastQueueTimeByParkDevice = new Map();

const events = [];
const recentReceiveTicks = [];

/** topic + payload → last ingest time (dedupe self-echo vs local publish hook). */
const DEDUPE_MS = 500;
const recentPayloadKeys = new Map();

function pruneDedupeKeys(now) {
  for (const [k, t] of recentPayloadKeys) {
    if (now - t > DEDUPE_MS * 15) recentPayloadKeys.delete(k);
  }
  if (recentPayloadKeys.size > 600) {
    let drop = recentPayloadKeys.size - 300;
    const iter = recentPayloadKeys.keys();
    while (drop-- > 0) {
      const n = iter.next();
      if (n.done) break;
      recentPayloadKeys.delete(n.value);
    }
  }
}

/**
 * UNS Live canonical segment: ThemeParks entity registry only (integration / sync / DBIRTH-enriched).
 * DDATA `entity_type` metric is not used — it often carries a domain slug and can disagree with fachlicher entityType.
 */
function resolveCanonicalDomainForLiveRow(base) {
  if (!base.deviceId) return 'entities';
  const row = getRegisteredEntityRowForSparkplugLookup(base.groupId, base.deviceId);
  if (row?.domain) return row.domain;
  return 'entities';
}

/** ThemeParks / demo vs field PLC / industrial MQTT. */
function resolveLiveQuality(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('themeparks_wiki')) return 'SIMULATED';
  if (s.includes('simulator') || s.includes('attraction_oee')) return 'SIMULATED';
  if (/(^|[_\s])(plc|opcua|opc_ua|rockwell|siemens|allen_bradley|modbus)([_\s]|$)/i.test(s)) return 'GOOD';
  return 'GOOD';
}

function formatQueueValueDisplay(current, delta) {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return String(current);
  if (delta === 0) return `${current} → ±0`;
  if (delta > 0) return `${current} → ▲ +${delta}`;
  return `${current} → ▼ ${Math.abs(delta)}`;
}

function parseSparkplugTopic(topic) {
  const p = String(topic).split('/').filter(Boolean);
  if (p[0] !== 'spBv1.0' || p.length < 4) return null;
  return {
    groupId: p[1],
    messageType: p[2],
    edgeNodeId: p[3],
    deviceId: p.length >= 5 ? p[4] : null,
    sparkplugTopic: String(topic),
  };
}

function truncate(str, n = 240) {
  const s = String(str ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * @returns {Array<Record<string, unknown>>}
 */
function flattenSparkplugMqttMessage(topic, bodyStr) {
  const base = parseSparkplugTopic(topic);
  if (!base) return [];
  let obj = null;
  try {
    obj = JSON.parse(bodyStr);
  } catch {
    obj = null;
  }
  const receivedAt = new Date().toISOString();
  const tags = obj?.tags && typeof obj.tags === 'object' ? obj.tags : {};
  const source = tags.source != null ? String(tags.source) : 'mqtt_sparkplug';
  const rowQuality = resolveLiveQuality(source);
  const ts = obj?.timestamp != null ? String(obj.timestamp) : receivedAt;
  const metrics = Array.isArray(obj?.metrics) ? obj.metrics : [];

  if (String(base.messageType || '').toUpperCase() === 'DBIRTH' && base.groupId && base.deviceId) {
    const entM = metrics.find((x) => x?.name === 'entity_type');
    if (entM?.value != null) {
      registerFromSparkplugDbirthMetric({
        groupId: base.groupId,
        deviceId: base.deviceId,
        domainSegment: String(entM.value),
      });
    }
  }

  if (!metrics.length) {
    return [
      {
        id: randomUUID(),
        timestamp: ts,
        receivedAt,
        source,
        messageType: base.messageType,
        sparkplugTopic: base.sparkplugTopic,
        groupId: base.groupId,
        edgeNodeId: base.edgeNodeId,
        deviceId: base.deviceId,
        metric: null,
        value: truncate(bodyStr, 400),
        valueDisplay: null,
        queueDelta: null,
        quality: rowQuality,
        unsDomain: null,
        canonicalUnsTopic: null,
        payloadPreview: truncate(bodyStr),
      },
    ];
  }

  const rows = [];
  for (const m of metrics) {
    const name = m?.name != null ? String(m.name) : null;
    const entDomain = resolveCanonicalDomainForLiveRow(base);
    const canonicalUnsTopic =
      base.groupId && base.deviceId && name
        ? buildCanonicalUnsTopic({
            parkSlug: String(base.groupId),
            entityType: entDomain,
            entitySlug: String(base.deviceId),
            metric: name,
          })
        : null;

    let queueDelta = null;
    let valueDisplay = null;
    const rawVal = m?.value;
    if (name === 'queue_time' && base.groupId && base.deviceId && typeof rawVal === 'number' && Number.isFinite(rawVal)) {
      const qk = `${base.groupId}:${base.deviceId}`;
      const prevQ = lastQueueTimeByParkDevice.get(qk);
      lastQueueTimeByParkDevice.set(qk, rawVal);
      if (typeof prevQ === 'number' && Number.isFinite(prevQ)) {
        queueDelta = rawVal - prevQ;
        valueDisplay = formatQueueValueDisplay(rawVal, queueDelta);
      }
    }

    rows.push({
      id: randomUUID(),
      timestamp: ts,
      receivedAt,
      source,
      messageType: base.messageType,
      sparkplugTopic: base.sparkplugTopic,
      groupId: base.groupId,
      edgeNodeId: base.edgeNodeId,
      deviceId: base.deviceId,
      metric: name,
      value: rawVal,
      valueDisplay,
      queueDelta,
      quality: rowQuality,
      unsDomain: entDomain,
      canonicalUnsTopic,
      payloadPreview: truncate(JSON.stringify(m)),
    });
  }
  return rows;
}

/**
 * One row per tpuns/{park}/v1/{domain}/{asset}/{metric} message (UNS_JSON adapter output).
 * @returns {Array<Record<string, unknown>>}
 */
function flattenTpunsMqttMessage(topic, bodyStr) {
  let payload;
  try {
    payload = JSON.parse(bodyStr);
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = parseTopic(topic);
  } catch {
    return [];
  }
  const receivedAt = new Date().toISOString();
  const ts = payload?.ts != null ? String(payload.ts) : receivedAt;
  const source = payload?.source != null ? String(payload.source) : 'mqtt_tpuns';
  const rowQuality = resolveLiveQuality(source);
  const groupId = slugifyName(parsed.parkSlug);
  const canonicalUnsTopic = String(topic);

  return [
    {
      id: randomUUID(),
      timestamp: ts,
      receivedAt,
      source,
      messageType: 'UNS_JSON',
      sparkplugTopic: canonicalUnsTopic,
      groupId,
      edgeNodeId: parsed.domain,
      deviceId: parsed.assetSlug,
      metric: parsed.metric,
      value: payload?.value,
      valueDisplay: null,
      queueDelta: null,
      quality: rowQuality,
      unsDomain: parsed.domain,
      canonicalUnsTopic,
      payloadPreview: truncate(bodyStr),
    },
  ];
}

function bumpRateMeter() {
  const now = Date.now();
  recentReceiveTicks.push(now);
  while (recentReceiveTicks.length && recentReceiveTicks[0] < now - RATE_WINDOW_MS) {
    recentReceiveTicks.shift();
  }
}

function ingestLiveRows(topic, bodyStr, rows) {
  if (!rows || !rows.length) return;
  const now = Date.now();
  const dedupeKey = `${String(topic)}\0${bodyStr}`;
  const prev = recentPayloadKeys.get(dedupeKey);
  if (prev != null && now - prev < DEDUPE_MS) return;
  recentPayloadKeys.set(dedupeKey, now);
  pruneDedupeKeys(now);

  for (const row of rows) {
    events.push(row);
    maybeWriteSparkplugDdataRow(row);
  }
  while (events.length > MAX_EVENTS) {
    events.shift();
  }
  bumpRateMeter();
  try {
    emitUnsMqttLiveEvents({ events: rows });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit uns:mqtt:live:events skipped');
  }
}

/**
 * @param {string} topic
 * @param {Buffer|string} messageBuffer
 */
function appendFromMqtt(topic, messageBuffer) {
  const bodyStr = Buffer.isBuffer(messageBuffer) ? messageBuffer.toString('utf8') : String(messageBuffer);
  ingestLiveRows(topic, bodyStr, flattenSparkplugMqttMessage(topic, bodyStr));
}

/**
 * @param {string} topic
 * @param {Buffer|string} messageBuffer
 */
function appendTpunsLiveFromMqtt(topic, messageBuffer) {
  const bodyStr = Buffer.isBuffer(messageBuffer) ? messageBuffer.toString('utf8') : String(messageBuffer);
  ingestLiveRows(topic, bodyStr, flattenTpunsMqttMessage(topic, bodyStr));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Master-data / ride payloads pass internal park UUIDs; UNS Live URLs often use slug.
 * Resolve UUID → park.slug so buffer filtering matches Sparkplug `groupId` (e.g. europa_park).
 *
 * @param {string} parkIdUrlParam
 * @returns {Promise<string>}
 */
async function resolveParkKeyForMqttLiveBufferParam(parkIdUrlParam) {
  const raw = String(parkIdUrlParam || '').trim();
  if (!raw || !UUID_RE.test(raw)) return raw;
  try {
    const park = await Park.findByPk(raw, { attributes: ['slug', 'name'] });
    if (!park) return raw;
    const slug = park.slug != null ? String(park.slug).trim() : '';
    if (slug) return slug;
    return slugifyName(park.name != null ? String(park.name) : '');
  } catch {
    return raw;
  }
}

/**
 * Same as {@link resolveBufferGroupIdForMqttLiveUrlParam} after resolving internal park UUID to slug when needed.
 *
 * @param {string} parkIdUrlParam
 * @returns {Promise<string>}
 */
async function resolveBufferGroupIdForMqttLiveUrlParamAsync(parkIdUrlParam) {
  const parkKey = await resolveParkKeyForMqttLiveBufferParam(parkIdUrlParam);
  return resolveBufferGroupIdForMqttLiveUrlParam(parkKey);
}

/**
 * Sparkplug group segment for UNS Live filtering — must match `sparkplugRouting` in
 * `attraction-oee-simulator.service.js` (SPARKPLUG_GROUP_ID overrides slugified park key from the URL).
 * @param {string} parkIdUrlParam - e.g. `europa_park` from `/uns/parks/:parkId/mqtt-live/...`
 * @returns {string}
 */
function resolveBufferGroupIdForMqttLiveUrlParam(parkIdUrlParam) {
  const fromEnv = env.sparkplugGroupId && String(env.sparkplugGroupId).trim();
  const base = fromEnv || slugifyName(parkIdUrlParam);
  return String(base).toLowerCase();
}

function getSnapshot({ groupId, limit = 500 }) {
  const gid = String(groupId || '').toLowerCase();
  const lim = Math.min(2000, Math.max(1, Number(limit) || 500));
  const filtered = events.filter((e) => String(e.groupId || '').toLowerCase() === gid);
  return filtered.slice(-lim).reverse();
}

function getStats() {
  const now = Date.now();
  while (recentReceiveTicks.length && recentReceiveTicks[0] < now - RATE_WINDOW_MS) {
    recentReceiveTicks.shift();
  }
  const last = events.length ? events[events.length - 1] : null;
  return {
    bufferSize: events.length,
    eventsPerSec: recentReceiveTicks.length,
    lastEventTime: last ? last.receivedAt : null,
  };
}

function getSparkplugSubscribePatterns({ advanced = false } = {}) {
  const base = ['spBv1.0/+/DDATA/+/+', 'spBv1.0/+/DBIRTH/+/+', 'spBv1.0/+/DDEATH/+/+'];
  if (!advanced) return base;
  return [
    ...base,
    'spBv1.0/+/NBIRTH/+',
    'spBv1.0/+/NDEATH/+',
    'spBv1.0/+/NCMD/+',
    'spBv1.0/+/DCMD/+/+',
    'spBv1.0/+/STATE/+',
  ];
}

/**
 * Scan newest-first over the in-memory UNS / Sparkplug live buffer (read-only).
 * @param {(row: Record<string, unknown>) => boolean} predicate
 * @param {{ maxScan?: number }} [opts]
 * @returns {Record<string, unknown> | null}
 */
function findLatestLiveRow(predicate, opts = {}) {
  const maxScan = Math.min(8000, Math.max(1, Number(opts.maxScan) || 4000));
  let scanned = 0;
  for (let i = events.length - 1; i >= 0 && scanned < maxScan; i -= 1, scanned += 1) {
    const row = events[i];
    if (predicate(row)) return row;
  }
  return null;
}

/** @param {string} canonicalTpunsTopicPath */
function findLatestTpunsLiveRowForTopic(canonicalTpunsTopicPath) {
  const want = String(canonicalTpunsTopicPath || '');
  return findLatestLiveRow((e) => e.messageType === 'UNS_JSON' && String(e.canonicalUnsTopic || '') === want);
}

/**
 * @param {{ groupId: string; edgeNodeId: string; deviceId: string; metricName: string }} p
 */
function findLatestSparkplugLiveMetricRow(p) {
  const g = String(p.groupId || '').toLowerCase();
  const edge = String(p.edgeNodeId || '');
  const dev = String(p.deviceId || '');
  const m = String(p.metricName || '');
  return findLatestLiveRow(
    (e) =>
      String(e.messageType || '').toUpperCase() !== 'UNS_JSON' &&
      String(e.groupId || '').toLowerCase() === g &&
      String(e.edgeNodeId || '') === edge &&
      String(e.deviceId || '') === dev &&
      String(e.metric || '') === m
  );
}

/**
 * Find latest Sparkplug live metric matching ride context — resolves edge node (zone-aware), then probes legacy edges and device id variants.
 *
 * @param {{ parkSlug: string; parkId: string | null | undefined; assetId: string; assetSlug?: string | null }} ctx
 * @param {string} signalCode metric name / signal catalog code
 */
async function probeSparkplugLiveMetricForRide(ctx, signalCode) {
  const { resolveSparkplugEdgeNodeForAsset } = require('./sparkplug-edge-resolver.service');
  const { sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
  const groupId =
    (env.sparkplugGroupId && String(env.sparkplugGroupId).trim()) || slugifyName(ctx.parkSlug);

  let primaryEdge = String(env.sparkplugEdgeNode || 'park_gateway').trim();
  try {
    const er = await resolveSparkplugEdgeNodeForAsset({
      parkId: ctx.parkId ?? null,
      parkSlug: ctx.parkSlug,
      assetId: ctx.assetId,
      assetSlug: ctx.assetSlug,
    });
    if (er?.edgeNodeId) primaryEdge = String(er.edgeNodeId).trim();
  } catch (_) {
    /* resolver failure — keep env */
  }

  const edgeCandidates = [
    ...new Set(
      [primaryEdge, ...(env.sparkplugEdgeNode ? [String(env.sparkplugEdgeNode).trim()] : []), 'park_gateway']
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    ),
  ];

  const slugSeg = ctx.assetSlug ? slugifyName(String(ctx.assetSlug)) : '';
  const idSeg = sparkplugDeviceTopicSegment(ctx.assetId);
  const rawId = ctx.assetId != null ? String(ctx.assetId) : '';
  const deviceCandidates = [...new Set([slugSeg, idSeg, rawId].filter(Boolean))];

  for (const edgeNodeId of edgeCandidates) {
    for (const deviceId of deviceCandidates) {
      const row = findLatestSparkplugLiveMetricRow({
        groupId,
        edgeNodeId,
        deviceId,
        metricName: signalCode,
      });
      if (row && row.value !== undefined && row.value !== null) {
        return { row, edgeNodeId, deviceId, groupId };
      }
    }
  }
  return null;
}

/**
 * Unique Sparkplug metric names recently seen for any of the given device IDs (same buffer as PdM / OEE).
 * Scans newest-first; first hit per (deviceId, metric) wins (most recent sample).
 *
 * @param {{ groupId: string; edgeNodeId: string; deviceIds: string[] }} p
 * @param {{ maxScan?: number }} [opts]
 * @returns {Array<{ metricName: string; sparkplugDeviceId: string; lastReceivedAt: string; lastValue: unknown }>}
 */
function listSparkplugMetricsForDevices(p, opts = {}) {
  const g = String(p.groupId || '').toLowerCase();
  const edge = String(p.edgeNodeId || '');
  const deviceSet = new Set((p.deviceIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  if (!deviceSet.size) return [];

  const maxScan = Math.min(8000, Math.max(1, Number(opts.maxScan) || 4000));
  /** @type {Map<string, { metricName: string; sparkplugDeviceId: string; lastReceivedAt: string; lastValue: unknown }>} */
  const seen = new Map();
  let scanned = 0;
  for (let i = events.length - 1; i >= 0 && scanned < maxScan; i -= 1, scanned += 1) {
    const e = events[i];
    if (String(e.messageType || '').toUpperCase() === 'UNS_JSON') continue;
    if (String(e.groupId || '').toLowerCase() !== g) continue;
    if (String(e.edgeNodeId || '') !== edge) continue;
    const dev = String(e.deviceId || '');
    if (!deviceSet.has(dev)) continue;
    const metric = e.metric != null ? String(e.metric).trim() : '';
    if (!metric) continue;
    const key = `${dev}\0${metric}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      metricName: metric,
      sparkplugDeviceId: dev,
      lastReceivedAt: e.receivedAt != null ? String(e.receivedAt) : '',
      lastValue: e.value,
    });
  }

  return [...seen.values()].sort((a, b) => {
    const c = a.metricName.localeCompare(b.metricName);
    return c !== 0 ? c : a.sparkplugDeviceId.localeCompare(b.sparkplugDeviceId);
  });
}

/**
 * Recent numeric Sparkplug samples for one metric (newest-first scan of the rolling buffer).
 *
 * @param {{ groupId: string; edgeNodeId: string; deviceId: string; metricName: string }} p
 * @param {{ limit?: number; maxScan?: number }} [opts]
 * @returns {Array<{ t: string; v: number }>}
 */
function listRecentSparkplugNumericSamples(p, opts = {}) {
  const g = String(p.groupId || '').toLowerCase();
  const edge = String(p.edgeNodeId || '');
  const dev = String(p.deviceId || '');
  const m = String(p.metricName || '').trim();
  const limit = Math.min(300, Math.max(2, Number(opts.limit) || 120));
  const maxScan = Math.min(12000, Math.max(limit, Number(opts.maxScan) || 8000));
  /** @type {Array<{ t: string; v: number }>} */
  const out = [];
  let scanned = 0;
  for (let i = events.length - 1; i >= 0 && out.length < limit && scanned < maxScan; i -= 1, scanned += 1) {
    const e = events[i];
    if (String(e.messageType || '').toUpperCase() === 'UNS_JSON') continue;
    if (String(e.groupId || '').toLowerCase() !== g) continue;
    if (String(e.edgeNodeId || '') !== edge) continue;
    if (String(e.deviceId || '') !== dev) continue;
    const metric = e.metric != null ? String(e.metric).trim() : '';
    if (metric !== m) continue;
    const raw = e.value;
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) continue;
    const tRaw = e.receivedAt != null ? String(e.receivedAt) : '';
    if (!tRaw) continue;
    out.push({ t: tRaw, v });
  }
  return out.reverse();
}

module.exports = {
  appendFromMqtt,
  appendTpunsLiveFromMqtt,
  resolveBufferGroupIdForMqttLiveUrlParam,
  resolveParkKeyForMqttLiveBufferParam,
  resolveBufferGroupIdForMqttLiveUrlParamAsync,
  getSnapshot,
  getStats,
  getSparkplugSubscribePatterns,
  findLatestLiveRow,
  findLatestTpunsLiveRowForTopic,
  findLatestSparkplugLiveMetricRow,
  probeSparkplugLiveMetricForRide,
  listSparkplugMetricsForDevices,
  listRecentSparkplugNumericSamples,
  MAX_EVENTS,
  /** @public for Phase 13 capability guard (topic parse only). */
  parseSparkplugTopic,
  /** @public for Phase 13 capability guard (aligns UNS Live canonical domain). */
  resolveCanonicalDomainForLiveRow,
};
