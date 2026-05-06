/**
 * Park / entity wait forecasts: baseline from snapshot series, then X-layer, then ML enterprise layer.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { ParkFeatureSnapshot, RideFeatureSnapshot } = require('../models');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { DEFAULT_AI_FACTOR_CONFIGS } = require('../constants/ai-factor-config');
const { applyXLayerToForecast } = require('./ai-forecast-x-adjustments.service');
const { mergeMlEnterpriseLayer } = require('./ml-forecast-layer.service');

const AI_FACTOR_SETTING_KEY = 'ai.forecast.factorConfigs';

/** Minimum 5m buckets to fit a simple slope (was 8; lowered so sparse dev data still yields +15/+60). */
const MIN_SERIES_POINTS = 4;

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Park rows use `avgWait`; per-ride `RideFeatureSnapshot` rows use `waitTime` only.
 * @param {import('sequelize').Model|Record<string, unknown>} row
 * @returns {{ snapshotAt: Date, avgWait: number }}
 */
function normalizeSeriesRow(row) {
  const x = row && typeof row.get === 'function' ? row.get({ plain: true }) : row;
  const snap = x.snapshotAt ?? x.snapshot_at;
  const raw =
    x.avgWait != null && x.avgWait !== ''
      ? toNum(x.avgWait, NaN)
      : x.waitTime != null && x.waitTime !== ''
        ? toNum(x.waitTime, NaN)
        : NaN;
  return {
    snapshotAt: snap instanceof Date ? snap : new Date(snap),
    avgWait: Number.isFinite(raw) ? Math.max(0, raw) : 0,
  };
}

function trendLabel(slope) {
  if (slope > 0.2) return 'RISING';
  if (slope < -0.2) return 'FALLING';
  return 'STABLE';
}

class AiParkForecastService {
  constructor() {
    this.settings = new AppSettingRepository();
  }

  async enrichSummaryWithFeatureSnapshots(summary, { provider, externalParkId, externalEntityId }) {
    const parkWhere = { provider };
    if (externalParkId) parkWhere.externalParkId = externalParkId;
    const parkRow =
      externalParkId &&
      (await ParkFeatureSnapshot.findOne({
        where: parkWhere,
        order: [['snapshotAt', 'DESC']],
      }));

    const rideWhere = { provider };
    if (externalParkId) rideWhere.externalParkId = externalParkId;
    if (externalEntityId) rideWhere.externalEntityId = externalEntityId;
    const rideRow =
      externalEntityId &&
      (await RideFeatureSnapshot.findOne({
        where: rideWhere,
        order: [['snapshotAt', 'DESC']],
      }));

    const parkPlain = parkRow ? parkRow.get({ plain: true }) : null;
    const ridePlain = rideRow ? rideRow.get({ plain: true }) : null;
    const xLayer = applyXLayerToForecast(summary, {
      parkSnap: parkPlain,
      rideSnap: ridePlain,
    });
    return mergeMlEnterpriseLayer(xLayer, {
      internalParkId: ridePlain?.internalParkId ?? parkPlain?.internalParkId ?? null,
      internalAssetId: ridePlain?.internalAssetId ?? null,
      parkSnap: parkPlain,
      rideSnap: ridePlain,
    });
  }

  async getFactorConfigs() {
    const rows = await this.settings.getValue(AI_FACTOR_SETTING_KEY, DEFAULT_AI_FACTOR_CONFIGS);
    return Array.isArray(rows) && rows.length ? rows : DEFAULT_AI_FACTOR_CONFIGS;
  }

  applyFactorAdjustments(baseValue, factors, { scope = 'PARK' } = {}) {
    const normalizedBase = Math.max(1, Number(baseValue) || 1);
    const scoped = factors.filter((f) => f && f.enabled && (f.scope === scope || f.scope === 'PARK'));
    const detail = scoped.map((f) => {
      const value = toNum(f.value, 0);
      const normalized = Math.max(-1, Math.min(1, value));
      const weight = toNum(f.weight, 0);
      return {
        code: f.code,
        value,
        normalized,
        weight,
        contribution: normalized * weight,
      };
    });
    const adjustmentRatio = detail.reduce((acc, f) => acc + f.contribution, 0);
    const adjusted = Math.max(0, Math.round(baseValue + normalizedBase * adjustmentRatio * 0.35));
    return { adjusted, factors: detail };
  }

  buildFromSeries(series, { externalParkId, provider, externalEntityId = null, scope = 'PARK', factors = [] } = {}) {
    if (!series.length) {
      return {
        externalParkId,
        externalEntityId,
        provider,
        asOf: null,
        crowdLevelPercent: null,
        currentAvgWaitMinutes: null,
        forecast15Minutes: null,
        forecast60Minutes: null,
        trend: 'STABLE',
        confidence: 0.1,
        factors: [],
        model: { modelName: 'baseline-park-feature', modelType: 'BASELINE', version: 'v1' },
        degraded: true,
      };
    }
    const pts = series.map(normalizeSeriesRow).filter((p) => p.snapshotAt && !Number.isNaN(p.snapshotAt.getTime()));
    if (!pts.length) {
      return {
        externalParkId,
        externalEntityId,
        provider,
        asOf: null,
        crowdLevelPercent: null,
        currentAvgWaitMinutes: null,
        forecast15Minutes: null,
        forecast60Minutes: null,
        trend: 'STABLE',
        confidence: 0.1,
        factors: [],
        model: { modelName: 'baseline-park-feature', modelType: 'BASELINE', version: 'v1' },
        degraded: true,
      };
    }
    const ordered = [...pts].reverse();
    const latest = pts[0];
    const waits = pts.map((p) => p.avgWait).filter((n) => n >= 0);
    const minWait = waits.length ? Math.min(...waits) : 0;
    const maxWait = waits.length ? Math.max(...waits) : 1;
    const current = Math.max(0, latest.avgWait);
    const spread = Math.max(1, maxWait - minWait);
    const crowdLevelPercent = Math.max(0, Math.min(100, Math.round(((current - minWait) / spread) * 100)));

    const n = ordered.length;
    let slope = 0;
    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = ordered.reduce((acc, p) => acc + p.avgWait, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i += 1) {
        const dx = i - xMean;
        num += dx * (ordered[i].avgWait - yMean);
        den += dx * dx;
      }
      slope = den ? num / den : 0;
    }
    const base15 = Math.max(0, Math.round(current + slope * 3));
    const base60 = Math.max(0, Math.round(current + slope * 12));
    const adj15 = this.applyFactorAdjustments(base15, factors, { scope });
    const adj60 = this.applyFactorAdjustments(base60, factors, { scope });
    const confidence = Math.max(0.1, Math.min(0.95, 0.3 + Math.min(1, n / 30) * 0.6));
    return {
      externalParkId,
      externalEntityId,
      provider,
      asOf: latest.snapshotAt,
      crowdLevelPercent,
      currentAvgWaitMinutes: Math.round(current),
      forecast15Minutes: adj15.adjusted,
      forecast60Minutes: adj60.adjusted,
      trend: trendLabel(slope),
      confidence,
      factors: adj60.factors,
      model: { modelName: 'baseline-park-feature', modelType: 'BASELINE', version: 'v2-factors' },
      degraded: false,
    };
  }

  /** Park-level series only (no X-layer enrichment). Used to avoid double-applying heuristics on nested calls. */
  async getSummaryFromSeries(externalParkId, { provider = 'themeparks_wiki' } = {}) {
    const factors = await this.getFactorConfigs();
    const points = await ParkFeatureSnapshot.findAll({
      where: { provider, externalParkId },
      order: [['snapshotAt', 'DESC']],
      limit: 72,
    });
    return this.buildFromSeries(points, { externalParkId, provider, factors, scope: 'PARK' });
  }

  async getSummary(externalParkId, { provider = 'themeparks_wiki' } = {}) {
    const summary = await this.getSummaryFromSeries(externalParkId, { provider });
    return this.enrichSummaryWithFeatureSnapshots(summary, { provider, externalParkId, externalEntityId: null });
  }

  async getEntitySummary(externalEntityId, { provider = 'themeparks_wiki', externalParkId, entityType } = {}) {
    const factors = await this.getFactorConfigs();
    const where = { provider, externalEntityId };
    if (externalParkId) where.externalParkId = externalParkId;
    const entityPoints = await RideFeatureSnapshot.findAll({
      where,
      order: [['snapshotAt', 'DESC']],
      limit: 72,
    });
    if (entityPoints.length >= MIN_SERIES_POINTS) {
      const summary = this.buildFromSeries(entityPoints, {
        externalParkId: externalParkId || entityPoints[0].externalParkId,
        externalEntityId,
        provider,
        factors,
        scope: 'ENTITY',
      });
      const enriched = await this.enrichSummaryWithFeatureSnapshots(
        { ...summary, basis: 'ENTITY' },
        { provider, externalParkId: externalParkId || entityPoints[0].externalParkId, externalEntityId }
      );
      return { ...enriched, basis: 'ENTITY' };
    }

    if (externalParkId && entityType) {
      const typeCandidates =
        String(entityType).toUpperCase() === 'RIDE' ? ['RIDE', 'ATTRACTION'] : [entityType];
      for (const et of typeCandidates) {
        const typeRows = await RideFeatureSnapshot.findAll({
          where: {
            provider,
            externalParkId,
            entityType: et,
            hasWaitSample: true,
          },
          order: [['snapshotAt', 'DESC']],
          limit: 1500,
        });
        const byBucket = new Map();
        for (const row of typeRows) {
          const key = new Date(row.snapshotAt).toISOString();
          if (!byBucket.has(key)) byBucket.set(key, []);
          byBucket.get(key).push(toNum(row.waitTime, 0));
        }
        const compact = [...byBucket.entries()]
          .map(([snapshotAt, values]) => ({
            snapshotAt,
            avgWait: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
          }))
          .sort((a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime())
          .slice(0, 72);
        if (compact.length >= MIN_SERIES_POINTS) {
          const summary = this.buildFromSeries(compact, {
            externalParkId,
            externalEntityId,
            provider,
            factors,
            scope: 'ENTITY_TYPE',
          });
          const enriched = await this.enrichSummaryWithFeatureSnapshots(
            { ...summary, basis: 'ENTITY_TYPE', entityType: et },
            { provider, externalParkId, externalEntityId }
          );
          return { ...enriched, basis: 'ENTITY_TYPE', entityType: et };
        }
      }
    }

    if (externalParkId) {
      const parkCore = await this.getSummaryFromSeries(externalParkId, { provider });
      const merged = {
        ...parkCore,
        externalEntityId,
        basis: 'PARK',
        degraded: true,
      };
      return this.enrichSummaryWithFeatureSnapshots(merged, { provider, externalParkId, externalEntityId });
    }
    const empty = {
      externalParkId: externalParkId || null,
      externalEntityId,
      provider,
      asOf: null,
      crowdLevelPercent: null,
      currentAvgWaitMinutes: null,
      forecast15Minutes: null,
      forecast60Minutes: null,
      trend: 'STABLE',
      confidence: 0.1,
      factors: [],
      model: { modelName: 'baseline-park-feature', modelType: 'BASELINE', version: 'v2-factors' },
      degraded: true,
      basis: 'NONE',
    };
    return this.enrichSummaryWithFeatureSnapshots(empty, { provider, externalParkId, externalEntityId });
  }

  async getEntitySummariesForPark(externalParkId, { provider = 'themeparks_wiki', limit = 150 } = {}) {
    const latestRows = await RideFeatureSnapshot.findAll({
      where: { provider, externalParkId },
      order: [['snapshotAt', 'DESC']],
      limit: 3000,
    });
    const seen = new Map();
    for (const row of latestRows) {
      if (!row.externalEntityId || seen.has(row.externalEntityId)) continue;
      seen.set(row.externalEntityId, {
        externalEntityId: row.externalEntityId,
        entityType: row.entityType || null,
      });
      if (seen.size >= limit) break;
    }
    const out = [];
    for (const item of seen.values()) {
      // Sequential to keep DB pressure low on shared dev setups.
      // eslint-disable-next-line no-await-in-loop
      const summary = await this.getEntitySummary(item.externalEntityId, {
        provider,
        externalParkId,
        entityType: item.entityType || undefined,
      });
      out.push(summary);
    }
    return out;
  }

  async getSeries(externalParkId, { provider = 'themeparks_wiki', horizon = 60, step = 5 } = {}) {
    const summary = await this.getSummary(externalParkId, { provider });
    if (!summary.asOf || summary.currentAvgWaitMinutes == null) return [];
    const points = [];
    const nowTs = new Date(summary.asOf).getTime();
    const slopePerStep = (summary.forecast60Minutes - summary.currentAvgWaitMinutes) / Math.max(1, 60 / step);
    for (let m = 0; m <= horizon; m += step) {
      const idx = m / step;
      const predictedWait = Math.max(0, Math.round(summary.currentAvgWaitMinutes + slopePerStep * idx));
      points.push({
        timestamp: new Date(nowTs + m * 60 * 1000).toISOString(),
        predictedWait,
        predictedCrowdLevel: Math.max(0, Math.min(100, Math.round(summary.crowdLevelPercent + slopePerStep * idx))),
        confidence: Math.max(0.1, summary.confidence - idx * 0.01),
      });
    }
    return points;
  }

  async getExplanation(externalParkId, { provider = 'themeparks_wiki', horizon = 60 } = {}) {
    const summary = await this.getSummary(externalParkId, { provider });
    const base = summary.currentAvgWaitMinutes || 0;
    const finalPrediction = horizon <= 15 ? summary.forecast15Minutes : summary.forecast60Minutes;
    const delta = (finalPrediction || 0) - base;
    return {
      externalParkId,
      provider,
      horizonMinutes: horizon,
      baseValue: base,
      adjustments: [
        { factor: 'trend', direction: delta >= 0 ? 'UP' : 'DOWN', magnitude: Math.abs(delta), reason: 'Recent wait-time slope over last snapshots' },
        {
          factor: 'open_ratio',
          direction: toNum(summary?.factors?.[1]?.value) < 0.8 ? 'UP' : 'DOWN',
          magnitude: Math.round((1 - toNum(summary?.factors?.[1]?.value, 1)) * 10),
          reason: 'Lower open ratio tends to increase waits',
        },
      ],
      finalPrediction,
      confidence: summary.confidence,
    };
  }
}

module.exports = { AiParkForecastService };

