require('dotenv').config();
const { getDbHost } = require('../../config/db-host');

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtSecret: required('JWT_SECRET', 'dev-only-change-me-smart-park-jwt-secret'),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshDays: Number(process.env.JWT_REFRESH_DAYS) || 7,
  db: {
    host: getDbHost(),
    port: Number(process.env.DB_PORT) || 5432,
    name: required('DB_NAME', 'smartpark'),
    user: required('DB_USER', 'smartpark'),
    password: required('DB_PASSWORD', 'smartpark'),
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  mqttEnabled: process.env.MQTT_ENABLED === 'true' || process.env.MQTT_ENABLED === '1',
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883',
  mqttUsername: process.env.MQTT_USERNAME || '',
  mqttPassword: process.env.MQTT_PASSWORD || '',
  mqttClientId: process.env.MQTT_CLIENT_ID || 'smart-park-os-api',
  /** Observe-only UNS Spy: log inbound MQTT + discovery rows (no uns_nodes / publish changes). */
  unsSpyEnabled: process.env.UNS_SPY_ENABLED === 'true' || process.env.UNS_SPY_ENABLED === '1',
  /** ThemeParks (and similar) emit adapter discovery rows for UNS Spy inbox (additive; default off). */
  adapterDiscoverySpyEnabled:
    process.env.ADAPTER_DISCOVERY_SPY_ENABLED === 'true' || process.env.ADAPTER_DISCOVERY_SPY_ENABLED === '1',
  /** Reserved: MQTT live path capability enforcement (no behavior change until implemented). */
  mqttEnforceCapabilities:
    process.env.MQTT_ENFORCE_CAPABILITIES === 'true' || process.env.MQTT_ENFORCE_CAPABILITIES === '1',
  /**
   * Phase 13 / T.2 — inbound MQTT capability guard: off | warn_only | enforce (default off).
   * warn_only: log/persist guard decisions; TPUNS/Sparkplug live ingest unchanged.
   * enforce: only guard ALLOW updates live buffers, ingestion, uns_latest_states, and UNS sockets.
   */
  mqttCapabilityGuardMode: (() => {
    const raw = String(process.env.MQTT_CAPABILITY_GUARD_MODE || 'off')
      .trim()
      .toLowerCase();
    if (raw === 'warn_only' || raw === 'enforce') return raw;
    return 'off';
  })(),
  /** Optional pilot: comma-separated park_assets.asset_id (UUID) values; when set, only those rides are subject to guard. */
  mqttCapabilityGuardAllowedRideIds: process.env.MQTT_CAPABILITY_GUARD_ALLOWED_RIDE_IDS || '',
  /** Reject IoT messages whose timestamp is older than this (ms) */
  ingestionMaxAgeMs: Number(process.env.INGESTION_MAX_AGE_MS) || 20 * 60 * 1000,
  aiSamplingEnabled: process.env.AI_SAMPLING_ENABLED === 'true' || process.env.AI_SAMPLING_ENABLED === '1',
  aiSamplingIntervalSeconds: Math.max(30, Number(process.env.AI_SAMPLING_INTERVAL_SECONDS) || 300),
  /** Open-Meteo poll per active park; persists weather_observations and optionally rebuilds feature snapshots. */
  weatherOpenMeteoEnabled:
    process.env.WEATHER_OPEN_METEO_ENABLED === 'true' || process.env.WEATHER_OPEN_METEO_ENABLED === '1',
  weatherOpenMeteoIntervalSeconds: Math.max(60, Number(process.env.WEATHER_OPEN_METEO_INTERVAL_SECONDS) || 300),
  weatherOpenMeteoFetchRetries: Math.max(1, Number(process.env.WEATHER_OPEN_METEO_FETCH_RETRIES) || 3),
  weatherOpenMeteoRetryBaseDelayMs: Math.max(50, Number(process.env.WEATHER_OPEN_METEO_RETRY_BASE_MS) || 500),
  weatherOpenMeteoForecastUrl:
    process.env.WEATHER_OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
  weatherOpenMeteoRebuildSnapshots:
    process.env.WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS === 'false' ||
    process.env.WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS === '0'
      ? false
      : true,
  externalParkDataEnabled:
    process.env.EXTERNAL_PARK_DATA_ENABLED === 'true' || process.env.EXTERNAL_PARK_DATA_ENABLED === '1',
  externalParkDataPollIntervalSeconds:
    Math.max(30, Number(process.env.EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS) || 300),
  externalParkDataDefaultProvider: process.env.EXTERNAL_PARK_DATA_DEFAULT_PROVIDER || 'themeparks_wiki',
  adapterSchedulerEnabled:
    process.env.ADAPTER_SCHEDULER_ENABLED === 'true' || process.env.ADAPTER_SCHEDULER_ENABLED === '1',
  /** Comma-separated: uns_json, sparkplug_json, canonical_historian */
  outputProfiles: process.env.OUTPUT_PROFILES || '',
  /** MQTT Sparkplug B group id; when unset, callers default to UNS park slug. */
  sparkplugGroupId: process.env.SPARKPLUG_GROUP_ID || '',
  /** Edge node id segment (e.g. park_gateway); Sparkplug B: spBv1.0/{group}/{MT}/{edge}/[{device}]) */
  sparkplugEdgeNode: process.env.SPARKPLUG_EDGE_NODE || 'park_gateway',
  /** Subscribe to extra Sparkplug patterns for UNS Live (NBIRTH, NCMD, …). */
  mqttSparkplugLiveSubscribeAdvanced:
    process.env.MQTT_SPARKPLUG_LIVE_SUBSCRIBE_ADVANCED === 'true' ||
    process.env.MQTT_SPARKPLUG_LIVE_SUBSCRIBE_ADVANCED === '1',
  /** NDJSON file for adapter poll/scheduler/config issues (default data/adapter-pipeline.log). */
  adapterPipelineLogEnabled:
    process.env.ADAPTER_PIPELINE_LOG_ENABLED === 'false' || process.env.ADAPTER_PIPELINE_LOG_ENABLED === '0'
      ? false
      : true,
  adapterPipelineLogPath: process.env.ADAPTER_PIPELINE_LOG || 'data/adapter-pipeline.log',

  /** Attraction OEE MQTT simulator (Sparkplug JSON MVP). SIM_* aliases match IT-OT lab naming. */
  simOeeEnabled:
    process.env.SIM_OEE_ENABLED === 'true' ||
    process.env.SIM_OEE_ENABLED === '1' ||
    process.env.SIM_ENABLED === 'true' ||
    process.env.SIM_ENABLED === '1',
  simOeeAutoStart:
    process.env.SIM_OEE_AUTO_START === 'true' ||
    process.env.SIM_OEE_AUTO_START === '1' ||
    process.env.SIM_AUTO_START === 'true' ||
    process.env.SIM_AUTO_START === '1',
  simOeeParkSlug: process.env.SIM_OEE_PARK_ID || process.env.SIM_PARK_ID || 'europa_park',
  simOeeEdgeNode: process.env.SIM_OEE_EDGE_NODE || process.env.SIM_EDGE_NODE || '',
  simOeePublishMs: Math.max(500, Number(process.env.SIM_OEE_PUBLISH_MS || process.env.SIM_PUBLISH_MS) || 3000),
  simOeeAttractions: process.env.SIM_OEE_ATTRACTIONS || process.env.SIM_ATTRACTIONS || 'blue_fire,silver_star',
  simOeeScenario: process.env.SIM_OEE_SCENARIO || process.env.SIM_SCENARIO || 'NORMAL_OPERATION',
  simOeeRandomSeed: Number(process.env.SIM_OEE_RANDOM_SEED || process.env.SIM_RANDOM_SEED) || 42,

  /** Phase 8 — registry MQTT publisher pilot (legacy publishing unchanged). */
  registryPublishEnabled: process.env.REGISTRY_PUBLISH_ENABLED === 'true' || process.env.REGISTRY_PUBLISH_ENABLED === '1',
  registryPublishMode: /^parallel$/i.test(String(process.env.REGISTRY_PUBLISH_MODE || '').trim())
    ? 'parallel'
    : 'dry_run',
  registrySparkplugFormat: /^protobuf_ready$/i.test(String(process.env.REGISTRY_SPARKPLUG_FORMAT || '').trim())
    ? 'protobuf_ready'
    : 'json',
  registryPublishAllowedRideIds: process.env.REGISTRY_PUBLISH_ALLOWED_RIDE_IDS || '',
  /** Phase 11 — signal deprecation health: max age for a qualifying registry publish event (default 24h). */
  registrySignalPublishMaxAgeMs: Math.max(
    60_000,
    Number(process.env.REGISTRY_SIGNAL_PUBLISH_MAX_AGE_MS) || 24 * 60 * 60 * 1000
  ),
  /** Phase 11 — when > 0, health requires stability_window_started_at to be at least this many days old. */
  registrySignalStabilityDays: Math.max(0, Number(process.env.REGISTRY_SIGNAL_STABILITY_DAYS) || 0),
};
