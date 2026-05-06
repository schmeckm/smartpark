const { Op } = require('sequelize');
const { Forecast, ZoneCrowdSample, Zone } = require('../models');

/**
 * Compare persisted ZONE + CROWD_LEVEL forecasts to nearest zone_crowd_samples
 * around (producedAt + horizon) — Phase 2 MVP for "forecast vs actual" demos.
 */
class ForecastAccuracyService {
  /**
   * @param {{ days?: number, horizonMinutes?: number, limitForecasts?: number }} opts
   */
  async zoneCrowdPointwise(opts = {}) {
    const days = Math.min(90, Math.max(1, Number(opts.days) || 7));
    const horizonMinutes = [15, 60, 180].includes(Number(opts.horizonMinutes))
      ? Number(opts.horizonMinutes)
      : 60;
    const limitForecasts = Math.min(800, Math.max(50, Number(opts.limitForecasts) || 400));

    const since = new Date(Date.now() - days * 86400000);
    const forecasts = await Forecast.findAll({
      where: {
        subjectType: 'ZONE',
        targetMetric: 'CROWD_LEVEL',
        horizonMinutes,
        producedAt: { [Op.gte]: since },
      },
      order: [['producedAt', 'DESC']],
      limit: limitForecasts,
    });

    const windowMs = 45 * 60 * 1000;
    const points = [];

    for (const f of forecasts) {
      const zid = f.subjectId;
      if (!zid) continue;
      const tMs = new Date(f.producedAt).getTime() + horizonMinutes * 60 * 1000;
      const samples = await ZoneCrowdSample.findAll({
        where: {
          zoneId: zid,
          sampledAt: { [Op.between]: [new Date(tMs - windowMs), new Date(tMs + windowMs)] },
        },
        order: [['sampledAt', 'ASC']],
      });
      if (!samples.length) continue;
      let best = samples[0];
      let bestDiff = Math.abs(new Date(best.sampledAt).getTime() - tMs);
      for (let i = 1; i < samples.length; i += 1) {
        const s = samples[i];
        const d = Math.abs(new Date(s.sampledAt).getTime() - tMs);
        if (d < bestDiff) {
          bestDiff = d;
          best = s;
        }
      }
      const pred = Number(f.predictedValue);
      const act = Number(best.crowdLevel);
      if (!Number.isFinite(pred) || !Number.isFinite(act)) continue;
      points.push({
        zoneId: zid,
        predicted: pred,
        actual: act,
        absError: Math.abs(pred - act),
        producedAt: f.producedAt,
        horizonMinutes,
      });
    }

    const byZone = new Map();
    for (const p of points) {
      if (!byZone.has(p.zoneId)) byZone.set(p.zoneId, { errors: [], count: 0 });
      const z = byZone.get(p.zoneId);
      z.errors.push(p.absError);
      z.count += 1;
    }

    const zoneRows = await Zone.findAll({ attributes: ['id', 'name'] });
    const zoneName = new Map(zoneRows.map((z) => [z.id, z.name]));

    const zones = [];
    for (const [zoneId, agg] of byZone) {
      const mae = agg.errors.reduce((a, b) => a + b, 0) / agg.count;
      zones.push({
        zoneId,
        zoneName: zoneName.get(zoneId) || String(zoneId),
        mae: Math.round(mae * 100) / 100,
        count: agg.count,
      });
    }
    zones.sort((a, b) => b.mae - a.mae);

    const overallMae =
      points.length > 0 ? points.reduce((a, p) => a + p.absError, 0) / points.length : null;

    return {
      targetMetric: 'CROWD_LEVEL',
      subjectType: 'ZONE',
      horizonMinutes,
      days,
      matchedPoints: points.length,
      forecastsConsidered: forecasts.length,
      overallMae: overallMae != null ? Math.round(overallMae * 100) / 100 : null,
      zones,
    };
  }
}

module.exports = { ForecastAccuracyService };
