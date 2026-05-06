const env = require('../config/env');
const { encode: encodeUns } = require('../output-encoders/uns-json.encoder');
const { encode: encodeSparkplug } = require('../output-encoders/sparkplug-json.encoder');
const { encode: encodeCanonical } = require('../output-encoders/canonical-historian.encoder');
const { publishMqtt } = require('./mqtt-connector.service');
const { CanonicalInboundMessageService } = require('./canonical-inbound-message.service');

const ENCODERS = {
  uns_json: encodeUns,
  sparkplug_json: encodeSparkplug,
  canonical_historian: encodeCanonical,
};

/** When OUTPUT_PROFILES is unset and callers pass no profiles, still encode Sparkplug + historian (adapter MQTT). */
const FALLBACK_ENCODE_PROFILES = ['sparkplug_json', 'canonical_historian'];

function defaultProfiles() {
  const raw = env.outputProfiles || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : [...FALLBACK_ENCODE_PROFILES];
}

class OutputRouterService {
  constructor() {
    this.canonicalInbound = new CanonicalInboundMessageService();
  }

  encodeAll(observation, context, profiles) {
    const list = profiles?.length ? profiles : defaultProfiles();
    const results = [];
    for (const p of list) {
      const fn = ENCODERS[p];
      if (!fn) {
        results.push({ profile: p, error: 'unknown_profile' });
        continue;
      }
      try {
        results.push(fn(observation, context || {}));
      } catch (e) {
        results.push({ profile: p, error: e.message });
      }
    }
    return { results, profiles: list };
  }

  /**
   * Encode then optionally publish MQTT (UNS / Sparkplug JSON MVP) and/or ingest canonical rows.
   */
  async emit(observation, context, options = {}) {
    const { profiles, emitMqtt: doMqtt, ingestCanonical, autoApply } = options;
    const encoded = this.encodeAll(observation, context, profiles);
    const actions = { mqtt: [], canonicalIngest: null };

    for (const r of encoded.results) {
      if (r.error || r.skipped) continue;

      if (doMqtt && r.topic && r.payload && (r.profile === 'uns_json' || r.profile === 'sparkplug_json')) {
        const pub = await publishMqtt(r.topic, r.payload);
        actions.mqtt.push({ profile: r.profile, ...pub });
      }

      if (ingestCanonical && r.canonicalMessages?.length) {
        const rows = await this.canonicalInbound.ingest(r.canonicalMessages, {
          autoApply: autoApply !== false,
        });
        actions.canonicalIngest = {
          count: rows.length,
          ids: rows.map((x) => x.id),
        };
      }
    }

    return { ...encoded, actions };
  }
}

module.exports = { OutputRouterService, ENCODERS, defaultProfiles };
