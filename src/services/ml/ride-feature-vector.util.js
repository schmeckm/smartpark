/**
 * Feature vector for ride wait-time ML (aligned with Phase 2 spec; uses ride_feature_snapshots_5m columns).
 */

const TRAINING_FEATURE_NAMES = [
  'current_wait_time',
  'wait_time_trend_30m',
  'ride_status_num',
  'park_crowd_index',
  'zone_congestion_score',
  'rain_mm',
  'temperature_c',
  'school_holiday',
  'time_of_day',
];

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function statusToNum(status, isOpen) {
  const s = String(status || '').toUpperCase();
  if (s.includes('DOWN') || s.includes('E_STOP')) return -1;
  if (s.includes('MAINT')) return -0.5;
  if (s.includes('CLOSED') || isOpen === false) return 0;
  if (s.includes('OPEN') || s.includes('RUN') || isOpen === true) return 1;
  return 0.25;
}

/**
 * @param {object} row - RideFeatureSnapshot plain
 * @returns {Record<string, number>}
 */
function snapshotToFeatureMap(row) {
  const cur = n(row.currentWaitTimeMin ?? row.waitTime, NaN);
  const currentWaitTime = Number.isFinite(cur) ? cur : 0;
  const roll15 = n(row.rollingAvgWait15m, currentWaitTime);
  const roll60 = n(row.rollingAvgWait60m, currentWaitTime);
  const delta5 = n(row.waitTimeDelta5m, 0);
  const trendFromDelta = delta5 * 6;
  const trendFromRolling = (currentWaitTime - roll15) * 2;
  const waitTimeTrend30m = Number.isFinite(trendFromRolling) ? trendFromRolling : trendFromDelta;

  const extras = row.xFeaturesExtras && typeof row.xFeaturesExtras === 'object' ? row.xFeaturesExtras : {};
  const zoneCongestion = n(extras.zoneCongestionScore ?? extras.zone_congestion_score, NaN);
  const zoneCongestionScore = Number.isFinite(zoneCongestion) ? zoneCongestion : n(row.parkCrowdIndex, 0);

  const ts = row.snapshotAt ? new Date(row.snapshotAt) : new Date();
  const hod = ts.getUTCHours() + ts.getUTCMinutes() / 60;

  return {
    current_wait_time: currentWaitTime,
    wait_time_trend_30m: n(waitTimeTrend30m, 0),
    ride_status_num: statusToNum(row.status, row.isOpen),
    park_crowd_index: n(row.parkCrowdIndex, 0),
    zone_congestion_score: zoneCongestionScore,
    rain_mm: n(row.precipitationMm, 0),
    temperature_c: n(row.temperatureC, 0),
    school_holiday: row.isSchoolHoliday ? 1 : 0,
    time_of_day: hod,
  };
}

function featureVectorFromMap(map) {
  return TRAINING_FEATURE_NAMES.map((k) => n(map[k], 0));
}

/**
 * Zero ride-wait ML inputs the operator turned off in master data (`useForMl: false` for mapped catalog codes).
 * Keeps `TRAINING_FEATURE_NAMES` order/length for existing ridge payloads.
 * @param {Record<string, number>} featureMap - from `snapshotToFeatureMap`
 * @param {Set<string>|null|undefined} disabledKeys - subset of `TRAINING_FEATURE_NAMES`
 * @returns {Record<string, number>}
 */
function applyMlFeatureMask(featureMap, disabledKeys) {
  if (!disabledKeys || disabledKeys.size === 0) return featureMap;
  const out = { ...featureMap };
  for (const k of TRAINING_FEATURE_NAMES) {
    if (disabledKeys.has(k)) out[k] = 0;
  }
  return out;
}

module.exports = {
  TRAINING_FEATURE_NAMES,
  snapshotToFeatureMap,
  featureVectorFromMap,
  applyMlFeatureMask,
};
