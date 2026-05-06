'use strict';

const { Op } = require('sequelize');
const { parseTopic } = require('../modules/uns/uns-validator.service');
const {
  UnsNode,
  UnsRegistryTopic,
  UnsDiscoveryEvent,
  UnsTopicProposal,
  MqttInboundMessage,
  REGISTRY_SOURCE_MIRRORED,
  SPY_CLASSIFICATION,
} = require('../models');
const { logger } = require('../utils/logger');
const env = require('../config/env');

const PREVIEW_MAX = 8192;

/**
 * Observe-only UNS Spy: classifies inbound topics vs legacy UNS + registry mirror.
 * Never writes uns_nodes, uns_latest_states, or publishes MQTT.
 *
 * @param {string} topic
 * @param {Buffer|string} message
 * @returns {{ preview: string, length: number, payloadJson: object|null }}
 */
function buildPayloadPreview(message) {
  const raw = Buffer.isBuffer(message) ? message : Buffer.from(String(message ?? ''), 'utf8');
  const length = raw.length;
  const slice = raw.subarray(0, PREVIEW_MAX).toString('utf8');
  let payloadJson = null;
  try {
    payloadJson = JSON.parse(slice);
  } catch {
    /* non-JSON payloads are fine */
  }
  return { preview: slice, length, payloadJson };
}

/**
 * @param {string} topic
 * @returns {Promise<{ classification: string, details: Record<string, unknown> }>}
 */
async function classifyInboundTopic(topic) {
  const t = String(topic || '');
  const details = { topic: t };

  if (t.startsWith('spBv1.0/')) {
    return {
      classification: SPY_CLASSIFICATION.UNKNOWN_TOPIC,
      details: { ...details, reason: 'sparkplug_not_matched_to_uns_nodes', sparkplug: true },
    };
  }

  if (t.startsWith('tpuns/')) {
    let parsed;
    try {
      parsed = parseTopic(t);
    } catch (e) {
      return {
        classification: SPY_CLASSIFICATION.UNKNOWN_TOPIC,
        details: { ...details, reason: 'invalid_tpuns_path', error: e.message },
      };
    }

    const exactNodes = await UnsNode.findAll({
      where: { topicPath: t },
      attributes: ['id', 'topicPath', 'metric', 'slug'],
    });
    if (exactNodes.length > 1) {
      return {
        classification: SPY_CLASSIFICATION.CONFLICT,
        details: {
          ...details,
          reason: 'multiple_uns_nodes_same_topic_path',
          unsNodeIds: exactNodes.map((r) => r.id),
        },
      };
    }
    if (exactNodes.length === 1) {
      return {
        classification: SPY_CLASSIFICATION.APPROVED_TOPIC,
        details: { ...details, unsNodeId: exactNodes[0].id, source: 'uns_nodes' },
      };
    }

    const reg = await UnsRegistryTopic.findOne({
      where: { topicPath: t, registrySource: REGISTRY_SOURCE_MIRRORED },
      attributes: ['id', 'registryEntityId'],
    });
    if (reg) {
      return {
        classification: SPY_CLASSIFICATION.APPROVED_TOPIC,
        details: { ...details, registryTopicId: reg.id, registryEntityId: reg.registryEntityId, source: 'uns_registry_topics' },
      };
    }

    const prefix = `tpuns/${parsed.parkSlug}/${parsed.version}/${parsed.domain}/${parsed.assetSlug}/`;
    const related = await UnsNode.findAll({
      where: { topicPath: { [Op.like]: `${prefix}%` } },
      attributes: ['id', 'topicPath', 'metric'],
    });
    if (related.length) {
      const metrics = new Set(related.map((n) => n.metric).filter(Boolean));
      if (metrics.size && parsed.metric && !metrics.has(parsed.metric)) {
        return {
          classification: SPY_CLASSIFICATION.UNKNOWN_SIGNAL,
          details: {
            ...details,
            reason: 'asset_context_known_metric_not_in_uns_nodes',
            knownMetrics: [...metrics],
            inboundMetric: parsed.metric,
            relatedUnsNodeIds: related.map((r) => r.id),
          },
        };
      }
    }

    return {
      classification: SPY_CLASSIFICATION.UNKNOWN_TOPIC,
      details: { ...details, reason: 'no_uns_node_or_registry_topic_match', parsed },
    };
  }

  if (t.startsWith('park/')) {
    const byPath = await UnsNode.findAll({
      where: { topicPath: t },
      attributes: ['id'],
    });
    if (byPath.length > 1) {
      return { classification: SPY_CLASSIFICATION.CONFLICT, details: { ...details, reason: 'multiple_uns_nodes', unsNodeIds: byPath.map((r) => r.id) } };
    }
    if (byPath.length === 1) {
      return { classification: SPY_CLASSIFICATION.APPROVED_TOPIC, details: { ...details, unsNodeId: byPath[0].id, source: 'uns_nodes' } };
    }
    return {
      classification: SPY_CLASSIFICATION.UNKNOWN_TOPIC,
      details: { ...details, reason: 'park_topic_not_in_uns_nodes' },
    };
  }

  return {
    classification: SPY_CLASSIFICATION.OBSERVE_SKIPPED,
    details: { ...details, reason: 'non_uns_topic_shape' },
  };
}

/**
 * Persist discovery row + optional topic proposal. Updates mqtt row spy fields.
 * @param {import('../models').MqttInboundMessage} mqttRow
 * @param {{ preview: string, length: number, payloadJson: object|null }} payloadMeta
 */
async function recordDiscoveryForMqttRow(mqttRow, payloadMeta) {
  const topic = String(mqttRow.topic);
  const { classification, details } = await classifyInboundTopic(topic);

  const designGate = {
    registryApprovedTopic: classification === SPY_CLASSIFICATION.APPROVED_TOPIC,
    mqttEnforceCapabilities: Boolean(env.mqttEnforceCapabilities),
    phase12: 'MQTT capability gate is observe-only; upsertState unchanged while flag false.',
  };

  await mqttRow.update({
    spyClassification: classification,
    spyDetails: { ...details, payloadLength: payloadMeta.length, designGate },
  });

  if (classification === SPY_CLASSIFICATION.OBSERVE_SKIPPED) {
    return { classification, eventId: null };
  }

  const event = await UnsDiscoveryEvent.create({
    classification,
    topicPath: topic,
    mqttInboundMessageId: mqttRow.id,
    details: { ...details, payloadPreviewChars: (payloadMeta.preview || '').length },
  });

  if (classification === SPY_CLASSIFICATION.UNKNOWN_TOPIC || classification === SPY_CLASSIFICATION.UNKNOWN_SIGNAL) {
    await UnsTopicProposal.create({
      discoveryEventId: event.id,
      proposedTopic: topic,
      status: 'pending',
      payloadSnapshot: {
        preview: payloadMeta.preview?.slice(0, 2000) ?? '',
        parsedPayload: payloadMeta.payloadJson,
        classification,
      },
    });
  }

  return { classification, eventId: event.id };
}

/**
 * Entry from MQTT observer after raw row is stored.
 * @param {import('../models').MqttInboundMessage} mqttRow
 * @param {{ preview: string, length: number, payloadJson: object|null }} payloadMeta
 */
async function processInboundMqttRow(mqttRow, payloadMeta) {
  try {
    await recordDiscoveryForMqttRow(mqttRow, payloadMeta);
  } catch (e) {
    logger.warn({ err: e.message, topic: mqttRow.topic }, 'uns-spy discovery recording failed');
    try {
      await mqttRow.update({
        spyClassification: SPY_CLASSIFICATION.OBSERVE_SKIPPED,
        spyDetails: { error: e.message, reason: 'spy_processing_failed' },
      });
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  buildPayloadPreview,
  classifyInboundTopic,
  processInboundMqttRow,
  SPY_CLASSIFICATION,
  PREVIEW_MAX,
  ...require('./uns-spy-adapter-discovery.service'),
};
