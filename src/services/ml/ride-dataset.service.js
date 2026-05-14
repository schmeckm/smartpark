/**
 * ML dataset from ride_feature_snapshots_5m: join snapshot at t with wait at t+H.
 */
const { Op } = require('sequelize');
const { Park, RideFeatureSnapshot } = require('../../models');
const { snapshotToFeatureMap, TRAINING_FEATURE_NAMES, applyMlFeatureMask } = require('./ride-feature-vector.util');
const { loadExplicitlyDisabledMlFeatureKeysBatch } = require('./ride-ml-feature-mask.service');
const { isTrainingEligiblePlain } = require('../../utils/ride-snapshot-eligibility.util');

const DEFAULT_HORIZONS = [15, 30, 60];
const HALF_WINDOW_MS = 7.5 * 60 * 1000;

function plain(row) {
  return row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

function rideGroupKey(p) {
  return `${p.provider}|${p.externalParkId}|${p.externalEntityId}`;
}

/**
 * @param {Array<{snapshotAt: Date|string, waitTime?: number, currentWaitTimeMin?: number}>} sortedAsc
 * @param {number} startIdx
 * @param {number} horizonMin
 * @returns {number|null}
 */
function findWaitAtHorizon(sortedAsc, startIdx, horizonMin) {
  if (!isTrainingEligiblePlain(sortedAsc[startIdx])) return null;
  const t0 = new Date(sortedAsc[startIdx].snapshotAt).getTime();
  const mid = t0 + horizonMin * 60 * 1000;
  const lo = mid - HALF_WINDOW_MS;
  const hi = mid + HALF_WINDOW_MS;
  for (let j = startIdx + 1; j < sortedAsc.length; j++) {
    if (!isTrainingEligiblePlain(sortedAsc[j])) continue;
    const ts = new Date(sortedAsc[j].snapshotAt).getTime();
    if (ts > hi) return null;
    if (ts >= lo && ts <= hi) {
      const w = sortedAsc[j].waitTime ?? sortedAsc[j].currentWaitTimeMin;
      if (w == null || !Number.isFinite(Number(w))) continue;
      return Number(w);
    }
  }
  return null;
}

function zoneIdFromSnapshot(p) {
  const x = p.xFeaturesExtras && typeof p.xFeaturesExtras === 'object' ? p.xFeaturesExtras : {};
  return x.zoneId != null ? String(x.zoneId) : x.zone_id != null ? String(x.zone_id) : null;
}

/**
 * @param {object} opts
 * @param {string} [opts.parkId] - internal park UUID
 * @param {string} [opts.rideId] - internal asset UUID
 * @param {Date|string} [opts.from]
 * @param {Date|string} [opts.to]
 * @param {number[]} [opts.horizons]
 * @param {number} [opts.rowLimit] - max snapshots scanned (default 8000)
 */
async function buildRideDataset(opts = {}) {
  const horizons = Array.isArray(opts.horizons) && opts.horizons.length ? opts.horizons.map(Number) : DEFAULT_HORIZONS;
  const maxH = Math.max(...horizons, 60);
  const rowLimit = Math.min(50000, Math.max(100, Number(opts.rowLimit) || 8000));

  const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const to = opts.to ? new Date(opts.to) : new Date();

  const loadTo = new Date(to.getTime() + maxH * 60 * 1000 + HALF_WINDOW_MS);
  const parts = [{ snapshotAt: { [Op.between]: [from, loadTo] } }];
  if (opts.parkId) {
    const park = await Park.findByPk(opts.parkId, { attributes: ['id', 'externalEntityId'] });
    const extPark = park?.externalEntityId ? String(park.externalEntityId) : null;
    const or = [{ internalParkId: opts.parkId }];
    if (extPark) or.push({ provider: 'themeparks_wiki', externalParkId: extPark });
    parts.push({ [Op.or]: or });
  }
  if (opts.rideId) {
    parts.push({ internalAssetId: String(opts.rideId) });
  }
  const where = parts.length === 1 ? parts[0] : { [Op.and]: parts };

  const snaps = await RideFeatureSnapshot.findAll({
    where,
    order: [['snapshotAt', 'ASC']],
    limit: rowLimit,
  });
  const plains = snaps.map(plain);

  const maskPairList = [];
  const seenMaskPair = new Set();
  for (const p of plains) {
    if (p.internalParkId && p.internalAssetId) {
      const k = `${p.internalParkId}|${p.internalAssetId}`;
      if (!seenMaskPair.has(k)) {
        seenMaskPair.add(k);
        maskPairList.push({ parkId: String(p.internalParkId), rideId: String(p.internalAssetId) });
      }
    }
  }
  const mlFeatureMaskByRide = await loadExplicitlyDisabledMlFeatureKeysBatch(maskPairList);

  const groups = new Map();
  for (const p of plains) {
    const k = rideGroupKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const rows = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const [, arr] of groups) {
    arr.sort((a, b) => new Date(a.snapshotAt) - new Date(b.snapshotAt));
    for (let i = 0; i < arr.length; i++) {
      if (!isTrainingEligiblePlain(arr[i])) continue;
      const t = new Date(arr[i].snapshotAt).getTime();
      if (t < fromMs || t > toMs) continue;
      const targets = {};
      let any = false;
      for (const h of horizons) {
        const y = findWaitAtHorizon(arr, i, h);
        targets[`wait_time_${h}`] = y;
        if (y != null) any = true;
      }
      if (!any) continue;
      const rawFeatures = snapshotToFeatureMap(arr[i]);
      const ip = arr[i].internalParkId;
      const ia = arr[i].internalAssetId;
      const maskKey = ip && ia ? `${String(ip)}|${String(ia)}` : null;
      const disabled = maskKey ? mlFeatureMaskByRide.get(maskKey) : null;
      const features = applyMlFeatureMask(rawFeatures, disabled);
      const parkId = arr[i].internalParkId || arr[i].externalParkId;
      const rideId = arr[i].internalAssetId || arr[i].externalEntityId;
      rows.push({
        timestamp: new Date(arr[i].snapshotAt).toISOString(),
        parkId: parkId != null ? String(parkId) : null,
        zoneId: zoneIdFromSnapshot(arr[i]),
        rideId: rideId != null ? String(rideId) : null,
        features,
        targets,
      });
    }
  }

  const stats = computeDatasetStats(rows, horizons);
  const sampleRows = rows.slice(0, Math.min(5, rows.length));

  return {
    horizons,
    rowCount: rows.length,
    rows,
    stats,
    sampleRows,
  };
}

function computeDatasetStats(rows, horizons) {
  const targetCoverage = {};
  for (const h of horizons) {
    const key = `wait_time_${h}`;
    const ok = rows.filter((r) => r.targets[key] != null).length;
    targetCoverage[key] = rows.length ? ok / rows.length : 0;
  }
  const missingRate = {};
  for (const name of TRAINING_FEATURE_NAMES) {
    let miss = 0;
    for (const r of rows) {
      const v = r.features[name];
      if (v == null || !Number.isFinite(Number(v))) miss++;
    }
    missingRate[name] = rows.length ? miss / rows.length : 0;
  }
  return { targetCoverage, missingRate };
}

module.exports = {
  buildRideDataset,
  findWaitAtHorizon,
  DEFAULT_HORIZONS,
};
