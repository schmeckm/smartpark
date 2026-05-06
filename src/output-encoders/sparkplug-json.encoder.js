const env = require('../config/env');
const { buildSparkplugTopic } = require('../modules/uns/sparkplug-topic-builder.service');
const { slugifyName, buildCanonicalUnsTopic } = require('../modules/uns/uns-topic-generator.service');

/**
 * JSON-on-topic MVP: Sparkplug B–shaped MQTT topic; payload is JSON (not protobuf).
 * Metrics (status, queue_time, …) belong in the payload, not as extra topic segments.
 *
 * @param {Record<string, unknown>} observation
 * @param {{ edgeNode?: string; sparkplugEdgeNode?: string; parkSlug?: string; sparkplugGroupId?: string; source?: string }} context
 */
function encode(observation, context) {
  const parkSlug = context?.parkSlug;
  const groupId =
    context?.sparkplugGroupId || env.sparkplugGroupId || (parkSlug ? slugifyName(parkSlug) : '') || 'smartpark';
  const edgeNode = context?.sparkplugEdgeNode || context?.edgeNode || env.sparkplugEdgeNode || 'park_gateway';
  const deviceId = slugifyName(observation.assetSlug || 'device');
  const topic = buildSparkplugTopic({
    groupId,
    messageType: 'DDATA',
    edgeNodeId: edgeNode,
    deviceId,
  });
  const ts = observation.eventTime || new Date().toISOString();
  const domain = typeof observation.domain === 'string' ? observation.domain : '';
  const assetSlug = typeof observation.assetSlug === 'string' ? observation.assetSlug : '';
  const metric = typeof observation.metric === 'string' ? observation.metric : '';
  const canonicalUnsTopic =
    parkSlug && domain && assetSlug && metric
      ? buildCanonicalUnsTopic({
          parkSlug: String(parkSlug),
          entityType: domain,
          entitySlug: assetSlug,
          metric,
        })
      : null;
  const payload = {
    format: 'sparkplug_json_mvp',
    timestamp: ts,
    metrics: [
      {
        name: metric || 'value',
        value: observation.value,
        type: 'JSON',
      },
    ],
    tags: {
      domain: observation.domain || null,
      assetSlug: observation.assetSlug || null,
      eventType: observation.eventType || null,
      source: observation.source || context?.source || null,
      canonicalUnsTopic,
    },
  };
  return { profile: 'sparkplug_json', topic, payload };
}

module.exports = { encode };
