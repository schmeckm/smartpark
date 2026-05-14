/**
 * AI Studio FEATURE_STORE — supervised rows from ride_feature_snapshots_5m.
 * Feature columns use the same mapping as ride wait Ridge / `ride-feature-vector.util.js`
 * (`snapshotToFeatureMap`, `TRAINING_FEATURE_NAMES`) so training matches the Prognosen ML path.
 *
 * Y = wait at t+horizon (nearest 5m bucket). Phase 1: horizon 15, target `wait_time_plus_15`.
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

module.exports = {
  FEATURE_STORE_TRAIN_FEATURES,
  mapSnapshotRowToStudioFeatures,
  buildRideStudioRows,
  summarizeRideFeatureStoreRows,
};
