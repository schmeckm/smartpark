'use strict';

const { OutputRouterService } = require('../../../services/output-router.service');
const { Park } = require('../../../models');
const env = require('../../../config/env');
const { getMqttState } = require('../../../services/mqtt-connector.service');

module.exports = {
  key: 'UNS_PUBLISH',
  nodeType: 'publish',
  displayName: 'UNS Publish',
  category: 'Publish',
  description: 'Publishes adapter-style observations to UNS/MQTT using OutputRouterService (existing encoder + MQTT path).',
  configSchema: {
    type: 'object',
    properties: {
      parkSlug: { type: 'string', description: 'UNS topic park segment; defaults from flow park or env' },
      maxObservations: { type: 'integer', minimum: 1, maximum: 50, default: 5 },
      profiles: { type: 'array', items: { type: 'string' } },
    },
    required: [],
    additionalProperties: false,
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const max = Math.min(50, Math.max(1, Number(cfg.maxObservations) || 5));
    const payload = context.payload;
    const runContext = context.context && typeof context.context === 'object' ? context.context : {};

    let observations = [];
    if (payload && Array.isArray(payload.observations)) observations = payload.observations;
    else if (payload?.canonicalMessages) {
      /* mapping node output — no direct observations */
    } else if (Array.isArray(runContext.observations)) {
      observations = runContext.observations;
    }

    if (!observations.length) {
      return {
        success: true,
        payload: {
          published: false,
          reason: 'no_observations',
          mqtt: getMqttState(),
          results: [],
        },
      };
    }

    if (!env.mqttEnabled) {
      return {
        success: true,
        payload: {
          published: false,
          reason: 'UNS publisher not available',
          mqtt: { enabled: false, connected: false },
          results: [],
        },
      };
    }

    let parkSlug = cfg.parkSlug ? String(cfg.parkSlug).trim() : '';
    if (!parkSlug && context.flow?.parkId) {
      const park = await Park.findByPk(context.flow.parkId, { attributes: ['slug', 'name'] });
      parkSlug = (park?.slug || park?.name || '').trim();
    }
    if (!parkSlug) {
      parkSlug = env.sparkplugGroupId || 'park';
    }

    const router = new OutputRouterService();
    const profiles = Array.isArray(cfg.profiles) && cfg.profiles.length ? cfg.profiles : undefined;
    /** @type {object[]} */
    const emitted = [];
    for (const obs of observations.slice(0, max)) {
      if (!obs || typeof obs !== 'object') continue;
      const out = await router.emit(obs, { parkSlug, source: obs.source || 'integration_flow' }, {
        profiles,
        emitMqtt: true,
        ingestCanonical: false,
        autoApply: false,
      });
      emitted.push({ observation: { domain: obs.domain, metric: obs.metric }, actions: out.actions });
    }

    const anyPublished = emitted.some((e) =>
      (e.actions?.mqtt || []).some((m) => m && m.published === true)
    );

    return {
      success: true,
      payload: {
        published: anyPublished,
        reason: anyPublished ? null : 'no_successful_mqtt_publish',
        mqtt: getMqttState(),
        emitted,
      },
    };
  },
};
