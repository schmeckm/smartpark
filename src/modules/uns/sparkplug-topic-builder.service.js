const env = require('../../config/env');
const { slugifyName } = require('./uns-topic-generator.service');

/**
 * Allowed Sparkplug B MQTT message types (namespace segment).
 * @type {readonly string[]}
 */
const SPARKPLUG_MESSAGE_TYPES = Object.freeze([
  'NBIRTH',
  'NDEATH',
  'DBIRTH',
  'DDEATH',
  'DDATA',
  'NCMD',
  'DCMD',
  'STATE',
]);

/** Message types that include a device id in the topic (Sparkplug B device channel). */
const SPARKPLUG_DEVICE_MESSAGE_TYPES = new Set(['DBIRTH', 'DDEATH', 'DDATA', 'DCMD']);

function sanitizeTopicSegment(value, fallback) {
  const s = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const out = s.slice(0, 120);
  return out || fallback;
}

/**
 * Sparkplug B MQTT topic: spBv1.0/{group_id}/{message_type}/{edge_node_id}/[{device_id}]
 * Device segment is omitted for node-level messages (e.g. NBIRTH, NDEATH, NCMD) when deviceId is not set.
 *
 * @param {{ groupId: string; messageType: string; edgeNodeId: string; deviceId?: string | null }} p
 * @returns {string}
 */
function buildSparkplugTopic({ groupId, messageType, edgeNodeId, deviceId } = {}) {
  const mtRaw = String(messageType || 'DDATA').trim().toUpperCase();
  if (!SPARKPLUG_MESSAGE_TYPES.includes(mtRaw)) {
    throw new Error(`Invalid Sparkplug messageType "${messageType}". Allowed: ${SPARKPLUG_MESSAGE_TYPES.join(', ')}`);
  }
  const g = sanitizeTopicSegment(groupId, 'smartpark');
  const edge = sanitizeTopicSegment(edgeNodeId, 'park_gateway');
  const parts = ['spBv1.0', g, mtRaw, edge];
  const needsDevice = SPARKPLUG_DEVICE_MESSAGE_TYPES.has(mtRaw);
  const devRaw = deviceId != null && String(deviceId).trim() !== '' ? String(deviceId) : '';
  const dev = sanitizeTopicSegment(slugifyName(devRaw), '');
  if (needsDevice) {
    if (!dev) {
      throw new Error(`Sparkplug message type ${mtRaw} requires a non-empty deviceId`);
    }
    parts.push(dev);
  }
  return parts.join('/');
}

/** Normalized device id segment as used on Sparkplug topics (matches inbound live-buffer parsing). */
function sparkplugDeviceTopicSegment(deviceId) {
  const devRaw = deviceId != null && String(deviceId).trim() !== '' ? String(deviceId) : '';
  return sanitizeTopicSegment(slugifyName(devRaw), '');
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ groupId?: string; edgeNodeId?: string; messageType?: string }} [opts]
 */
function enrichRowsWithSparkplug(rows, opts = {}) {
  const messageType = String(opts.messageType || 'DDATA').toUpperCase();
  const g = opts.groupId || env.sparkplugGroupId || 'smartpark';
  const edge = opts.edgeNodeId || env.sparkplugEdgeNode || 'park_gateway';
  return rows.map((r) => {
    const deviceId = slugifyName(r.assetSlug || 'device');
    return {
      ...r,
      sparkplugTopic:
        r.sparkplugTopic ||
        buildSparkplugTopic({
          groupId: g,
          messageType,
          edgeNodeId: edge,
          deviceId,
        }),
    };
  });
}

/** @deprecated Use {@link buildSparkplugTopic} with messageType DDATA and deviceId = slugified asset. */
function buildSparkplugDdataTopic({ groupId, edgeNodeId, assetSlug }) {
  return buildSparkplugTopic({
    groupId,
    messageType: 'DDATA',
    edgeNodeId,
    deviceId: slugifyName(assetSlug || 'device'),
  });
}

module.exports = {
  SPARKPLUG_MESSAGE_TYPES,
  SPARKPLUG_DEVICE_MESSAGE_TYPES,
  buildSparkplugTopic,
  buildSparkplugDdataTopic,
  enrichRowsWithSparkplug,
  sparkplugDeviceTopicSegment,
};
