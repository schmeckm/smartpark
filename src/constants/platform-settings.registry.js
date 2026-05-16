'use strict';

/**
 * Canonical platform settings (DB `platform_settings.setting_key`).
 * Resolution order: active DB row → raw process.env → codeDefault.
 */
const PLATFORM_SETTING_REGISTRY = Object.freeze({
  AI_SAMPLING_ENABLED: {
    category: 'AI',
    valueType: 'boolean',
    envVar: 'AI_SAMPLING_ENABLED',
    codeDefault: true,
    description: 'Periodically run the full AI pipeline (zone sampling, forecasts, feature store, scoring).',
  },
  AI_SAMPLING_INTERVAL_SECONDS: {
    category: 'AI',
    valueType: 'number',
    envVar: 'AI_SAMPLING_INTERVAL_SECONDS',
    codeDefault: 300,
    description: 'Seconds between AI pipeline ticks (minimum 30).',
    clamp: { min: 30, max: 86400 },
  },
  AI_SAMPLING_ALIGN_TO_5M_UTC: {
    category: 'AI',
    valueType: 'boolean',
    envVar: 'AI_SAMPLING_ALIGN_TO_5M_UTC',
    codeDefault: true,
    description:
      'When true, schedule the next AI pipeline tick just after each 5-minute UTC wall boundary (matches 5m ride_feature_snapshots_5m buckets). When false, sleeps AI_SAMPLING_INTERVAL_SECONDS only.',
  },
  WEATHER_OPEN_METEO_ENABLED: {
    category: 'WEATHER',
    valueType: 'boolean',
    envVar: 'WEATHER_OPEN_METEO_ENABLED',
    codeDefault: false,
    description: 'Poll Open-Meteo for active parks with coordinates and persist weather observations.',
  },
  WEATHER_OPEN_METEO_INTERVAL_SECONDS: {
    category: 'WEATHER',
    valueType: 'number',
    envVar: 'WEATHER_OPEN_METEO_INTERVAL_SECONDS',
    codeDefault: 300,
    description: 'Seconds between Open-Meteo scheduler ticks (minimum 60).',
    clamp: { min: 60, max: 86400 },
  },
  WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS: {
    category: 'WEATHER',
    valueType: 'boolean',
    envVar: 'WEATHER_OPEN_METEO_REBUILD_SNAPSHOTS',
    codeDefault: true,
    description: 'After a successful weather ingest pass, rebuild feature-store snapshots.',
  },
  WEATHER_OPEN_METEO_FETCH_RETRIES: {
    category: 'WEATHER',
    valueType: 'number',
    envVar: 'WEATHER_OPEN_METEO_FETCH_RETRIES',
    codeDefault: 3,
    description: 'HTTP retries per park when calling Open-Meteo.',
    clamp: { min: 1, max: 10 },
  },
  WEATHER_OPEN_METEO_RETRY_BASE_MS: {
    category: 'WEATHER',
    valueType: 'number',
    envVar: 'WEATHER_OPEN_METEO_RETRY_BASE_MS',
    codeDefault: 500,
    description: 'Base backoff delay in ms between Open-Meteo retries.',
    clamp: { min: 50, max: 60_000 },
  },
  ADAPTER_SCHEDULER_ENABLED: {
    category: 'ADAPTERS',
    valueType: 'boolean',
    envVar: 'ADAPTER_SCHEDULER_ENABLED',
    codeDefault: true,
    description:
      'Global on/off for the API cron runner that evaluates each installed adapter scheduleCron (does not replace per-adapter schedules).',
  },
  EXTERNAL_PARK_DATA_ENABLED: {
    category: 'ADAPTERS',
    valueType: 'boolean',
    envVar: 'EXTERNAL_PARK_DATA_ENABLED',
    codeDefault: true,
    description: 'Master switch for external ThemeParks-style live polling (also requires Integration polling enabled).',
  },
  EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS: {
    category: 'ADAPTERS',
    valueType: 'number',
    envVar: 'EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS',
    codeDefault: 120,
    description:
      'Default polling interval (seconds) seeded into Integration settings when unset. Shorter intervals ingest fresher waits; feature-store buckets remain 5m.',
    clamp: { min: 30, max: 86400 },
  },
  EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC: {
    category: 'ADAPTERS',
    valueType: 'boolean',
    envVar: 'EXTERNAL_PARK_DATA_POLL_NEAR_5M_UTC',
    codeDefault: true,
    description:
      'When true, shorten a sleep when the next 5-minute UTC boundary is sooner than the poll interval (optional phase alignment with snapshot buckets).',
  },
  EXTERNAL_PARK_DATA_DEFAULT_PROVIDER: {
    category: 'ADAPTERS',
    valueType: 'string',
    envVar: 'EXTERNAL_PARK_DATA_DEFAULT_PROVIDER',
    codeDefault: 'themeparks_wiki',
    description: 'Default external park data provider key when Integration provider is not set.',
  },
  ADDON_BOARD_FORECAST_CRITICAL_MINUTES: {
    category: 'AI',
    valueType: 'number',
    envVar: 'ADDON_BOARD_FORECAST_CRITICAL_MINUTES',
    codeDefault: 55,
    description:
      'Add-on Board / ML: open rides with 60m forecast ≥ this value (minutes) count as forecast-risk (L0/L1). Overrides config/addon-board/thresholds-default.json when set in DB.',
    clamp: { min: 15, max: 180 },
  },
  /** --- SQDC / SQDCP UI (month rings + park score dots) — Level 0 vs Level 3 score bands (0–100). --- */
  SQDC_SCORE_RING_PARK_GREEN_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_SCORE_RING_PARK_GREEN_MIN',
    codeDefault: 80,
    description:
      'Park month-ring segments (S/Q/D from PARK daily snapshots): score ≥ this → green. Used with amber min; must be greater than amber.',
    clamp: { min: 1, max: 100 },
  },
  SQDC_SCORE_RING_PARK_AMBER_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_SCORE_RING_PARK_AMBER_MIN',
    codeDefault: 55,
    description:
      'Park month rings: score ≥ this (and < green min) → amber; below → red. Also used for “critical asset” count threshold on park roll-up.',
    clamp: { min: 0, max: 99 },
  },
  SQDC_SCORE_RING_ASSET_GREEN_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_SCORE_RING_ASSET_GREEN_MIN',
    codeDefault: 80,
    description:
      'Asset month-ring segments (S/Q/D from ASSET daily snapshots): score ≥ this → green. Stricter/softer than park if desired.',
    clamp: { min: 1, max: 100 },
  },
  SQDC_SCORE_RING_ASSET_AMBER_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_SCORE_RING_ASSET_AMBER_MIN',
    codeDefault: 55,
    description: 'Asset month rings: amber band lower bound (0–100), must be < asset green min.',
    clamp: { min: 0, max: 99 },
  },
  SQDC_RING_COST_EUR_GREEN_MAX: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_RING_COST_EUR_GREEN_MAX',
    codeDefault: 200,
    description:
      'Cost ring (C): sum of positive electricityCostEurPerDay + maintenanceCostEurPerDay in snapshot delivery_json — ≤ this EUR → green segment.',
    clamp: { min: 1, max: 50_000 },
  },
  SQDC_RING_COST_EUR_AMBER_MAX: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_RING_COST_EUR_AMBER_MAX',
    codeDefault: 500,
    description:
      'Cost ring (C): ≤ this total daily EUR (electricity + maintenance, delivery_json) and > green max → amber; above → red.',
    clamp: { min: 2, max: 100_000 },
  },
  SQDC_RING_PEOPLE_MOOD_GREEN_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_RING_PEOPLE_MOOD_GREEN_MIN',
    codeDefault: 4,
    description: 'People ring (P): average mood 1–5 for the UTC day ≥ this → green.',
    clamp: { min: 1, max: 5 },
  },
  SQDC_RING_PEOPLE_MOOD_AMBER_MIN: {
    category: 'SQDC',
    valueType: 'number',
    envVar: 'SQDC_RING_PEOPLE_MOOD_AMBER_MIN',
    codeDefault: 3,
    description: 'People ring (P): mood average ≥ this (and < green min) → amber; below → red.',
    clamp: { min: 1, max: 5 },
  },
  INFLUX_OT_STREAMING_ENABLED: {
    category: 'TELEMETRY',
    valueType: 'boolean',
    envVar: 'INFLUX_OT_STREAMING_ENABLED',
    codeDefault: false,
    description:
      'Stream Sparkplug OT samples and PdM/ML outputs into InfluxDB (bucket ot_metrics). Requires INFLUX_ENABLED and a reachable InfluxDB instance.',
  },
});

const PLATFORM_SETTING_KEYS = Object.freeze(Object.keys(PLATFORM_SETTING_REGISTRY));

/** @param {string} key */
function getRegistryEntry(key) {
  return PLATFORM_SETTING_REGISTRY[key] || null;
}

module.exports = {
  PLATFORM_SETTING_REGISTRY,
  PLATFORM_SETTING_KEYS,
  getRegistryEntry,
};
