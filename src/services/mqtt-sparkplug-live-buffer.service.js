/**
 * In-memory buffer of flattened MQTT events for UNS Live (no DB).
 * - Sparkplug: `spBv1.0/...` JSON payloads (metrics array).
 * - TPUNS: `tpuns/.../v1/...` JSON payloads (UNS_JSON / adapter preview publish).
 * Filled from the MQTT `message` handler and from same-process `publish` callbacks
 * (Mosquitto often still delivers self-echo; short dedupe avoids duplicate rows).
 */

const { randomUUID } = require('node:crypto');
const { logger } = require('../utils/logger');
const { emitUnsMqttLiveEvents } = require('../sockets');
const { buildCanonicalUnsTopic, slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const {
  getRegisteredEntityRowForSparkplugLookup,
  registerFromSparkplugDbirthMetric,
} = require('../modules/uns/theme-parks-entity-domain.service');

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

module.exports = {
  appendFromMqtt,
  appendTpunsLiveFromMqtt,
  getSnapshot,
  getStats,
  getSparkplugSubscribePatterns,
  findLatestLiveRow,
  findLatestTpunsLiveRowForTopic,
  findLatestSparkplugLiveMetricRow,
  MAX_EVENTS,
  /** @public for Phase 13 capability guard (topic parse only). */
  parseSparkplugTopic,
  /** @public for Phase 13 capability guard (aligns UNS Live canonical domain). */
  resolveCanonicalDomainForLiveRow,
};
