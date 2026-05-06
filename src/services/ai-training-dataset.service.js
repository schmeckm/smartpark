/**
 * Training rows from ride feature snapshots; park context from auth, not free-form parkId in query.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op } = require('sequelize');
const { Park, RideFeatureSnapshot } = require('../models');

function horizonFromTarget(target) {
  const t = String(target || 'queue_time_15m').toLowerCase();
  if (t.includes('120')) return 120;
  if (t.includes('60')) return 60;
  return 15;
}

function plain(row) {
  return row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

/**
 * Build ride-level training rows: X = snapshot columns at t, Y = wait at t+H (nearest 5m bucket).
 * @param {string} parkId - internal UUID (park context)
 * @param {{ target?: string, limit?: number }} opts
 */
async function buildRideQueueTrainingDataset(parkId, opts = {}) {
  const limit = Math.min(2000, Math.max(1, Number(opts.limit) || 400));
  const horizon = horizonFromTarget(opts.target);
  const park = await Park.findByPk(parkId);
  if (!park) {
    return { target: opts.target || 'queue_time_15m', horizonMinutes: horizon, rows: [] };
  }
  const extPark = park.externalEntityId ? String(park.externalEntityId) : null;

  const whereOr = [{ internalParkId: parkId }];
  if (extPark) {
    whereOr.push({ provider: 'themeparks_wiki', externalParkId: extPark });
  }

  const snaps = await RideFeatureSnapshot.findAll({
    where: { [Op.or]: whereOr },
    order: [['snapshotAt', 'DESC']],
    limit,
  });
  if (!snaps.length) {
    return { target: opts.target || 'queue_time_15m', horizonMinutes: horizon, rows: [] };
  }

  const rows = [];
  for (const s of snaps) {
    const cur = plain(s);
    const targetAt = new Date(new Date(cur.snapshotAt).getTime() + horizon * 60 * 1000);
    // eslint-disable-next-line no-await-in-loop
    const fut = await RideFeatureSnapshot.findOne({
      where: {
        provider: cur.provider,
        externalParkId: cur.externalParkId,
        externalEntityId: cur.externalEntityId,
        snapshotAt: {
          [Op.between]: [
            new Date(targetAt.getTime() - 7.5 * 60 * 1000),
            new Date(targetAt.getTime() + 7.5 * 60 * 1000),
          ],
        },
      },
      order: [['snapshotAt', 'ASC']],
    });
    const {
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      ...features
    } = cur;
    const y = fut && fut.waitTime != null ? Number(fut.waitTime) : null;
    rows.push({
      timestamp: new Date(cur.snapshotAt).toISOString(),
      assetId: cur.internalAssetId || null,
      externalEntityId: cur.externalEntityId,
      features,
      target: y,
      targetQuality: fut ? 'OK' : 'MISSING_FUTURE_BUCKET',
    });
  }

  return {
    target: opts.target || 'queue_time_15m',
    horizonMinutes: horizon,
    parkId,
    rows,
  };
}

module.exports = { buildRideQueueTrainingDataset, horizonFromTarget };
