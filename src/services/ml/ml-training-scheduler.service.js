/**
 * Periodic retraining for wait-time ridge models (global daily per park; ride batch every ~5 days).
 */
const { Op, fn, col } = require('sequelize');
const { logger } = require('../../utils/logger');
const { Park, ParkAsset, AssetType, RideWaitTimeSample } = require('../../models');
const { trainGlobalModel, trainRideModel } = require('./ride-model-training.service');

const BETWEEN_PARKS_MS = 2500;
const RIDE_ASSETS_PER_PARK = 15;
/** Prefer rides with more recent wait samples when picking batch candidates. */
const SAMPLE_LOOKBACK_DAYS = 90;

/**
 * @param {string[]} assetIds
 * @returns {Promise<Map<string, number>>}
 */
async function waitSampleCountsByAsset(assetIds) {
  const m = new Map();
  if (!assetIds.length) return m;
  const since = new Date(Date.now() - SAMPLE_LOOKBACK_DAYS * 86400000);
  const rows = await RideWaitTimeSample.findAll({
    attributes: ['parkAssetId', [fn('COUNT', col('id')), 'cnt']],
    where: {
      parkAssetId: { [Op.in]: assetIds },
      sampledAt: { [Op.gte]: since },
    },
    group: ['parkAssetId'],
    raw: true,
  });
  for (const row of rows) {
    const id = row.parkAssetId != null ? String(row.parkAssetId) : null;
    if (!id) continue;
    m.set(id, Number(row.cnt) || 0);
  }
  return m;
}

class MlTrainingSchedulerService {
  constructor() {
    this.timer = null;
    this.lastGlobalTrainDate = null;
    this.lastRideBatchMs = 0;
  }

  /**
   * @returns {Promise<() => void>}
   */
  async start() {
    const tickMs = 60 * 1000;
    this.timer = setInterval(() => {
      this._tick().catch((e) => logger.warn({ err: e.message }, 'ml-training-scheduler tick failed'));
    }, tickMs);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  async _tick() {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0 && this.lastGlobalTrainDate !== ymd) {
      this.lastGlobalTrainDate = ymd;
      const parks = await Park.findAll({ attributes: ['id'], order: [['createdAt', 'ASC']] });
      if (!parks.length) {
        logger.info('ml-training-scheduler: no parks, skip global train');
        return;
      }
      for (const p of parks) {
        try {
          const r = await trainGlobalModel({ parkId: String(p.id), rowLimit: 12000 });
          logger.info({ parkId: p.id, r }, 'ml-training-scheduler: global wait-time train finished');
        } catch (e) {
          logger.warn({ err: e.message, parkId: p.id }, 'ml-training-scheduler: global train failed');
        }
        await new Promise((resolve) => setTimeout(resolve, BETWEEN_PARKS_MS));
      }
    }

    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    if (
      Date.now() - this.lastRideBatchMs > fiveDaysMs &&
      now.getUTCHours() === 5 &&
      now.getUTCMinutes() === 0
    ) {
      this.lastRideBatchMs = Date.now();
      await this._rideSpecificBatch();
    }
  }

  /**
   * Best-effort ride-specific training for a few rides per park (criteria inside trainRideModel).
   */
  async _rideSpecificBatch() {
    const rideType = await AssetType.findOne({ where: { code: 'RIDE' } });
    if (!rideType) {
      logger.info('ml-training-scheduler: no RIDE asset type, skip ride batch');
      return;
    }
    const parks = await Park.findAll({ attributes: ['id'], order: [['createdAt', 'ASC']] });
    for (const p of parks) {
      const allRideAssets = await ParkAsset.findAll({
        where: { parkId: p.id, assetTypeId: rideType.id, activeFlag: true },
        attributes: ['assetId', 'name'],
        order: [['name', 'ASC']],
        limit: 200,
      });
      const assetIds = allRideAssets.map((x) => String(x.assetId));
      const countMap = await waitSampleCountsByAsset(assetIds);
      const sorted = [...allRideAssets].sort((a, b) => {
        const ca = countMap.get(String(a.assetId)) || 0;
        const cb = countMap.get(String(b.assetId)) || 0;
        if (cb !== ca) return cb - ca;
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
      });
      const assets = sorted.slice(0, RIDE_ASSETS_PER_PARK);
      let trained = 0;
      let skipped = 0;
      const reasonTally = {};
      for (const a of assets) {
        try {
          const r = await trainRideModel(String(a.assetId), { parkId: String(p.id), rowLimit: 20000 });
          if (r.trained) trained += 1;
          else {
            skipped += 1;
            const key = r.reason || 'UNKNOWN';
            reasonTally[key] = (reasonTally[key] || 0) + 1;
          }
          logger.info({ parkId: p.id, assetId: a.assetId, r }, 'ml-training-scheduler: ride-specific train attempt');
        } catch (e) {
          skipped += 1;
          logger.warn({ err: e.message, parkId: p.id, assetId: a.assetId }, 'ml-training-scheduler: ride train error');
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      logger.info(
        {
          parkId: p.id,
          candidates: assets.length,
          sampleLookbackDays: SAMPLE_LOOKBACK_DAYS,
          trained,
          skipped,
          reasonTally,
        },
        'ml-training-scheduler: ride batch park summary'
      );
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_PARKS_MS));
    }
    logger.info('ml-training-scheduler: ride-specific batch pass completed');
  }
}

module.exports = { MlTrainingSchedulerService };
