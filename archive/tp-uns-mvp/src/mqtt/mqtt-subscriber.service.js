const mqtt = require('mqtt');
const EventEmitter = require('events');
const env = require('../config/env');
const { CanonicalEventService } = require('../services/canonical-event.service');
const { AppError } = require('../utils/app-error');

const internalBus = new EventEmitter();
const canonicalEventService = new CanonicalEventService();
let client = null;

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new AppError('Payload must be object', 422);
  if (!payload.ts) throw new AppError('Payload.ts is required', 422);
  if (!payload.source) throw new AppError('Payload.source is required', 422);
  if (!['GOOD', 'BAD', 'UNCERTAIN'].includes(String(payload.quality || 'GOOD'))) {
    throw new AppError('Payload.quality invalid', 422);
  }
  const c = Number(payload.confidence);
  if (payload.confidence != null && (!Number.isFinite(c) || c < 0 || c > 1)) {
    throw new AppError('Payload.confidence must be 0..1', 422);
  }
}

function parseMessage(buf) {
  try {
    return JSON.parse(String(buf));
  } catch {
    throw new AppError('MQTT payload is not valid JSON', 422);
  }
}

function startMqttSubscriber() {
  client = mqtt.connect(env.mqttUrl, { clientId: env.mqttClientId });
  client.on('connect', () => {
    client.subscribe(env.mqttTopicSubscribe);
  });
  client.on('message', async (topic, message) => {
    try {
      const payload = parseMessage(message);
      validatePayload(payload);
      const row = await canonicalEventService.createFromMqttMessage(topic, payload);
      internalBus.emit('canonical-event-created', row);
    } catch (err) {
      // Keep subscriber alive on malformed events.
      // eslint-disable-next-line no-console
      console.error('MQTT message handling failed:', err.message);
    }
  });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('MQTT client error:', err.message);
  });
  return client;
}

function getMqttClient() {
  return client;
}

module.exports = { startMqttSubscriber, getMqttClient, internalBus, validatePayload };
