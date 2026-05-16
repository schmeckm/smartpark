/**
 * AI Studio FEATURE_STORE — supervised rows from ride_feature_snapshots_5m.
 * Feature columns use the same mapping as ride wait Ridge / `ride-feature-vector.util.js`
 * (`snapshotToFeatureMap`, `TRAINING_FEATURE_NAMES`) so training matches the Prognosen ML path.
 *
 * Y = wait at t+horizon (nearest 5m bucket). FEATURE_STORE: horizon 15, target `wait_time_plus_15`.
 *
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op } = require('sequelize');
const { RideFeatureSnapshot } = require('../models');
const {
  snapshotToFeatureMap,
  TRAINING_FEATURE_NAMES,
} = require('./ml/ride-feature-vector.util');

/** Same keys as Ridge training / predict — keep in lockstep with `ride-feature-vector.util.js`. */
const FEATURE_STORE_TRAIN_FEATURES = [...TRAINING_FEATURE_NAMES];

function plain(row) {
  return row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

/**
 * @param {Record<string, unknown>} rideSnapshot - ride_feature_snapshots_5m plain row
 * @returns {Record<string, number>} Ridge-aligned feature scalars (dense, finite)
 */
function mapSnapshotRowToStudioFeatures(rideSnapshot) {
  return snapshotToFeatureMap(rideSnapshot || {});
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
 * @returns {Promise<Array<{ snapshotAt: Date, features: Record<string, number>, targetWaitPlusHorizon: number|null }>>}
 */
async function buildRideStudioRows(parkId, options = {}) {
  const internalAssetId = options.internalAssetId;
  if (!parkId || !internalAssetId) return [];

  const horizonMinutes = Number(options.horizonMinutes) || 15;
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 5000));

  const where = {
    internalParkId: parkId,
    internalAssetId: String(internalAssetId),
    trainingEligible: true,
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
    const features = mapSnapshotRowToStudioFeatures(ridePlain);

    const targetAt = new Date(new Date(ridePlain.snapshotAt).getTime() + horizonMinutes * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    const fut = await RideFeatureSnapshot.findOne({
      where: {
        provider: ridePlain.provider,
        externalParkId: ridePlain.externalParkId,
        externalEntityId: ridePlain.externalEntityId,
        trainingEligible: true,
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

/**
 * Whether the raw snapshot row has a non-imputed source for this training feature key
 * (before `snapshotToFeatureMap` defaults). Used for FEATURE_STORE X quality / gap rates.
 *
 * @param {Record<string, unknown>} plain - ride_feature_snapshots_5m plain row (camelCase)
 * @param {string} featureKey - member of TRAINING_FEATURE_NAMES
 */
function rawStudioFeaturePresent(plain, featureKey) {
  if (!plain || typeof plain !== 'object') return false;
  switch (featureKey) {
    case 'current_wait_time':
      return plain.waitTime != null || plain.currentWaitTimeMin != null;
    case 'wait_time_trend_30m':
      if (plain.waitTimeDelta5m != null) return true;
      if (plain.rollingAvgWait15m != null) return true;
      if (plain.rollingAvgWait60m != null) return true;
      return plain.waitTime != null || plain.currentWaitTimeMin != null;
    case 'ride_status_num':
      if (plain.status != null && String(plain.status).trim() !== '') return true;
      return plain.isOpen === true || plain.isOpen === false;
    case 'park_crowd_index':
      return plain.parkCrowdIndex != null;
    case 'zone_congestion_score': {
      const ex = plain.xFeaturesExtras && typeof plain.xFeaturesExtras === 'object' ? plain.xFeaturesExtras : {};
      if (ex.zoneCongestionScore != null && Number.isFinite(Number(ex.zoneCongestionScore))) return true;
      if (ex.zone_congestion_score != null && Number.isFinite(Number(ex.zone_congestion_score))) return true;
      return plain.parkCrowdIndex != null;
    }
    case 'rain_mm':
      return plain.precipitationMm != null;
    case 'temperature_c':
      return plain.temperatureC != null;
    case 'school_holiday':
      return plain.isSchoolHoliday === true || plain.isSchoolHoliday === false;
    case 'time_of_day':
      return plain.snapshotAt != null;
    default:
      return false;
  }
}

/**
 * Single bulk read — no per-row horizon lookups. Shares eligibility filter with training rows.
 *
 * @returns {Promise<{ coverage: Record<string, number>, rowsAnalyzed: number }>}
 * `coverage` keys are completeness ratios in [0,1]: (rows with raw non-null X) / (total rows).
 */
async function computeRideFeatureStoreCoverage(parkId, internalAssetId, options = {}) {
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 8000));
  if (!parkId || !internalAssetId) {
    const empty = {};
    for (const k of TRAINING_FEATURE_NAMES) empty[k] = 0;
    return { coverage: empty, rowsAnalyzed: 0 };
  }

  const rows = await RideFeatureSnapshot.findAll({
    where: {
      internalParkId: parkId,
      internalAssetId: String(internalAssetId),
      trainingEligible: true,
    },
    order: [['snapshotAt', 'ASC']],
    limit,
    attributes: [
      'snapshotAt',
      'waitTime',
      'currentWaitTimeMin',
      'waitTimeDelta5m',
      'rollingAvgWait15m',
      'rollingAvgWait60m',
      'status',
      'isOpen',
      'parkCrowdIndex',
      'xFeaturesExtras',
      'precipitationMm',
      'temperatureC',
      'isSchoolHoliday',
    ],
    raw: true,
  });

  const n = rows.length;
  const counts = Object.fromEntries(TRAINING_FEATURE_NAMES.map((k) => [k, 0]));
  for (let i = 0; i < n; i += 1) {
    const plain = rows[i];
    for (const k of TRAINING_FEATURE_NAMES) {
      if (rawStudioFeaturePresent(plain, k)) counts[k] += 1;
    }
  }

  const coverage = {};
  if (n === 0) {
    for (const k of TRAINING_FEATURE_NAMES) coverage[k] = 0;
  } else {
    const inv = 1 / n;
    for (const k of TRAINING_FEATURE_NAMES) {
      coverage[k] = Number((counts[k] * inv).toFixed(4));
    }
  }

  return { coverage, rowsAnalyzed: n };
}

module.exports = {
  FEATURE_STORE_TRAIN_FEATURES,
  mapSnapshotRowToStudioFeatures,
  buildRideStudioRows,
  summarizeRideFeatureStoreRows,
  computeRideFeatureStoreCoverage,
  rawStudioFeaturePresent,
};
