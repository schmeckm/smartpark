const mqtt = require('mqtt');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { IngestionService } = require('./ingestion.service');
const { emitMqttStatus, emitUnsStateUpdated } = require('../sockets');
const { UnsStateService } = require('../modules/uns/uns-state.service');
const { validateTopicPath: validateUnsTopicPath, parseTopic } = require('../modules/uns/uns-validator.service');
const {
  appendFromMqtt: appendSparkplugLiveFromMqtt,
  appendTpunsLiveFromMqtt,
  getSparkplugSubscribePatterns,
} = require('./mqtt-sparkplug-live-buffer.service');
const mqttCapabilityGuard = require('./mqtt-capability-guard.service');

const TOPICS = [
  'park/+/zone/+/crowd',
  'park/+/ride/+/status',
  'park/+/weather',
  'park/+/sensor/+',
  'tpuns/+/v1/#',
];

const state = {
  enabled: false,
  connected: false,
  lastError: null,
  client: null,
  sparkplugSubscribePatterns: [],
};

const ingestion = new IngestionService();
const unsStateService = new UnsStateService();

function getMqttState() {
  return {
    enabled: env.mqttEnabled,
    connected: state.connected,
    lastError: state.lastError,
    broker: env.mqttEnabled ? env.mqttBrokerUrl : null,
    clientId: env.mqttClientId,
    sparkplugSubscribePatterns: state.sparkplugSubscribePatterns || [],
  };
}

async function safeEvaluateCapabilityGuard(topic, payloadJson) {
  try {
    return await mqttCapabilityGuard.evaluateInboundMqttCapability({
      topic: String(topic),
      payloadJson,
      receivedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e.message, topic: String(topic).slice(0, 200) }, 'mqtt capability guard evaluation failed');
    return {
      mode: env.mqttCapabilityGuardMode,
      decision: 'SKIP',
      reason: 'guard_evaluation_error',
      topic: String(topic),
      rideAssetId: null,
      signalKey: null,
      registryTopicId: null,
      capabilitySource: null,
      details: { error: e.message },
    };
  }
}

async function handleCapabilityEnforcedBlock(topic, message, guardResult, recorded) {
  logger.warn(
    { topic: String(topic).slice(0, 200), reason: guardResult.reason, decision: guardResult.decision },
    'mqtt capability guard quarantined live TPUNS/Sparkplug side-effects (enforce)'
  );
  try {
    if (recorded?.mqttRow) {
      await mqttCapabilityGuard.recordCapabilityGuardBlockDiscovery(recorded.mqttRow, guardResult);
    }
  } catch (e) {
    logger.warn({ err: e.message, topic: String(topic).slice(0, 120) }, 'capability guard block discovery failed');
  }
}

function onMessage(topic, message) {
  const t = String(topic);
  if (!t.startsWith('tpuns/') && !t.startsWith('spBv1.0/')) {
    try {
      const { notifyMqttInboundObserved } = require('./mqtt-topic-observer.service');
      notifyMqttInboundObserved(topic, message, null);
    } catch (e) {
      logger.warn({ err: e.message }, 'mqtt topic observer hook failed');
    }
  }
  (async () => {
    const parts = t.split('/').filter(Boolean);
    try {
      if (parts[0] === 'spBv1.0') {
        let payloadJson = null;
        try {
          payloadJson = JSON.parse(message.toString());
        } catch {
          payloadJson = null;
        }
        const guardResult = await safeEvaluateCapabilityGuard(topic, payloadJson);
        const mqttObserver = require('./mqtt-topic-observer.service');
        const recorded = await mqttObserver.recordMqttInboundWithGuard(topic, message, guardResult);
        if (mqttCapabilityGuard.shouldQuarantineLiveMqttPersistence(env.mqttCapabilityGuardMode, guardResult.decision)) {
          await handleCapabilityEnforcedBlock(topic, message, guardResult, recorded);
          return;
        }
        appendSparkplugLiveFromMqtt(topic, message);
        if (recorded?.mqttRow && mqttObserver.isSpyEnabled()) {
          const { processInboundMqttRow } = require('./uns-spy.service');
          await processInboundMqttRow(recorded.mqttRow, recorded.payloadMeta);
        }
        return;
      }
      if (parts[0] === 'tpuns') {
        let payloadJson = null;
        try {
          payloadJson = JSON.parse(message.toString());
        } catch {
          payloadJson = null;
        }
        const guardResult = await safeEvaluateCapabilityGuard(topic, payloadJson);
        const mqttObserver = require('./mqtt-topic-observer.service');
        const { recordMqttInboundWithGuard, isSpyEnabled } = mqttObserver;
        const recorded = await recordMqttInboundWithGuard(topic, message, guardResult);
        if (mqttCapabilityGuard.shouldQuarantineLiveMqttPersistence(env.mqttCapabilityGuardMode, guardResult.decision)) {
          await handleCapabilityEnforcedBlock(topic, message, guardResult, recorded);
          return;
        }
        validateUnsTopicPath(topic);
        const payload = payloadJson != null ? payloadJson : JSON.parse(message.toString());
        try {
          appendTpunsLiveFromMqtt(topic, message);
        } catch (e) {
          logger.warn({ err: e.message, topic }, 'tpuns live buffer append failed');
        }
        await ingestion.processSensorTopic({ topic, raw: message, sourceSystem: 'mqtt_tpuns' });
        const parsed = parseTopic(topic);
        const row = await unsStateService.upsertState({
          parkId: parsed.parkSlug,
          topicPath: topic,
          payloadJson: payload,
          eventTime: payload?.ts || new Date().toISOString(),
          quality: payload?.quality || null,
          source: payload?.source || 'mqtt_tpuns',
        });
        emitUnsStateUpdated(row.toJSON ? row.toJSON() : row);
        if (recorded?.mqttRow && isSpyEnabled()) {
          const { processInboundMqttRow } = require('./uns-spy.service');
          await processInboundMqttRow(recorded.mqttRow, recorded.payloadMeta);
        }
        return;
      }

      if (parts[0] !== 'park' || parts.length < 2) return;
      if (parts[2] === 'zone' && parts[4] === 'crowd') {
        const payload = JSON.parse(message.toString());
        await ingestion.processCrowdPayload({ topic, sourceSystem: 'mqtt', payload });
        return;
      }
      if (parts[2] === 'ride' && parts[4] === 'status') {
        const payload = JSON.parse(message.toString());
        await ingestion.processRidePayload({ topic, sourceSystem: 'mqtt', payload });
        return;
      }
      if (parts.length === 3 && parts[2] === 'weather') {
        const payload = JSON.parse(message.toString());
        await ingestion.processWeatherPayload({ topic, sourceSystem: 'mqtt', payload });
        return;
      }
      if (parts[2] === 'sensor') {
        await ingestion.processSensorTopic({ topic, raw: message, sourceSystem: 'mqtt' });
        return;
      }
    } catch (e) {
      logger.warn({ err: e.message, topic }, 'mqtt message processing failed');
    }
  })().catch((e) => logger.error({ err: e.message, topic }, 'mqtt async error'));
}

function startMqtt() {
  if (!env.mqttEnabled) {
    state.enabled = false;
    logger.info('MQTT is disabled (MQTT_ENABLED!=true)');
    return;
  }
  state.enabled = true;
  const opts = {
    clientId: env.mqttClientId,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };
  if (env.mqttUsername) {
    opts.username = env.mqttUsername;
    opts.password = env.mqttPassword;
  }
  const client = mqtt.connect(env.mqttBrokerUrl, opts);
  state.client = client;
  state.lastError = null;

  client.on('connect', () => {
    state.connected = true;
    state.lastError = null;
    const sparkplugSubs = getSparkplugSubscribePatterns({ advanced: env.mqttSparkplugLiveSubscribeAdvanced });
    state.sparkplugSubscribePatterns = sparkplugSubs;
    const allSubs = [...TOPICS, ...sparkplugSubs];
    client.subscribe(allSubs, { qos: 0 }, (err, granted) => {
      if (err) {
        state.lastError = err.message;
        logger.warn({ err: err.message }, 'mqtt batch subscribe error');
      } else {
        logger.info(
          { topicCount: granted?.length ?? allSubs.length, sparkplugPatterns: sparkplugSubs.length },
          'MQTT subscribed (incl. Sparkplug live patterns)'
        );
      }
    });
    emitMqttStatus(getMqttState());
  });

  client.on('reconnect', () => {
    emitMqttStatus(getMqttState());
  });

  client.on('error', (err) => {
    state.lastError = err?.message || String(err);
    state.connected = false;
    logger.warn({ err: state.lastError }, 'mqtt error');
    emitMqttStatus(getMqttState());
  });

  client.on('close', () => {
    state.connected = false;
    logger.info('mqtt connection closed');
    emitMqttStatus(getMqttState());
  });

  client.on('message', onMessage);
}

function stopMqtt() {
  if (state.client) {
    try {
      state.client.end(true);
    } catch {
      /* */
    }
    state.client = null;
  }
  state.connected = false;
}

function getMqttClient() {
  return state.client;
}

function publishMqtt(topic, payload, options = {}) {
  return new Promise((resolve) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

    /** UNS Live in-memory buffer: same rows as broker path, so previews work without MQTT. */
    function bufferLiveFromAdapterPublish() {
      try {
        if (String(topic).startsWith('spBv1.0/')) {
          appendSparkplugLiveFromMqtt(topic, Buffer.from(body, 'utf8'));
        } else if (String(topic).startsWith('tpuns/')) {
          appendTpunsLiveFromMqtt(topic, Buffer.from(body, 'utf8'));
        }
      } catch (e) {
        logger.warn({ err: e.message, topic }, 'live buffer append (adapter publish) failed');
      }
    }

    if (!env.mqttEnabled) {
      bufferLiveFromAdapterPublish();
      resolve({ published: false, reason: 'mqtt_disabled', topic, liveBuffered: true });
      return;
    }
    const client = state.client;
    if (!client || !state.connected) {
      bufferLiveFromAdapterPublish();
      resolve({ published: false, reason: 'mqtt_not_connected', topic, liveBuffered: true });
      return;
    }
    client.publish(topic, body, { qos: options.qos ?? 0, retain: Boolean(options.retain) }, (err) => {
      if (err) {
        logger.warn({ err: err.message, topic }, 'mqtt publish failed');
        resolve({ published: false, reason: err.message, topic });
        return;
      }
      // Many brokers still echo self-publishes, but delivery can be flaky or racy with subscribe;
      // ingest here so UNS Live always reflects API-originated Sparkplug traffic.
      bufferLiveFromAdapterPublish();
      resolve({ published: true, topic });
    });
  });
}

module.exports = {
  startMqtt,
  stopMqtt,
  getMqttState,
  getMqttTopics: () => TOPICS,
  getMqttClient,
  publishMqtt,
};
