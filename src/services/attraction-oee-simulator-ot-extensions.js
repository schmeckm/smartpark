/**
 * Optional per-ride OT / Sparkplug-style metrics for the Attraction OEE MQTT simulator.
 * Names are illustrative (PdM / UNS demos); correlate loosely with `AttractionSite` state + RNG.
 */
'use strict';

const { simOeeOtMetrics } = require('../config/env');

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function rnd(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

/** @param {{ state: string }} site */
function runtimeish(site) {
  return ['DISPATCHED', 'RUNNING', 'LOADING', 'UNLOADING'].includes(site.state);
}

/**
 * Map simulator device slug → internal profile id.
 * @param {string} slug
 * @returns {string|null}
 */
function resolveOtProfileId(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;
  const rules = [
    [/^silver_star$/, 'silver_star'],
    [/^blue_fire/, 'blue_fire'],
    [/^wodan/, 'wodan'],
    [/^voltron/, 'voltron'],
    [/^euro_mir|^euromir/, 'euro_mir'],
    [/^poseidon$/, 'poseidon'],
    [/^atlantica/, 'atlantica_supersplash'],
    [/^panorama_train/, 'panorama_bahn'],
    [/^piraten|^pirates_in_batavia/, 'piraten_batavia'],
    [/^snorri/, 'snorri'],
    [/^matterhorn/, 'matterhorn_blitz'],
    [/^alpenexpress/, 'alpenexpress'],
    [/^eurosat/, 'eurosat'],
    [/^volo/, 'volo_da_vinci'],
    [/^arthur$/, 'arthur'],
  ];
  for (const [re, id] of rules) {
    if (re.test(s)) return id;
  }
  return null;
}

/**
 * @param {*} site AttractionSite
 * @param {number} now
 * @param {Record<string, number>} prof
 * @param {() => number} rng
 * @returns {Array<{ name: string; value: unknown }>}
 */
function buildOtMetricsForProfile(profileId, site, now, prof, rng) {
  const run = runtimeish(site);
  const fault = site.state === 'FAULT';
  const t = (now % 200000) / 200000;

  switch (profileId) {
    case 'silver_star': {
      const liftA = run ? rnd(rng, 85, 195) : rnd(rng, 2, 18);
      const brakeC = run ? rnd(rng, 48, 118) + (fault ? rnd(rng, 35, 95) : 0) : rnd(rng, 18, 32);
      return [
        { name: 'lift_motor_current_a', value: Math.round(liftA * 10) / 10 },
        { name: 'brake_temperature_c', value: Math.round(brakeC * 10) / 10 },
        { name: 'train_position_m', value: Math.round(t * 850 * 10) / 10 },
        { name: 'chain_speed_m_s', value: Math.round((run ? rnd(rng, 2.2, 3.6) : 0) * 100) / 100 },
        { name: 'wind_speed_m_s', value: Math.round(rnd(rng, 0, 12) * 10) / 10 },
      ];
    }
    case 'blue_fire': {
      const launchA = site.state === 'RUNNING' ? rnd(rng, 320, 780) : rnd(rng, 0, 40);
      return [
        { name: 'launch_current_a', value: Math.round(launchA) },
        { name: 'lsm_status_ok', value: fault ? 0 : 1 },
        { name: 'vibration_rms_mm_s2', value: Math.round((run ? rnd(rng, 0.4, 2.8) : rnd(rng, 0.05, 0.35)) * 1000) / 1000 },
        { name: 'throughput_pph', value: Math.floor(site.actualPphEstimate(prof)) },
        {
          name: 'train_interval_sec',
          value:
            site._actualDispatchIntervalEma != null
              ? Math.round(site._actualDispatchIntervalEma * 10) / 10
              : Math.round(site.dispatchIntervalSec * (0.9 + rng() * 0.2) * 10) / 10,
        },
      ];
    }
    case 'wodan': {
      return [
        { name: 'wheel_temperature_c', value: Math.round((run ? rnd(rng, 28, 76) : rnd(rng, 16, 24)) * 10) / 10 },
        { name: 'wooden_structure_strain_ue', value: Math.round((run ? rnd(rng, 420, 980) : rnd(rng, 180, 320)) + (fault ? 400 : 0)) },
        { name: 'vibration_rms_mm_s2', value: Math.round((run ? rnd(rng, 0.8, 4.2) : rnd(rng, 0.1, 0.5)) * 1000) / 1000 },
        { name: 'axle_load_kn', value: Math.round((run ? rnd(rng, 42, 58) : rnd(rng, 8, 18)) * 10) / 10 },
      ];
    }
    case 'voltron': {
      const launchKj = site.state === 'RUNNING' ? rnd(rng, 620, 980) : rnd(rng, 0, 40);
      return [
        { name: 'launch_energy_kj', value: Math.round(launchKj) },
        {
          name: 'train_interval_sec',
          value:
            site._actualDispatchIntervalEma != null
              ? Math.round(site._actualDispatchIntervalEma * 10) / 10
              : Math.round(site.dispatchIntervalSec * (0.85 + rng() * 0.25) * 10) / 10,
        },
        { name: 'plc_health_ok', value: fault ? 0 : 1 },
        { name: 'inversion_timing_deviation_ms', value: Math.round((run ? rnd(rng, -40, 120) : rnd(rng, -5, 5)) * 10) / 10 },
        { name: 'power_kw', value: Math.round((40 + (run ? rnd(rng, 180, 520) : rnd(rng, 20, 90))) * prof.energyScale * 10) / 10 },
      ];
    }
    case 'euro_mir': {
      const spin = run ? rnd(rng, 4.5, 14.5) : 0;
      return [
        { name: 'rotational_speed_rpm', value: Math.round(spin * 100) / 100 },
        { name: 'lift_status_ok', value: fault ? 0 : 1 },
        { name: 'block_section_occupancy_pct', value: Math.round(clamp(site.queueDepth() / Math.max(1, site.queueCapacityLimit()), 0, 1) * 100) },
        { name: 'motor_current_a', value: Math.round((run ? rnd(rng, 22, 95) : rnd(rng, 2, 12)) * 10) / 10 },
      ];
    }
    case 'poseidon': {
      return [
        { name: 'water_pump_ok', value: fault ? 0 : 1 },
        {
          name: 'boat_interval_sec',
          value: Math.round(site.dispatchIntervalSec * (0.75 + rng() * 0.35) * 10) / 10,
        },
        { name: 'water_level_cm', value: Math.round(100 + rnd(rng, -6, 8) * 10) / 10 },
        { name: 'pump_pressure_bar', value: Math.round((run ? rnd(rng, 2.8, 4.6) : rnd(rng, 0.9, 1.6)) * 100) / 100 },
      ];
    }
    case 'atlantica_supersplash': {
      return [
        { name: 'pump_pressure_bar', value: Math.round((run ? rnd(rng, 2.4, 4.1) : rnd(rng, 0.8, 1.5)) * 100) / 100 },
        { name: 'boat_count', value: Math.max(0, Math.floor(site.trainDispatchCounter % 24)) },
        { name: 'splash_zone_occupancy_pct', value: Math.round(clamp(site.queueDepth() / Math.max(1, site.queueCapacityLimit()), 0, 1) * 100) },
        { name: 'conveyor_speed_m_s', value: Math.round((run ? rnd(rng, 0.35, 1.1) : 0) * 100) / 100 },
      ];
    }
    case 'panorama_bahn': {
      return [
        { name: 'track_occupancy_pct', value: Math.round(clamp(site.queueDepth() / Math.max(1, site.queueCapacityLimit()), 0, 1) * 100) },
        { name: 'train_gps_fix_ok', value: fault ? 0 : 1 },
        { name: 'passenger_count', value: site.guestsInCounter - site.guestsOutCounter },
        { name: 'station_dwell_sec', value: Math.round((run ? rnd(rng, 25, 95) : rnd(rng, 8, 28)) * 10) / 10 },
      ];
    }
    case 'piraten_batavia': {
      return [
        { name: 'boat_position_norm', value: Math.round(t * 1000) / 1000 },
        { name: 'show_scene_ok', value: fault ? 0 : 1 },
        { name: 'animatronic_ok', value: run && rng() > 0.03 ? 1 : fault ? 0 : 1 },
        { name: 'audio_controller_ok', value: fault ? 0 : 1 },
      ];
    }
    case 'snorri': {
      return [
        { name: 'vehicle_position_norm', value: Math.round((t + rng() * 0.02) * 1000) / 1000 },
        { name: 'media_sync_skew_ms', value: Math.round((run ? rnd(rng, -18, 55) : rnd(rng, -4, 4)) * 10) / 10 },
        { name: 'ride_throughput_pph', value: Math.floor(site.actualPphEstimate(prof)) },
      ];
    }
    case 'matterhorn_blitz': {
      return [
        { name: 'brake_status_ok', value: fault ? 0 : 1 },
        { name: 'car_count', value: Math.max(1, Math.min(16, site.configuredTrains + Math.floor(rnd(rng, -1, 2)))) },
        { name: 'track_occupancy_pct', value: Math.round(clamp(site.queueDepth() / Math.max(1, site.queueCapacityLimit()), 0, 1) * 100) },
      ];
    }
    case 'alpenexpress': {
      return [
        { name: 'train_speed_m_s', value: Math.round((run ? rnd(rng, 3.5, 8.8) : rnd(rng, 0, 0.4)) * 100) / 100 },
        { name: 'drive_current_a', value: Math.round((run ? rnd(rng, 28, 120) : rnd(rng, 2, 14)) * 10) / 10 },
        {
          name: 'powered_coach_dispatch_interval_sec',
          value:
            site._actualDispatchIntervalEma != null
              ? Math.round(site._actualDispatchIntervalEma * 10) / 10
              : site.dispatchIntervalSec,
        },
      ];
    }
    case 'eurosat': {
      return [
        { name: 'indoor_temp_c', value: Math.round((21 + rnd(rng, -1.2, 2.4)) * 10) / 10 },
        { name: 'train_position_norm', value: Math.round(t * 1000) / 1000 },
        { name: 'av_light_sync_offset_ms', value: Math.round((run ? rnd(rng, -35, 85) : rnd(rng, -6, 6)) * 10) / 10 },
      ];
    }
    case 'volo_da_vinci': {
      return [
        { name: 'rotation_speed_rpm', value: Math.round((run ? rnd(rng, 6, 18) : rnd(rng, 0, 0.8)) * 100) / 100 },
        { name: 'seat_latched_ok', value: fault ? 0 : 1 },
        {
          name: 'ride_cycle_time_sec',
          value: Math.round((site.baseRideDurationSec() * (0.92 + rng() * 0.12)) * 10) / 10,
        },
      ];
    }
    case 'arthur': {
      return [
        { name: 'rotation_speed_rpm', value: Math.round((run ? rnd(rng, 5, 14) : rnd(rng, 0, 0.6)) * 100) / 100 },
        { name: 'seat_latched_ok', value: fault ? 0 : 1 },
        {
          name: 'ride_cycle_time_sec',
          value: Math.round((site.baseRideDurationSec() * (0.9 + rng() * 0.14)) * 10) / 10,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * @param {*} site AttractionSite
 * @param {number} now
 * @param {Record<string, number>} prof
 * @param {() => number} rng
 * @returns {Array<{ name: string; value: unknown }>}
 */
function getSimulatedOtExtensionMetrics(site, now, prof, rng) {
  if (!simOeeOtMetrics) return [];
  const id = resolveOtProfileId(site.slug);
  if (!id) return [];
  return buildOtMetricsForProfile(id, site, now, prof, rng);
}

module.exports = {
  getSimulatedOtExtensionMetrics,
  resolveOtProfileId,
  buildOtMetricsForProfile,
};
