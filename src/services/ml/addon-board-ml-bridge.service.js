/**
 * Non-blocking bridge for Add-on Board L0/L1/L3: ride-level ML fields and park/zone aggregates.
 */
const { predictRideWaitTimes } = require('./ride-prediction.service');
const { ParkAsset, AssetType } = require('../../models');

const AGG_CACHE_TTL_MS = 45 * 1000;
/** @type {Map<string, { data: object, exp: number }>} */
const aggregateCache = new Map();

function pruneAggregateCache() {
  const t = Date.now();
  for (const [k, v] of aggregateCache) {
    if (!v || v.exp < t) aggregateCache.delete(k);
  }
  if (aggregateCache.size > 150) aggregateCache.clear();
}

function aggregateCacheKey(parkId, opts) {
  return [
    String(parkId),
    opts.zoneId ? String(opts.zoneId) : '',
    Number.isFinite(Number(opts.forecastCriticalMinutes)) ? Number(opts.forecastCriticalMinutes) : 55,
    Number(opts.limit) || 80,
    Number(opts.offset) || 0,
  ].join('|');
}

function pickPredictionMinutes(predictions, m) {
  const p = (predictions || []).find((x) => Number(x.horizonMinutes) === m);
  return p && Number.isFinite(Number(p.value)) ? Number(p.value) : null;
}

function pickSource(predictions, m) {
  const p = (predictions || []).find((x) => Number(x.horizonMinutes) === m);
  return p?.source || null;
}

/**
 * Safe for board aggregation: never throws; returns null fields on failure.
 * @param {string} parkId
 * @param {string} rideId - park_assets.asset_id
 */
async function getRideBoardMlFields(parkId, rideId) {
  try {
    const p = await predictRideWaitTimes({ parkId, rideId, horizons: [5, 10, 15, 30, 60] });
    const src60 = pickSource(p.predictions, 60);
    return {
      forecastWaitTime5: pickPredictionMinutes(p.predictions, 5),
      forecastWaitTime10: pickPredictionMinutes(p.predictions, 10),
      forecastWaitTime15: pickPredictionMinutes(p.predictions, 15),
      forecastWaitTime30: pickPredictionMinutes(p.predictions, 30),
      forecastWaitTime60: pickPredictionMinutes(p.predictions, 60),
      predictionMode: p.predictionMode,
      modelId: p.modelId,
      confidence: p.confidence,
      topFactors: p.topFactors || [],
      forecastSource: src60 === 'ML_MODEL' ? 'ML_MODEL' : 'BASELINE',
    };
  } catch {
    return {
      forecastWaitTime5: null,
      forecastWaitTime10: null,
      forecastWaitTime15: null,
      forecastWaitTime30: null,
      forecastWaitTime60: null,
      predictionMode: 'BASELINE_ONLY',
      modelId: null,
      confidence: null,
      topFactors: [],
      forecastSource: 'BASELINE',
    };
  }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** @param {number|null|undefined} avg60 */
function parkDemandIndexFromAvg60(avg60) {
  if (avg60 == null || !Number.isFinite(avg60)) return 'UNKNOWN';
  if (avg60 < 25) return 'LOW';
  if (avg60 < 45) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Mean 60m forecast; if every value is exactly 0, return null (no real queue signal — typical without snapshots).
 * @param {number[]} values
 * @returns {number|null}
 */
function meaningfulAverageForecast60(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  if (avg === 0 && nums.every((v) => v === 0)) return null;
  return avg;
}

/**
 * @param {{ rideId: string, zoneId: string|null, isOpen: boolean, forecast60: number|null }[]} parts
 * @param {number} thresholdMinutes
 */
function aggregateFromRideForecastParts(parts, thresholdMinutes) {
  const openWith60 = parts.filter((p) => p.isOpen && p.forecast60 != null && Number.isFinite(p.forecast60));
  const avg60 = meaningfulAverageForecast60(openWith60.map((p) => p.forecast60));
  const forecastCriticalRides = openWith60.filter((p) => p.forecast60 >= thresholdMinutes).length;
  const parkDemandForecastIndex = parkDemandIndexFromAvg60(avg60);

  const byZone = new Map();
  for (const p of parts) {
    if (!p.isOpen || p.forecast60 == null || !Number.isFinite(p.forecast60)) continue;
    const zKey = p.zoneId ? String(p.zoneId) : '_unzoned';
    if (!byZone.has(zKey)) byZone.set(zKey, { forecasts: [], critical: 0 });
    const zr = byZone.get(zKey);
    zr.forecasts.push(p.forecast60);
    if (p.forecast60 >= thresholdMinutes) zr.critical += 1;
  }
  const zones = [];
  for (const [zKey, v] of byZone) {
    const zAvg = meaningfulAverageForecast60(v.forecasts);
    zones.push({
      zoneId: zKey === '_unzoned' ? null : zKey,
      zoneForecastWaitTime60: zAvg,
      zoneForecastCriticalRides: v.critical,
      zoneDemandForecastIndex: parkDemandIndexFromAvg60(zAvg),
    });
  }
  zones.sort((a, b) => String(a.zoneId || '').localeCompare(String(b.zoneId || '')));

  return {
    parkDemandForecastIndex,
    averageForecastWaitTime60: avg60,
    forecastCriticalRides,
    ridesConsidered: parts.length,
    openRidesWithForecast: openWith60.length,
    zones,
    thresholdMinutes,
  };
}

function assetIsOpenForForecast(plain) {
  if (plain.openingFlag === false) return false;
  if (plain.openingFlag === true) return true;
  const s = String(plain.status || '').toUpperCase();
  if (['CLOSED', 'DOWN', 'MAINTENANCE', 'DEFUNCT'].includes(s)) return false;
  return true;
}

/**
 * L0/L1 board aggregates: calls ride prediction per asset (batched); never throws.
 * @param {string} parkId
 * @param {{ zoneId?: string|null, forecastCriticalMinutes?: number, limit?: number, offset?: number, batchSize?: number }} [opts]
 */
async function getParkBoardMlAggregates(parkId, opts = {}) {
  pruneAggregateCache();
  const cacheKey = aggregateCacheKey(parkId, opts);
  const cached = aggregateCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    return { ...cached.data, cacheHit: true };
  }

  const thresholdMinutes = Number(opts.forecastCriticalMinutes);
  const criticalAt = Number.isFinite(thresholdMinutes) ? thresholdMinutes : 55;
  const maxRides = Math.min(200, Math.max(1, Number(opts.limit) || 80));
  const offset = Math.max(0, Math.min(500, Number(opts.offset) || 0));
  const batchSize = Math.min(20, Math.max(2, Number(opts.batchSize) || 10));
  const zoneIdFilter = opts.zoneId ? String(opts.zoneId) : null;

  const timestamp = new Date().toISOString();
  try {
    const where = { parkId: String(parkId), activeFlag: true };
    if (zoneIdFilter) where.zoneId = zoneIdFilter;

    const assets = await ParkAsset.findAll({
      where,
      include: [{ model: AssetType, as: 'assetType', required: true, where: { code: 'RIDE' } }],
      attributes: ['assetId', 'zoneId', 'openingFlag', 'status', 'name'],
      limit: maxRides,
      offset,
      order: [['name', 'ASC']],
    });

    const parts = [];
    for (const batch of chunkArray(assets, batchSize)) {
      const slice = await Promise.all(
        batch.map(async (row) => {
          const plain = row.get({ plain: true });
          const ml = await getRideBoardMlFields(parkId, plain.assetId);
          return {
            rideId: String(plain.assetId),
            zoneId: plain.zoneId === null || plain.zoneId === undefined ? null : String(plain.zoneId),
            rideName: plain.name,
            isOpen: assetIsOpenForForecast(plain),
            forecast60: ml.forecastWaitTime60,
            forecastSource60: ml.forecastSource,
          };
        })
      );
      parts.push(...slice);
    }

    const agg = aggregateFromRideForecastParts(parts, criticalAt);
    const result = {
      timestamp,
      scope: zoneIdFilter ? 'zone' : 'park',
      zoneId: zoneIdFilter,
      offset,
      ...agg,
    };
    aggregateCache.set(cacheKey, { data: result, exp: Date.now() + AGG_CACHE_TTL_MS });
    return result;
  } catch {
    return {
      timestamp,
      scope: zoneIdFilter ? 'zone' : 'park',
      zoneId: zoneIdFilter,
      parkDemandForecastIndex: 'UNKNOWN',
      averageForecastWaitTime60: null,
      forecastCriticalRides: 0,
      ridesConsidered: 0,
      openRidesWithForecast: 0,
      zones: [],
      thresholdMinutes: criticalAt,
      note: 'AGGREGATE_FAILED',
    };
  }
}

module.exports = {
  getRideBoardMlFields,
  pickPredictionMinutes,
  parkDemandIndexFromAvg60,
  meaningfulAverageForecast60,
  aggregateFromRideForecastParts,
  getParkBoardMlAggregates,
};
