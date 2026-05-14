'use strict';

/**
 * Smart Park OS — typed feature flags (Phase A2).
 *
 * Why
 * ---
 *
 * `src/config/env.js` exports 50+ flat keys mixing DB config, JWT, MQTT,
 * capability guard, registry publisher, AI sampling, OEE simulator, weather
 * poller, output profiles, and ingestion. New code can reach for
 * `env.mqttCapabilityGuardMode` or `env.simOeeAttractions` interchangeably,
 * which has produced subtle coupling and made it impossible to answer
 * "what's actually configured for *MQTT* in this process?" without scanning
 * the file.
 *
 * `getFlags()` returns the same data **grouped by domain** in a frozen
 * structured object, validated by Joi. The schema has historical defaults so
 * every leaf resolves even when the underlying env var is absent. New code
 * SHOULD prefer `getFlags().mqtt.capabilityGuardMode` over `env.…`.
 *
 * Design notes
 * ------------
 *
 *   - `src/config/env.js` is **not modified** by A2. Every existing
 *     `require('../config/env')` call site keeps working unchanged. A2 is
 *     additive; A3 will start migrating call sites as they rewire through
 *     the bootstrap registry.
 *
 *   - The Joi schema validates the **structured shape**, not raw env values.
 *     The legacy parser in `env.js` already has lenient fallbacks for things
 *     like `MQTT_CAPABILITY_GUARD_MODE=banana` (-> 'off'), so pointing Joi
 *     at the structured shape preserves boot behavior. Strict-mode env
 *     validation can be added later with a feature flag without disturbing
 *     today's deployments.
 *
 *   - `getFlags()` is **cached**: callers can call it many times per request
 *     without re-running Joi. `clearFlagsCache()` exists for tests.
 *
 *   - `Flags.toLogPayload()` returns the masked structured snapshot used by
 *     QW2's boot log; secrets never appear in the output. This is the
 *     canonical call for `logger.info({ flags: getFlags().toLogPayload() }, …)`.
 */

const env = require('../config/env');
const { flagsSchema } = require('./feature-flags.schema');
const { buildFeatureFlagReport } = require('./feature-flags.report');

let cached = null;

/**
 * Build the structured object from the flat env shape. Pure: only reads
 * `envObj`, no `process.env` access, no Joi.
 *
 * @param {object} envObj typically the module exports of `src/config/env.js`.
 * @returns {object} the unfrozen, unvalidated structured shape.
 */
function buildStructured(envObj) {
  return {
    runtime: {
      nodeEnv: envObj.nodeEnv,
      port: envObj.port,
      logLevel: envObj.logLevel,
    },
    auth: {
      jwtSecret: envObj.jwtSecret,
      jwtAccessExpiresIn: envObj.jwtAccessExpiresIn,
      jwtRefreshDays: envObj.jwtRefreshDays,
    },
    db: {
      host: envObj.db?.host,
      port: envObj.db?.port,
      name: envObj.db?.name,
      user: envObj.db?.user,
      password: envObj.db?.password,
    },
    cors: {
      origin: envObj.corsOrigin,
    },
    mqtt: {
      enabled: Boolean(envObj.mqttEnabled),
      brokerUrl: envObj.mqttBrokerUrl,
      clientId: envObj.mqttClientId,
      username: envObj.mqttUsername,
      password: envObj.mqttPassword,
      capabilityGuardMode: envObj.mqttCapabilityGuardMode,
      capabilityGuardAllowedRideIds: envObj.mqttCapabilityGuardAllowedRideIds,
      sparkplugLiveSubscribeAdvanced: Boolean(envObj.mqttSparkplugLiveSubscribeAdvanced),
      enforceCapabilities: Boolean(envObj.mqttEnforceCapabilities),
    },
    sparkplug: {
      groupId: envObj.sparkplugGroupId,
      edgeNode: envObj.sparkplugEdgeNode,
    },
    uns: {
      spyEnabled: Boolean(envObj.unsSpyEnabled),
      adapterDiscoverySpyEnabled: Boolean(envObj.adapterDiscoverySpyEnabled),
    },
    ai: {
      samplingEnabled: Boolean(envObj.aiSamplingEnabled),
      samplingIntervalSeconds: envObj.aiSamplingIntervalSeconds,
    },
    mlForecast: {
      traceEnabled: Boolean(envObj.mlTraceEnabled),
      profileEnabled: Boolean(envObj.mlProfileEnabled),
      featureWeightsEnabled: Boolean(envObj.mlFeatureWeightsEnabled),
    },
    weather: {
      openMeteoEnabled: Boolean(envObj.weatherOpenMeteoEnabled),
      openMeteoIntervalSeconds: envObj.weatherOpenMeteoIntervalSeconds,
      openMeteoFetchRetries: envObj.weatherOpenMeteoFetchRetries,
      openMeteoRetryBaseDelayMs: envObj.weatherOpenMeteoRetryBaseDelayMs,
      openMeteoForecastUrl: envObj.weatherOpenMeteoForecastUrl,
      openMeteoRebuildSnapshots: Boolean(envObj.weatherOpenMeteoRebuildSnapshots),
    },
    integrations: {
      externalParkDataEnabled: Boolean(envObj.externalParkDataEnabled),
      externalParkDataPollIntervalSeconds: envObj.externalParkDataPollIntervalSeconds,
      externalParkDataDefaultProvider: envObj.externalParkDataDefaultProvider,
      adapterSchedulerEnabled: Boolean(envObj.adapterSchedulerEnabled),
      outputProfiles: envObj.outputProfiles,
      adapterPipelineLogEnabled: Boolean(envObj.adapterPipelineLogEnabled),
      adapterPipelineLogPath: envObj.adapterPipelineLogPath,
    },
    sim: {
      oee: {
        enabled: Boolean(envObj.simOeeEnabled),
        autoStart: Boolean(envObj.simOeeAutoStart),
        parkSlug: envObj.simOeeParkSlug,
        edgeNode: envObj.simOeeEdgeNode,
        publishMs: envObj.simOeePublishMs,
        attractions: envObj.simOeeAttractions,
        scenario: envObj.simOeeScenario,
        randomSeed: envObj.simOeeRandomSeed,
      },
    },
    registry: {
      publishEnabled: Boolean(envObj.registryPublishEnabled),
      publishMode: envObj.registryPublishMode,
      sparkplugFormat: envObj.registrySparkplugFormat,
      allowedRideIds: envObj.registryPublishAllowedRideIds,
      signalPublishMaxAgeMs: envObj.registrySignalPublishMaxAgeMs,
      signalStabilityDays: envObj.registrySignalStabilityDays,
    },
    ingestion: {
      maxAgeMs: envObj.ingestionMaxAgeMs,
    },
  };
}

/**
 * Validate a structured flags object against the Joi schema.
 *
 * Default mode is **lenient**: any validation problem is collected into the
 * returned `warnings` array but does not throw. Boot continues with the
 * legacy values from `env.js`. This preserves deployment behavior for
 * existing prod env files where, for example, an unknown
 * `MQTT_CAPABILITY_GUARD_MODE` was silently coerced to `'off'`.
 *
 * Pass `{ strict: true }` to flip Joi to fail-fast: invalid values throw an
 * `Error` whose message names every offending path. Tests use this mode;
 * production can opt in via a future feature flag.
 *
 * @param {object} structured
 * @param {{ strict?: boolean }} [opts]
 * @returns {{ value: object, warnings: string[] }}
 */
function validateStructured(structured, opts = {}) {
  const { error, value } = flagsSchema.validate(structured, {
    abortEarly: false,
    allowUnknown: false,
    convert: true,
  });
  if (error) {
    const warnings = error.details.map((d) => `${d.path.join('.')}: ${d.message}`);
    if (opts.strict) {
      const e = new Error(`feature-flags validation failed: ${warnings.join('; ')}`);
      e.code = 'FLAGS_VALIDATION_FAILED';
      e.details = warnings;
      throw e;
    }
    return { value: structured, warnings };
  }
  return { value, warnings: [] };
}

class Flags {
  /**
   * @param {object} structured already-validated structured object.
   * @param {string[]} warnings non-fatal validation findings.
   */
  constructor(structured, warnings) {
    Object.assign(this, structured);
    Object.defineProperty(this, '_warnings', {
      value: Object.freeze([...warnings]),
      enumerable: false,
    });
    deepFreeze(this);
  }

  /**
   * @returns {string[]} validation warnings observed during construction.
   */
  warnings() {
    return this._warnings;
  }

  /**
   * Return the masked, log-friendly snapshot. Delegates to the QW2 helper so
   * the shape and masking rules stay defined in one place. Reads from the
   * legacy flat env so consumers that have not migrated to typed flags still
   * see the same payload.
   *
   * @returns {object}
   */
  toLogPayload() {
    return buildFeatureFlagReport(env);
  }
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  for (const v of Object.values(obj)) deepFreeze(v);
  return Object.freeze(obj);
}

/**
 * Build (or return the cached) typed Flags instance for the current env.
 *
 * @param {{ strict?: boolean, envOverride?: object }} [opts]
 *   - `strict`: throw on validation problems (default false).
 *   - `envOverride`: substitute env source for tests; bypasses the cache.
 * @returns {Flags}
 */
function getFlags(opts = {}) {
  if (opts.envOverride) {
    const structured = buildStructured(opts.envOverride);
    const { value, warnings } = validateStructured(structured, opts);
    return new Flags(value, warnings);
  }
  if (!cached) {
    const structured = buildStructured(env);
    const { value, warnings } = validateStructured(structured, opts);
    cached = new Flags(value, warnings);
  }
  return cached;
}

/**
 * Clear the cached Flags (tests only).
 */
function clearFlagsCache() {
  cached = null;
}

module.exports = {
  Flags,
  getFlags,
  clearFlagsCache,
  // Exposed for unit tests; not part of the public API.
  _internal: { buildStructured, validateStructured },
};
