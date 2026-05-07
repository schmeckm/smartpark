'use strict';

/**
 * Boot-time feature-flag report.
 *
 * Produces a structured snapshot of the resolved env-driven configuration so
 * a single `logger.info({ flags }, 'feature flags resolved')` line at startup
 * makes "what is actually on in this process" answerable without reading code.
 *
 * Secrets are masked deliberately. The shape is informational only — services
 * continue to read individual values from `src/config/env.js` until the typed
 * Flags object lands in Phase A2.
 */

/**
 * Mask a possibly-secret string so the boot log proves the value is set
 * without leaking the contents.
 * @param {unknown} value
 * @returns {string}
 */
function maskSecret(value) {
  if (value == null) return 'unset';
  const s = String(value);
  if (s === '') return 'unset';
  return `*** (set, length=${s.length})`;
}

/**
 * Build the flag report object. Pure: only reads from the supplied `env`
 * object, no `process.env` access, no logger side effects.
 *
 * @param {object} env - the resolved env module (`src/config/env.js`).
 * @returns {object} structured snapshot suitable for `logger.info`.
 */
function buildFeatureFlagReport(env) {
  return {
    runtime: {
      nodeEnv: env.nodeEnv,
      port: env.port,
      logLevel: env.logLevel,
    },
    auth: {
      jwtSecret: maskSecret(env.jwtSecret),
      jwtAccessExpiresIn: env.jwtAccessExpiresIn,
      jwtRefreshDays: env.jwtRefreshDays,
    },
    db: {
      host: env.db?.host ?? null,
      port: env.db?.port ?? null,
      name: env.db?.name ?? null,
      user: env.db?.user ?? null,
      password: maskSecret(env.db?.password),
    },
    cors: {
      origin: env.corsOrigin,
    },
    mqtt: {
      enabled: Boolean(env.mqttEnabled),
      brokerUrl: env.mqttBrokerUrl,
      clientId: env.mqttClientId,
      username: env.mqttUsername || 'unset',
      password: maskSecret(env.mqttPassword),
      capabilityGuardMode: env.mqttCapabilityGuardMode,
      enforceCapabilities: Boolean(env.mqttEnforceCapabilities),
      sparkplugLiveSubscribeAdvanced: Boolean(env.mqttSparkplugLiveSubscribeAdvanced),
      capabilityGuardAllowedRideIdsCount: countCsv(env.mqttCapabilityGuardAllowedRideIds),
    },
    sparkplug: {
      groupId: env.sparkplugGroupId || '(default: park slug)',
      edgeNode: env.sparkplugEdgeNode,
    },
    uns: {
      spyEnabled: Boolean(env.unsSpyEnabled),
      adapterDiscoverySpyEnabled: Boolean(env.adapterDiscoverySpyEnabled),
    },
    ai: {
      samplingEnabled: Boolean(env.aiSamplingEnabled),
      samplingIntervalSeconds: env.aiSamplingIntervalSeconds,
    },
    weather: {
      openMeteoEnabled: Boolean(env.weatherOpenMeteoEnabled),
      openMeteoIntervalSeconds: env.weatherOpenMeteoIntervalSeconds,
      openMeteoFetchRetries: env.weatherOpenMeteoFetchRetries,
      openMeteoRebuildSnapshots: env.weatherOpenMeteoRebuildSnapshots,
    },
    integrations: {
      externalParkDataEnabled: Boolean(env.externalParkDataEnabled),
      externalParkDataPollIntervalSeconds: env.externalParkDataPollIntervalSeconds,
      externalParkDataDefaultProvider: env.externalParkDataDefaultProvider,
      adapterSchedulerEnabled: Boolean(env.adapterSchedulerEnabled),
      outputProfiles: parseCsv(env.outputProfiles),
      adapterPipelineLogEnabled: Boolean(env.adapterPipelineLogEnabled),
      adapterPipelineLogPath: env.adapterPipelineLogPath,
    },
    sim: {
      oeeEnabled: Boolean(env.simOeeEnabled),
      oeeAutoStart: Boolean(env.simOeeAutoStart),
      oeeParkSlug: env.simOeeParkSlug,
      oeePublishMs: env.simOeePublishMs,
      oeeAttractions: parseCsv(env.simOeeAttractions),
      oeeScenario: env.simOeeScenario,
    },
    registry: {
      publishEnabled: Boolean(env.registryPublishEnabled),
      publishMode: env.registryPublishMode,
      sparkplugFormat: env.registrySparkplugFormat,
      allowedRideIdsCount: countCsv(env.registryPublishAllowedRideIds),
      signalPublishMaxAgeMs: env.registrySignalPublishMaxAgeMs,
      signalStabilityDays: env.registrySignalStabilityDays,
    },
    ingestion: {
      maxAgeMs: env.ingestionMaxAgeMs,
    },
  };
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function countCsv(value) {
  return parseCsv(value).length;
}

module.exports = { buildFeatureFlagReport, maskSecret };
