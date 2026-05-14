'use strict';

/**
 * Maps `signal_catalog.signal_code` (lowercase) to ridge / dataset feature keys
 * (`ride-feature-vector.util` / `TRAINING_FEATURE_NAMES`). Only explicit codes here participate in ML masking.
 * Contract checks: `validateSignalCodeToMlFeatureGovernance()` and `ride-ml-feature-signal-map.governance.test.js`.
 * @readonly
 */
const SIGNAL_CODE_TO_ML_FEATURE = {
  // → current_wait_time
  queue_time: 'current_wait_time',
  wait_time: 'current_wait_time',
  current_wait_time: 'current_wait_time',
  wait: 'current_wait_time',
  estimated_wait: 'current_wait_time',
  queue_wait: 'current_wait_time',
  wait_minutes: 'current_wait_time',
  wait_min: 'current_wait_time',
  avg_wait: 'current_wait_time',
  posted_wait: 'current_wait_time',
  // → ride_status_num
  status: 'ride_status_num',
  ride_status: 'ride_status_num',
  operational_status: 'ride_status_num',
  ride_state: 'ride_status_num',
  availability: 'ride_status_num',
  // → park_crowd_index
  park_crowd: 'park_crowd_index',
  park_crowd_index: 'park_crowd_index',
  crowd: 'park_crowd_index',
  crowd_index: 'park_crowd_index',
  crowd_level: 'park_crowd_index',
  park_load: 'park_crowd_index',
  demand_index: 'park_crowd_index',
  // → zone_congestion_score
  zone_congestion: 'zone_congestion_score',
  zone_congestion_score: 'zone_congestion_score',
  congestion: 'zone_congestion_score',
  zone_load: 'zone_congestion_score',
  neighbor_congestion: 'zone_congestion_score',
  // → rain_mm
  rain: 'rain_mm',
  rain_mm: 'rain_mm',
  precipitation: 'rain_mm',
  precipitation_mm: 'rain_mm',
  rainfall: 'rain_mm',
  precip: 'rain_mm',
  // → temperature_c
  temperature: 'temperature_c',
  temperature_c: 'temperature_c',
  temp_c: 'temperature_c',
  air_temp: 'temperature_c',
  ambient_temperature: 'temperature_c',
  outdoor_temp: 'temperature_c',
  // → school_holiday
  school_holiday: 'school_holiday',
  is_school_holiday: 'school_holiday',
  school_break: 'school_holiday',
  // → time_of_day
  time_of_day: 'time_of_day',
  hour_of_day: 'time_of_day',
  hour: 'time_of_day',
  local_hour: 'time_of_day',
  clock_hour: 'time_of_day',
  // → wait_time_trend_30m
  wait_trend: 'wait_time_trend_30m',
  wait_time_trend: 'wait_time_trend_30m',
  wait_delta: 'wait_time_trend_30m',
  wait_slope: 'wait_time_trend_30m',
  wait_trend_30m: 'wait_time_trend_30m',
};

const { Op } = require('sequelize');
const { TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');
const { RideSignalCapability, SignalCatalog } = require('../../models');

/**
 * Load ML feature keys the operator explicitly excluded (`useForMl: false` in capability_json).
 * Omitted or non-boolean `useForMl` does not exclude (avoids masking defaulted mirrored caps).
 * If any mapped row sets `useForMl: true`, that key is never disabled (conflict resolves toward use).
 *
 * @param {string} parkId - internal park UUID
 * @param {string} rideId - internal ride asset UUID (`park_assets.asset_id`)
 * @returns {Promise<Set<string>>}
 */
async function loadExplicitlyDisabledMlFeatureKeys(parkId, rideId) {
  const pid = String(parkId || '').trim();
  const rid = String(rideId || '').trim();
  if (!pid || !rid) return new Set();

  const caps = await RideSignalCapability.findAll({
    where: { parkId: pid, assetId: rid },
    include: [{ model: SignalCatalog, as: 'signal', attributes: ['signalCode'], required: true }],
  });

  /** @type {Map<string, 'on'|'off'>} */
  const byMl = new Map();
  for (const cap of caps) {
    const sig = cap.signal && typeof cap.signal.get === 'function' ? cap.signal.get({ plain: true }) : cap.signal;
    const code = String(sig?.signalCode || '').trim().toLowerCase();
    const mlKey = SIGNAL_CODE_TO_ML_FEATURE[code];
    if (!mlKey) continue;

    const cj = cap.get ? cap.get('capabilityJson') || {} : cap.capabilityJson || {};
    if (typeof cj.useForMl !== 'boolean') continue;
    if (cj.useForMl === true) {
      byMl.set(mlKey, 'on');
      continue;
    }
    if (byMl.get(mlKey) !== 'on') byMl.set(mlKey, 'off');
  }

  const out = new Set();
  for (const [mlKey, v] of byMl) {
    if (v === 'off') out.add(mlKey);
  }
  return out;
}

/**
 * Batch variant for dataset build: one query for many park+ride pairs.
 * @param {Array<{ parkId: string, rideId: string }>} pairs
 * @returns {Promise<Map<string, Set<string>>>} key `${parkId}|${rideId}` → Set of disabled ML feature keys
 */
async function loadExplicitlyDisabledMlFeatureKeysBatch(pairs) {
  const map = new Map();
  const uniq = [];
  const seen = new Set();
  for (const p of pairs || []) {
    const parkId = String(p.parkId || '').trim();
    const rideId = String(p.rideId || '').trim();
    if (!parkId || !rideId) continue;
    const k = `${parkId}|${rideId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ parkId, rideId });
    map.set(k, new Set());
  }
  if (!uniq.length) return map;

  const caps = await RideSignalCapability.findAll({
    where: {
      [Op.or]: uniq.map(({ parkId, rideId }) => ({ parkId, assetId: rideId })),
    },
    include: [{ model: SignalCatalog, as: 'signal', attributes: ['signalCode'], required: true }],
  });

  /** @type {Map<string, Map<string, 'on'|'off'>>} */
  const perRide = new Map();
  function rideState(key) {
    let m = perRide.get(key);
    if (!m) {
      m = new Map();
      perRide.set(key, m);
    }
    return m;
  }

  for (const cap of caps) {
    const parkId = String(cap.get('parkId'));
    const assetId = String(cap.get('assetId'));
    const rk = `${parkId}|${assetId}`;
    const sig = cap.signal && typeof cap.signal.get === 'function' ? cap.signal.get({ plain: true }) : cap.signal;
    const code = String(sig?.signalCode || '').trim().toLowerCase();
    const mlKey = SIGNAL_CODE_TO_ML_FEATURE[code];
    if (!mlKey) continue;

    const cj = cap.get ? cap.get('capabilityJson') || {} : cap.capabilityJson || {};
    if (typeof cj.useForMl !== 'boolean') continue;
    const st = rideState(rk);
    if (cj.useForMl === true) {
      st.set(mlKey, 'on');
    } else if (st.get(mlKey) !== 'on') {
      st.set(mlKey, 'off');
    }
  }

  for (const [rk, st] of perRide) {
    const disabled = map.get(rk);
    if (!disabled) continue;
    for (const [mlKey, v] of st) {
      if (v === 'off') disabled.add(mlKey);
    }
  }
  return map;
}

const SIGNAL_CODE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Governance: every map entry must target a ridge training feature; every `TRAINING_FEATURE_NAMES`
 * entry must have ≥1 catalog alias; keys must be lowercase snake_case (matches signal catalog admin rules).
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateSignalCodeToMlFeatureGovernance() {
  const allowed = new Set(TRAINING_FEATURE_NAMES);
  const errors = [];

  for (const [code, mlKey] of Object.entries(SIGNAL_CODE_TO_ML_FEATURE)) {
    if (code !== String(code).trim()) errors.push(`signal code key has surrounding whitespace: "${code}"`);
    if (code !== code.toLowerCase()) errors.push(`signal code key must be lowercase: "${code}"`);
    if (!SIGNAL_CODE_KEY_PATTERN.test(code)) {
      errors.push(`signal code key must match /^[a-z][a-z0-9_]*$/: "${code}"`);
    }
    if (!allowed.has(mlKey)) {
      errors.push(`SIGNAL_CODE_TO_ML_FEATURE["${code}"] → "${mlKey}" is not in TRAINING_FEATURE_NAMES`);
    }
  }

  const covered = new Set(Object.values(SIGNAL_CODE_TO_ML_FEATURE));
  for (const name of TRAINING_FEATURE_NAMES) {
    if (!covered.has(name)) {
      errors.push(
        `TRAINING_FEATURE_NAMES "${name}" has no signal_catalog alias — add at least one key in SIGNAL_CODE_TO_ML_FEATURE`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  SIGNAL_CODE_TO_ML_FEATURE,
  validateSignalCodeToMlFeatureGovernance,
  loadExplicitlyDisabledMlFeatureKeys,
  loadExplicitlyDisabledMlFeatureKeysBatch,
};
