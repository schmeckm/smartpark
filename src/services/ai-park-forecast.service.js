/**
 * Park / entity wait forecasts: baseline from snapshot series, then X-layer, then ML enterprise layer.
 * When a ride has `park_assets.evaluated_algorithm` and an **active** matching FEATURE_STORE `ai_studio_models` row,
 * +15m wait uses `AiStudioService.predictWithModel` (latest snapshot features) before X/ML layers.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op } = require('sequelize');
const { sequelize } = require('../db/sequelize');
const { ParkFeatureSnapshot, RideFeatureSnapshot, ParkAsset, AiStudioModel } = require('../models');
const { AppSettingRepository } = require('../repositories/app-setting.repository');
const { DEFAULT_AI_FACTOR_CONFIGS } = require('../constants/ai-factor-config');
const { applyXLayerToForecast } = require('./ai-forecast-x-adjustments.service');
const { mergeMlEnterpriseLayer } = require('./ml-forecast-layer.service');
const { AiStudioService } = require('./ai-studio.service');
const { logger } = require('../utils/logger');
const {
  buildAdrForecastExplainability,
  finalizeExplainabilityMvpEnvelope,
} = require('./ai/prediction-explanation-normalizer.service');

const AI_FACTOR_SETTING_KEY = 'ai.forecast.factorConfigs';

/** Short TTL cache for ParkAsset + AiStudioModel resolution (ride grid hits many entities). */
const STUDIO_RIDE_FS_CACHE_TTL_MS = 20_000;
const STUDIO_RIDE_FS_CACHE_MAX = 400;
/** @type {Map<string, { expiresAt: number, value: { evaluatedAlgorithm: string|null, modelPlain: object|null } }>} */
const studioRideFsCache = new Map();

function studioRideFsCacheGet(key) {
  const row = studioRideFsCache.get(key);
  if (!row) return undefined;
  if (Date.now() > row.expiresAt) {
    studioRideFsCache.delete(key);
    return undefined;
  }
  return row.value;
}

function studioRideFsCacheSet(key, value) {
  studioRideFsCache.set(key, { expiresAt: Date.now() + STUDIO_RIDE_FS_CACHE_TTL_MS, value });
  while (studioRideFsCache.size > STUDIO_RIDE_FS_CACHE_MAX) {
    const k = studioRideFsCache.keys().next().value;
    studioRideFsCache.delete(k);
  }
}

/** Clears ride FEATURE_STORE model-resolve cache for one park (e.g. after batch-apply activates models). */
function clearStudioRideFsModelResolveCacheForPark(parkId) {
  const prefix = `${String(parkId)}|`;
  for (const k of studioRideFsCache.keys()) {
    if (k.startsWith(prefix)) studioRideFsCache.delete(k);
  }
}

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

/**
 * Union of feature keys the studio model may read (FEATURE_STORE order + training list).
 * @param {object} modelPlain
 * @returns {string[]}
 */
function studioModelFeatureKeyList(modelPlain) {
  const payload = modelPlain?.modelPayload || {};
  const feats = Array.isArray(modelPlain?.featuresJson) ? modelPlain.featuresJson : [];
  const order =
    Array.isArray(payload.featureKeys) && payload.featureKeys.length > 0 ? payload.featureKeys : feats;
  return [...new Set([...(order || []), ...feats].map((k) => String(k)))];
}

/**
 * Safe live imputation: every required X must be a finite number before predictWithModel.
 * Missing / null / NaN → conservative defaults (0) so trees/ridge never throw on undefined.
 * @param {object} modelPlain
 * @param {Record<string, unknown>} featuresInput
 * @returns {Record<string, number>}
 */
function imputeFeatureStoreLiveFeatures(modelPlain, featuresInput) {
  const keys = studioModelFeatureKeyList(modelPlain);
  const base = featuresInput && typeof featuresInput === 'object' ? { ...featuresInput } : {};
  const out = {};
  for (const key of keys) {
    const raw = base[key];
    const n = Number(raw);
    if (raw != null && raw !== '' && Number.isFinite(n)) {
      out[key] = n;
      continue;
    }
    const lk = String(key).toLowerCase();
    if (lk.includes('rain') || lk.includes('precip') || lk.includes('wet')) {
      out[key] = 0;
    } else {
      out[key] = 0;
    }
  }
  return out;
}

class AiParkForecastService {
  constructor() {
    this.settings = new AppSettingRepository();
    /** Used for FEATURE_STORE production override (ride wait +15m). */
    this._studio = new AiStudioService();
  }

  /**
   * Cached: `evaluated_algorithm` on park_assets + **active only** FEATURE_STORE studio row
   * matching that algorithm (`wait_time_plus_15`, entity scope).
   * @param {string} parkId
   * @param {string} assetId
   * @returns {Promise<{ evaluatedAlgorithm: string|null, modelPlain: object|null }>}
   */
  async resolveStudioFeatureStoreModelForRide(parkId, assetId) {
    const key = `${parkId}|${assetId}`;
    const hit = studioRideFsCacheGet(key);
    if (hit !== undefined) return hit;

    try {
      const asset = await ParkAsset.findOne({
        where: { assetId, parkId },
        attributes: ['evaluatedAlgorithm'],
      });
      const ap = asset?.get ? asset.get({ plain: true }) : asset;
      const algoRaw = ap?.evaluatedAlgorithm;
      const algo = algoRaw != null && String(algoRaw).trim() !== '' ? String(algoRaw).trim() : null;
      if (!algo) {
        const val = { evaluatedAlgorithm: null, modelPlain: null };
        studioRideFsCacheSet(key, val);
        return val;
      }

      const row = await AiStudioModel.findOne({
        where: {
          [Op.and]: [
            { parkId },
            { modelScope: 'entity' },
            { entityType: 'RIDE' },
            { entityId: assetId },
            { targetVariable: 'wait_time_plus_15' },
            { activeFlag: true },
            { archivedAt: { [Op.is]: null } },
            { algorithm: algo },
            sequelize.literal("(model_payload->>'dataset') = 'FEATURE_STORE'"),
          ],
        },
        order: [['version', 'DESC']],
      });
      const modelPlain = row ? row.get({ plain: true }) : null;
      const val = { evaluatedAlgorithm: algo, modelPlain };
      studioRideFsCacheSet(key, val);
      return val;
    } catch (err) {
      logger.error(
        { err: err?.message, stack: err?.stack, parkId, assetId },
        'park_forecast.studio_fs_model_resolve_failed'
      );
      const val = { evaluatedAlgorithm: null, modelPlain: null };
      studioRideFsCacheSet(key, val);
      return val;
    }
  }

  /**
   * Replace +15m / +60m forecasts from baseline when a FEATURE_STORE studio model applies.
   * +60m scales with the same ratio as the baseline X/factor-adjusted curve vs +15m.
   * Never throws: any failure → unchanged baseline summary (live grid stays up).
   * @param {object} summary - output of buildFromSeries
   * @param {{ parkId: string, assetId: string }} ctx
   */
  async applyStudioFeatureStoreForecastOverride(summary, ctx) {
    const baseline = summary;
    const { parkId, assetId } = ctx;
    if (!parkId || !assetId || !baseline || baseline.degraded) return baseline;

    let evaluatedAlgorithm = null;
    let modelPlain = null;
    try {
      const resolved = await this.resolveStudioFeatureStoreModelForRide(parkId, assetId);
      evaluatedAlgorithm = resolved.evaluatedAlgorithm;
      modelPlain = resolved.modelPlain;
    } catch (err) {
      logger.error(
        { err: err?.message, stack: err?.stack, parkId, assetId },
        'park_forecast.studio_fs_resolve_unexpected'
      );
      return baseline;
    }

    if (!evaluatedAlgorithm || !modelPlain) return baseline;

    let snap;
    try {
      snap = await this._studio.resolveLatestSnapshotFeatures(parkId, assetId);
    } catch (err) {
      logger.error(
        { err: err?.message, stack: err?.stack, parkId, assetId },
        'park_forecast.studio_fs_snapshot_load_failed'
      );
      return baseline;
    }

    if (!snap?.features || typeof snap.features !== 'object') return baseline;

    let y;
    try {
      const imputed = imputeFeatureStoreLiveFeatures(modelPlain, snap.features);
      y = this._studio.predictWithModel(modelPlain, imputed);
    } catch (err) {
      logger.error(
        { err: err?.message, stack: err?.stack, parkId, assetId, evaluatedAlgorithm },
        'park_forecast.studio_fs_predict_with_model_failed'
      );
      return baseline;
    }

    if (!Number.isFinite(y)) {
      logger.warn({ parkId, assetId, evaluatedAlgorithm, y }, 'park_forecast.studio_fs_predict_non_finite');
      return baseline;
    }

    try {
      const f15 = Math.max(0, Math.round(Number(y)));
      const base15 = Math.max(1, Number(baseline.forecast15Minutes) || 1);
      const base60 = Number(baseline.forecast60Minutes);
      const f60 = Number.isFinite(base60)
        ? Math.max(0, Math.round((base60 / base15) * f15))
        : f15;

      const algoLabel = String(modelPlain.algorithm || evaluatedAlgorithm).replace(/_/g, ' ');
      return {
        ...baseline,
        forecast15Minutes: f15,
        forecast60Minutes: f60,
        confidence: Math.max(Number(baseline.confidence) || 0.1, 0.55),
        model: {
          modelName: `AI Studio (${algoLabel})`,
          modelType: 'FEATURE_STORE',
          version: `v${modelPlain.version ?? 1}`,
        },
      };
    } catch (err) {
      logger.error(
        { err: err?.message, stack: err?.stack, parkId, assetId },
        'park_forecast.studio_fs_postprocess_failed'
      );
      return baseline;
    }
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
    // Raw slope extrapolation
    const raw15 = current + slope * 3;
    const raw60 = current + slope * 12;

    // Anchor: forecast must not drop below 40% of current value (slope alone
    // can predict near-zero when a recent spike contrasts with hours of low
    // wait times).  For increases the slope is trusted as-is.
    const floor15 = current * 0.4;
    const floor60 = current * 0.25;
    const base15 = Math.max(0, Math.round(Math.max(raw15, floor15)));
    const base60 = Math.max(0, Math.round(Math.max(raw60, floor60)));
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
      _decomp: {
        trendBase15: base15,
        trendBase60: base60,
        factorAdj15: adj15.adjusted,
        factorAdj60: adj60.adjusted,
        factorAdjDelta15: adj15.adjusted - base15,
        factorAdjDelta60: adj60.adjusted - base60,
      },
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
      let summary = this.buildFromSeries(entityPoints, {
        externalParkId: externalParkId || entityPoints[0].externalParkId,
        externalEntityId,
        provider,
        factors,
        scope: 'ENTITY',
      });
      const p0 = entityPoints[0].get ? entityPoints[0].get({ plain: true }) : entityPoints[0];
      const pid = p0.internalParkId ?? p0.internal_park_id;
      const aid = p0.internalAssetId ?? p0.internal_asset_id;
      if (pid && aid) {
        // eslint-disable-next-line no-await-in-loop
        summary = await this.applyStudioFeatureStoreForecastOverride(summary, {
          parkId: String(pid),
          assetId: String(aid),
        });
      }
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
    const legacy = {
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
    const explainability = finalizeExplainabilityMvpEnvelope(
      buildAdrForecastExplainability({
        track: 'ADR_FORECAST',
        scope: 'park',
        summary,
        legacyExplanation: legacy,
        horizonMinutes: horizon,
      }),
    );
    return { ...legacy, explainability };
  }

  /**
   * Per-entity forecast explanation (same enrichment path as entity summary).
   * @param {string} externalEntityId
   * @param {{ provider?: string, externalParkId: string, entityType?: string, horizon?: number }} opts
   */
  async getEntityExplanation(externalEntityId, { provider = 'themeparks_wiki', externalParkId, entityType, horizon = 60 } = {}) {
    const summary = await this.getEntitySummary(externalEntityId, { provider, externalParkId, entityType });
    const base = summary.currentAvgWaitMinutes || 0;
    const finalPrediction = horizon <= 15 ? summary.forecast15Minutes : summary.forecast60Minutes;
    const delta = (finalPrediction || 0) - base;
    const legacy = {
      externalEntityId,
      externalParkId: externalParkId || summary.externalParkId || null,
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
      basis: summary.basis || null,
    };
    const explainability = finalizeExplainabilityMvpEnvelope(
      buildAdrForecastExplainability({
        track: 'ADR_FORECAST',
        scope: 'entity',
        summary,
        legacyExplanation: legacy,
        horizonMinutes: horizon,
      }),
    );
    return { ...legacy, explainability };
  }
}

module.exports = { AiParkForecastService, clearStudioRideFsModelResolveCacheForPark };

