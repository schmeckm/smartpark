'use strict';

const env = require('../config/env');
const { logger } = require('../utils/logger');
const { MqttInboundMessage } = require('../models');
const { buildPayloadPreview, processInboundMqttRow } = require('./uns-spy.service');

function isSpyEnabled() {
  return Boolean(env.unsSpyEnabled);
}

function isGuardEnabledForTopic(topic) {
  const t = String(topic || '');
  const gated = t.startsWith('tpuns/') || t.startsWith('spBv1.0/');
  const mode = env.mqttCapabilityGuardMode;
  const guardOn = mode === 'warn_only' || mode === 'enforce';
  return gated && guardOn;
}

/**
 * Persist raw inbound when UNS Spy is on or capability guard is on (gated topics only).
 */
function shouldPersistMqttInbound(topic) {
  return isSpyEnabled() || isGuardEnabledForTopic(topic);
}

/**
 * @param {string} topic
 * @param {Buffer} message
 * @param {Record<string, unknown>|null} [guardResult]
 * @returns {Promise<{ mqttRow: import('../models').MqttInboundMessage; payloadMeta: { preview: string; length: number; payloadJson: object|null } } | null>}
 */
async function recordMqttInboundWithGuard(topic, message, guardResult = null) {
  if (!shouldPersistMqttInbound(topic)) return null;
  const payloadMeta = buildPayloadPreview(message);
  const row = await MqttInboundMessage.create({
    topic: String(topic),
    payloadPreview: payloadMeta.preview,
    payloadLength: payloadMeta.length,
    qos: 0,
    spyClassification: null,
    spyDetails: null,
    capabilityGuardMode: guardResult?.mode != null ? String(guardResult.mode) : null,
    capabilityGuardDecision: guardResult?.decision != null ? String(guardResult.decision) : null,
    capabilityGuardReason: guardResult?.reason != null ? String(guardResult.reason).slice(0, 255) : null,
    capabilityGuardDetails: guardResult?.details != null ? guardResult.details : null,
  });
  return { mqttRow: row, payloadMeta };
}

/**
 * Non-blocking hook for MQTT connector on non-gated topics (park/… etc.).
 * Must never throw synchronously; async errors are logged only.
 *
 * @param {string} topic
 * @param {Buffer} message
 * @param {Record<string, unknown>|null} [guardResult]
 */
function notifyMqttInboundObserved(topic, message, guardResult = null) {
  if (!shouldPersistMqttInbound(topic)) return;
  setImmediate(() => {
    void handleInbound(topic, message, guardResult).catch((err) => {
      logger.warn({ err: err.message, topic: String(topic).slice(0, 200) }, 'mqtt-topic-observer async failure');
    });
  });
}

/**
 * @param {string} topic
 * @param {Buffer} message
 * @param {Record<string, unknown>|null} [guardResult]
 */
async function handleInbound(topic, message, guardResult = null) {
  const rec = await recordMqttInboundWithGuard(topic, message, guardResult);
  if (!rec || !isSpyEnabled()) return;
  await processInboundMqttRow(rec.mqttRow, rec.payloadMeta);
}

module.exports = {
  notifyMqttInboundObserved,
  isSpyEnabled,
  shouldPersistMqttInbound,
  recordMqttInboundWithGuard,
};
