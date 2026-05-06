/**
 * AI Studio Phase 1 — real training rows from ride_feature_snapshots_5m (+ matching park snapshot).
 * Traffic and neighbor_wait_times are intentionally excluded from mapped features (no reliable column / not configured).
 *
 * Staffing uses staffing_gap_normal from snapshots — populated via a heuristic (placeholder norm), not full workforce planning.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op } = require('sequelize');
const { RideFeatureSnapshot, ParkFeatureSnapshot } = require('../models');

/** Studio feature codes that can be backed by snapshot columns for FEATURE_STORE training. */
const FEATURE_STORE_TRAIN_FEATURES = [
  'weather',
  'holiday',
  'school_break',
  'time_of_day',
  'day_of_week',
  'staffing',
  'capacity',
  'historical_demand',
];

function num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function plain(row) {
  return row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

/**
 * Single scalar weather composite (0..1) from temp / precip / rain probability.
 * Prefers park snapshot when ride row omitted weather (feature store often richer on park rows).
 */
function compositeWeather(ridePlain, parkPlain) {
  const temp = num(parkPlain?.temperatureC ?? ridePlain?.temperatureC, null);
  const precip = num(parkPlain?.precipitationMm ?? ridePlain?.precipitationMm, null);
  const rainProb = num(parkPlain?.rainProbabilityPercent ?? ridePlain?.rainProbabilityPercent, null);
  const parts = [];
  if (temp != null) parts.push(Math.max(0, Math.min(1, temp / 35)));
  if (precip != null) parts.push(Math.max(0, Math.min(1, precip / 10)));
  if (rainProb != null) parts.push(Math.max(0, Math.min(1, rainProb / 100)));
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

/**
 * Map persisted snapshot columns → AI Studio abstract feature scalars.
 * Does not produce traffic or neighbor_wait_times (excluded from FEATURE_STORE; no joined neighbor aggregation in Phase 1).
 *
 * @param {Record<string, unknown>} rideSnapshot - ride_feature_snapshots_5m plain row
 * @param {Record<string, unknown>|null} parkSnapshot - matching park_feature_snapshots_5m plain row or null
 * @returns {Record<string, number|null>} Only FEATURE_STORE_TRAIN_FEATURES keys
 */
function mapSnapshotRowToStudioFeatures(rideSnapshot, parkSnapshot) {
  const r = rideSnapshot || {};
  const p = parkSnapshot || {};

  const weather = compositeWeather(r, p);

  const holidayRaw = p.isPublicHoliday ?? p.is_public_holiday ?? r.isPublicHoliday ?? r.is_public_holiday;
  const holiday = holidayRaw === true || holidayRaw === false ? (holidayRaw ? 1 : 0) : null;

  const schoolRaw = p.isSchoolHoliday ?? p.is_school_holiday ?? r.isSchoolHoliday ?? r.is_school_holiday;
  const school_break = schoolRaw === true || schoolRaw === false ? (schoolRaw ? 1 : 0) : null;

  let time_of_day = num(p.localHour ?? p.local_hour, null);
  if (time_of_day == null && r.snapshotAt) {
    /* Fallback: UTC hour — weaker signal when park TZ unknown on park row */
    time_of_day = new Date(r.snapshotAt).getUTCHours();
  }

  let day_of_week = num(p.dayOfWeek ?? p.day_of_week, null);
  if (day_of_week == null && r.snapshotAt) {
    day_of_week = new Date(r.snapshotAt).getUTCDay();
  }

  const staffingRaw = r.staffingGapNormal ?? r.staffing_gap_normal;
  const staffing = staffingRaw != null && staffingRaw !== '' ? num(staffingRaw, null) : null;

  const capRaw = r.theoreticalCapacityPph ?? r.theoretical_capacity_pph;
  const capacity = capRaw != null && capRaw !== '' ? num(capRaw, null) : null;

  const hist =
    num(r.rollingAvgWait60m ?? r.rolling_avg_wait_60m, null) ??
    num(r.waitTime ?? r.wait_time, null) ??
    num(r.currentWaitTimeMin ?? r.current_wait_time_min, null);

  const historical_demand = hist != null ? hist : null;

  return {
    weather,
    holiday,
    school_break,
    time_of_day,
    day_of_week,
    staffing,
    capacity,
    historical_demand,
  };
}

/**
 * Build supervised rows for one ride asset: X from snapshots at t, Y = wait at t+horizon (nearest bucket).
 *
 * @param {string} parkId - internal park UUID
 * @param {object} options
 * @param {string} options.internalAssetId - park_assets.asset_id
 * @param {number} [options.horizonMinutes=15]
 * @param {number} [options.limit=5000]
 * @param {string} [options.provider] - optional filter
 * @returns {Promise<Array<{ snapshotAt: Date, features: Record<string, number|null>, targetWaitPlusHorizon: number|null }>>}
 */
async function buildRideStudioRows(parkId, options = {}) {
  const internalAssetId = options.internalAssetId;
  if (!parkId || !internalAssetId) return [];

  const horizonMinutes = Number(options.horizonMinutes) || 15;
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 5000));

  const where = {
    internalParkId: parkId,
    internalAssetId: String(internalAssetId),
  };
  if (options.provider) where.provider = String(options.provider);

  const rides = await RideFeatureSnapshot.findAll({
    where,
    order: [['snapshotAt', 'ASC']],
    limit,
  });

  const out = [];
  for (const row of rides) {
    const ridePlain = plain(row);
    // eslint-disable-next-line no-await-in-loop
    const parkRow = await ParkFeatureSnapshot.findOne({
      where: {
        provider: ridePlain.provider,
        externalParkId: ridePlain.externalParkId,
        snapshotAt: ridePlain.snapshotAt,
      },
    });
    const parkPlain = parkRow ? plain(parkRow) : null;
    const features = mapSnapshotRowToStudioFeatures(ridePlain, parkPlain);

    const targetAt = new Date(new Date(ridePlain.snapshotAt).getTime() + horizonMinutes * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    const fut = await RideFeatureSnapshot.findOne({
      where: {
        provider: ridePlain.provider,
        externalParkId: ridePlain.externalParkId,
        externalEntityId: ridePlain.externalEntityId,
        snapshotAt: {
          [Op.between]: [
            new Date(targetAt.getTime() - 7.5 * 60 * 1000),
            new Date(targetAt.getTime() + 7.5 * 60 * 1000),
          ],
        },
      },
      order: [['snapshotAt', 'ASC']],
    });

    const y = fut && fut.waitTime != null ? Number(fut.waitTime) : null;
    out.push({
      snapshotAt: ridePlain.snapshotAt instanceof Date ? ridePlain.snapshotAt : new Date(ridePlain.snapshotAt),
      features,
      targetWaitPlusHorizon: Number.isFinite(y) ? y : null,
    });
  }

  return out;
}

/**
 * Summary counts for dataset-stats preview (no feature subset filtering).
 */
async function summarizeRideFeatureStoreRows(parkId, internalAssetId, horizonMinutes = 15) {
  const rows = await buildRideStudioRows(parkId, {
    internalAssetId,
    horizonMinutes,
    limit: 8000,
  });
  const labeled = rows.filter((r) => r.targetWaitPlusHorizon != null);
  const dates = rows.map((r) => r.snapshotAt.getTime()).filter(Number.isFinite);
  const dateFrom = dates.length ? new Date(Math.min(...dates)).toISOString() : null;
  const dateTo = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  return {
    snapshotBucketRows: rows.length,
    labeledHorizonRows: labeled.length,
    dateFrom,
    dateTo,
    horizonMinutes,
  };
}

module.exports = {
  FEATURE_STORE_TRAIN_FEATURES,
  mapSnapshotRowToStudioFeatures,
  buildRideStudioRows,
  summarizeRideFeatureStoreRows,
};
