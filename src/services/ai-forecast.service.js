const { ZoneRepository } = require('../repositories/zone.repository');
const { ZoneCrowdSampleRepository } = require('../repositories/zone-crowd-sample.repository');
const { MlModelVersionRepository, BASELINE_ML } = require('../repositories/ml-model-version.repository');
const { ForecastRepository } = require('../repositories/forecast.repository');
const { logger } = require('../utils/logger');

const HORIZONS = [15, 60, 180];
const SAMPLE_LOOKBACK_MS = 3 * 60 * 60 * 1000;

function toNum(val) {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

class AiForecastService {
  constructor() {
    this.zoneRepository = new ZoneRepository();
    this.sampleRepository = new ZoneCrowdSampleRepository();
    this.modelRepository = new MlModelVersionRepository();
    this.forecastRepository = new ForecastRepository();
  }

  /**
   * Baseline SMA + linear trend. Persists CROWD_LEVEL for ZONE.
   * @returns {Promise<{ count: number }>}
   */
  /**
   * @param {{ parkId?: string|null }} [opts]
   */
  async refreshZoneCrowdForecasts(opts = {}) {
    const parkId = opts.parkId || null;
    const [zones, model] = await Promise.all([
      this.zoneRepository.findAllActive(parkId ? { parkId } : {}),
      this.modelRepository.getOrCreateBaseline(),
    ]);

    const since = new Date(Date.now() - SAMPLE_LOOKBACK_MS);
    const now = new Date();
    const rows = [];
    const samplesByZone = await this.sampleRepository.findRecentByZoneIds(
      zones.map((z) => z.id),
      { since, limitPerZone: 48 }
    );

    for (const z of zones) {
      const samples = samplesByZone.get(z.id) || [];
      const cap = Math.max(1, toNum(z.maxCapacity));
      const levels = samples.length
        ? samples.map((s) => toNum(s.crowdLevel))
        : [Math.max(0, toNum(z.currentCrowdLevel))];
      const n = levels.length;
      const sma = levels.reduce((a, c) => a + c, 0) / n;
      const sorted = [...samples].sort(
        (a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime()
      );
      let trendPerMinute = 0;
      if (sorted.length >= 2) {
        const t0 = new Date(sorted[0].sampledAt).getTime();
        const t1 = new Date(sorted[sorted.length - 1].sampledAt).getTime();
        const dMin = (t1 - t0) / 60000;
        if (dMin > 0.05) {
          trendPerMinute = (toNum(sorted.at(-1).crowdLevel) - toNum(sorted[0].crowdLevel)) / dMin;
        }
      }
      const confidence = Math.min(0.95, 0.35 + 0.5 * Math.min(1, n / 20));

      for (const h of HORIZONS) {
        const raw = sma + trendPerMinute * h;
        const predicted = Math.max(0, Math.min(toNum(sma + trendPerMinute * h), cap * 1.1));
        const predRounded = Math.round(predicted);
        const bandLow = Math.max(0, raw * 0.9);
        const bandHigh = Math.min(cap, raw * 1.1);
        const produced = now;
        const expires = new Date(produced.getTime() + h * 60 * 1000 * 2);

        rows.push({
          subjectType: 'ZONE',
          subjectId: z.id,
          targetMetric: 'CROWD_LEVEL',
          horizonMinutes: h,
          predictedValue: predRounded,
          confidence,
          predictionBand: { low: bandLow, high: bandHigh },
          modelVersionId: model.id,
          features: { sma, trendPerMinute, sampleCount: n, lookbackMs: SAMPLE_LOOKBACK_MS },
          producedAt: produced,
          expiresAt: expires,
        });
      }
    }

    try {
      const created = await this.forecastRepository.replaceZoneCrowdLevelForecasts(model.id, rows);
      return { count: created.length };
    } catch (e) {
      logger.warn({ err: e.message }, 'forecast refresh failed');
      throw e;
    }
  }

  /**
   * @param {object} query
   */
  async getForecasts(query) {
    const { horizonMinutes, subjectType, targetMetric, limit, zoneIds } = query;
    return this.forecastRepository.listRecent({
      horizonMinutes: horizonMinutes === undefined ? undefined : Number(horizonMinutes),
      subjectType,
      targetMetric,
      limit: limit === undefined ? 100 : Number(limit),
      zoneIds,
    });
  }

  /**
   * @param {{ parkId?: string|null, zoneIds?: string[]|null }} [opts]
   */
  async getInsightsSummary(opts = {}) {
    const horizon = 60;
    const parkId = opts.parkId || null;
    const zoneIds = opts.zoneIds?.length ? opts.zoneIds : null;

    const [rows, zones, model] = await Promise.all([
      this.forecastRepository.listRecent({
        horizonMinutes: horizon,
        subjectType: 'ZONE',
        targetMetric: 'CROWD_LEVEL',
        limit: 200,
        zoneIds,
      }),
      parkId ? this.zoneRepository.findAllActive({ parkId }) : this.zoneRepository.findAll(),
      this.modelRepository.getOrCreateBaseline(),
    ]);
    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const forBaseline = rows.filter(
      (f) => f.modelVersionId && String(f.modelVersionId) === String(model.id) && f.subjectId
    );
    const byZone = new Map();
    for (const f of forBaseline) {
      const zid = String(f.subjectId);
      const prev = byZone.get(zid);
      if (!prev || new Date(f.producedAt) > new Date(prev.producedAt)) {
        byZone.set(zid, f);
      }
    }
    const latestPerZone = [...byZone.values()];
    const scored = latestPerZone
      .map((f) => {
        const z = f.subjectId ? zoneById.get(f.subjectId) : null;
        const cap = Math.max(1, toNum(z?.maxCapacity) || 1);
        const pred = toNum(f.predictedValue);
        const ratio = z ? pred / cap : 0;
        return {
          zoneId: f.subjectId,
          zoneName: z?.name ?? 'Unknown',
          maxCapacity: cap,
          predictedCrowdLevel: pred,
          crowdRatio: ratio,
          confidence: f.confidence != null ? toNum(f.confidence) : null,
          forecastId: f.id,
          producedAt: f.producedAt,
        };
      })
      .filter((s) => s.zoneId);
    scored.sort((a, b) => b.crowdRatio - a.crowdRatio);
    const top3 = scored.slice(0, 3);
    const bestRatio = top3.length ? top3[0].crowdRatio : 0;
    const confidences = top3
      .map((r) => r.confidence)
      .filter((c) => c != null && !Number.isNaN(c)) ;
    const avg =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;
    return {
      topHotspotZones: top3,
      highestPredictedCrowdRatio: bestRatio,
      forecastHorizonMinutes: horizon,
      averageConfidence: avg,
      confidence: avg,
      generatedAt: new Date().toISOString(),
      model: BASELINE_ML,
      parkId: parkId || null,
      scopedToPark: Boolean(parkId),
    };
  }
}

module.exports = { AiForecastService };
