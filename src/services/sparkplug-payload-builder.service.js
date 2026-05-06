'use strict';

const { buildSparkplugTopic } = require('../modules/uns/sparkplug-topic-builder.service');

/**
 * @param {Array<{ name: string; type: string; value: unknown; unit?: string | null }>} metrics
 * @param {{ seq?: number; timestamp?: number }} [opts]
 */
function buildJsonPayload(metrics, opts = {}) {
  const seq = Number.isFinite(opts.seq) ? opts.seq : Date.now() % 2147483647;
  const timestamp = Number.isFinite(opts.timestamp) ? opts.timestamp : Date.now();
  return {
    timestamp,
    metrics: (metrics || []).map((m) => ({
      name: String(m.name),
      type: String(m.type || 'String'),
      value: m.value,
      unit: m.unit ?? null,
    })),
    seq,
  };
}

/**
 * Placeholder for future binary Sparkplug encoding.
 * @param {Array<{ name: string; type: string; value: unknown; unit?: string | null }>} metrics
 * @param {{ groupId: string; edgeNodeId: string; deviceId: string }} topicParts
 * @param {{ seq?: number }} [opts]
 */
function buildProtobufReadyPayload(metrics, topicParts, opts = {}) {
  const topic = buildSparkplugTopic({
    groupId: topicParts.groupId,
    messageType: 'DDATA',
    edgeNodeId: topicParts.edgeNodeId,
    deviceId: topicParts.deviceId,
  });
  return {
    format: 'protobuf_ready',
    topic,
    metrics: (metrics || []).map((m) => ({
      name: String(m.name),
      type: String(m.type || 'String'),
      value: m.value,
      unit: m.unit ?? null,
    })),
    seq: Number.isFinite(opts.seq) ? opts.seq : Date.now() % 2147483647,
    note: 'Protobuf encoding adapter can be plugged in here later',
  };
}

/**
 * Group metrics that share the same Sparkplug DDATA topic.
 * @param {Array<{ groupId: string; edgeNodeId: string; deviceId: string; name: string; type: string; value: unknown; unit?: string | null }>} rows
 * @returns {Map<string, { groupId: string; edgeNodeId: string; deviceId: string; metrics: typeof rows }>}
 */
function groupMetricsByDdataTopic(rows) {
  /** @type {Map<string, { groupId: string; edgeNodeId: string; deviceId: string; metrics: typeof rows }>} */
  const map = new Map();
  for (const r of rows || []) {
    const topic = buildSparkplugTopic({
      groupId: r.groupId,
      messageType: 'DDATA',
      edgeNodeId: r.edgeNodeId,
      deviceId: r.deviceId,
    });
    const cur = map.get(topic);
    const entry = { name: r.name, type: r.type, value: r.value, unit: r.unit ?? null };
    if (!cur) {
      map.set(topic, { groupId: r.groupId, edgeNodeId: r.edgeNodeId, deviceId: r.deviceId, metrics: [entry] });
    } else {
      cur.metrics.push(entry);
    }
  }
  return map;
}

module.exports = {
  buildJsonPayload,
  buildProtobufReadyPayload,
  groupMetricsByDdataTopic,
};
