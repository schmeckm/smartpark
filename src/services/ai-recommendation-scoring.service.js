const { Op } = require('sequelize');
const { Staff, Ride } = require('../models');
const { AppError } = require('../utils/app-error');
const { RecommendationRepository } = require('../repositories/recommendation.repository');
const { RecommendationScoreRepository } = require('../repositories/recommendation-score.repository');
const { ForecastRepository } = require('../repositories/forecast.repository');
const { WeatherObservationRepository } = require('../repositories/weather-observation.repository');
const { MlModelVersionRepository } = require('../repositories/ml-model-version.repository');
const { logger } = require('../utils/logger');

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function weatherRiskFromCondition(condition) {
  if (!condition || typeof condition !== 'string') return 'NONE';
  const up = condition.toUpperCase();
  if (/RAIN|STORM|HAIL|SNOW|THUNDER|LIGHTNING|FOG|ICE|WIND|HEAT|COLD|EXTREME/.test(up)) {
    if (/RAIN|DRIZZLE|SHOWER/.test(up)) return 'RAIN';
    if (/STORM|THUNDER|LIGHTNING|HAIL/.test(up)) return 'STORM';
    if (/SNOW|ICE|FREEZ/.test(up)) return 'SNOW';
    if (/HEAT|HOT|UV/.test(up)) return 'HEAT';
    if (/WIND|GALE/.test(up)) return 'WIND';
    return 'ADVERS';
  }
  return 'NONE';
}

function urgencyFromScore(score) {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function impactFromType(type, score, factors) {
  const maxWait = num(factors.maxRideWaitTime);
  const crowdHot = num(factors.currentCrowdRatio) > 0.75 || num(factors.forecastCrowdRatio60m) > 0.85;
  const staffTight = num(factors.availableStaffNearby) === 0;

  switch (type) {
    case 'SEND_SECURITY':
      return score >= 70 ? 'HIGH' : 'MEDIUM';
    case 'REALLOCATE_STAFF':
      return staffTight || crowdHot ? 'HIGH' : 'MEDIUM';
    case 'GUEST_ROUTING':
      return maxWait > 45 ? 'HIGH' : 'MEDIUM';
    case 'CLEANING_SUPPORT':
      return 'MEDIUM';
    case 'OPEN_SERVICE_POINT':
      return crowdHot ? 'HIGH' : 'MEDIUM';
    default:
      return 'MEDIUM';
  }
}

function confidenceFromSignals(hasEvent, hasZone, hasForecast, hasWeather) {
  let c = 0.5;
  if (hasEvent && hasZone) c += 0.15;
  if (hasForecast) c += 0.15;
  else c -= 0.2;
  if (hasWeather) c += 0.1;
  return clamp(c, 0.35, 0.95);
}

function expectedBenefitFromFactors(factors, recType) {
  const maxWait = num(factors.maxRideWaitTime);
  const cur = num(factors.currentCrowdRatio);
  const fc = num(factors.forecastCrowdRatio60m);
  const waitReduction = maxWait > 45 ? clamp(Math.round((maxWait - 30) * 0.25), 0, 15) : clamp(Math.round(maxWait * 0.1), 0, 8);
  const crowdReduction = fc > cur ? clamp(Math.round((fc - cur) * 100 * 0.5), 0, 15) : 0;
  const staffEff =
    recType === 'REALLOCATE_STAFF' ? 4 : recType === 'OPEN_SERVICE_POINT' ? 3 : 2;
  return {
    waitTimeReductionMinutes: waitReduction,
    crowdReductionPercent: crowdReduction,
    staffEfficiencyGainPercent: staffEff,
  };
}

class AiRecommendationScoringService {
  constructor() {
    this.recommendationRepository = new RecommendationRepository();
    this.scoreRepository = new RecommendationScoreRepository();
    this.forecastRepository = new ForecastRepository();
    this.weatherRepository = new WeatherObservationRepository();
    this.modelRepository = new MlModelVersionRepository();
  }

  async countAvailableStaffInZones(zoneIds) {
    if (!zoneIds.length) return 0;
    return Staff.count({
      where: { currentZoneId: { [Op.in]: zoneIds }, available: true },
    });
  }

  async maxRideWaitInZone(zoneId) {
    const v = await Ride.max('waitTime', {
      where: { zoneId, status: 'OPEN' },
    });
    return num(v, 0);
  }

  /**
   * @param {import('../models').Recommendation} recommendation — instance with event.zone loaded if possible
   */
  async buildContext(recommendation) {
    const event = recommendation.event;
    const zone = event?.zone;
    const zoneId = zone?.id || event?.zoneId;
    const adjacent = zone && Array.isArray(zone.adjacentZoneIds) ? zone.adjacentZoneIds : [];
    const zoneIds = zoneId ? [zoneId, ...adjacent] : [];

    const [forecast, weather, maxWait, staffNearby] = await Promise.all([
      zoneId ? this.forecastRepository.findLatestZoneCrowd60m(zoneId) : Promise.resolve(null),
      this.weatherRepository.findCurrent(),
      zoneId ? this.maxRideWaitInZone(zoneId) : Promise.resolve(0),
      this.countAvailableStaffInZones(zoneIds),
    ]);

    const cap = Math.max(1, num(zone?.maxCapacity, 1));
    const currentCrowdRatio = zone ? num(zone.currentCrowdLevel, 0) / cap : 0;
    let forecastCrowdRatio60m = 0;
    if (forecast) {
      forecastCrowdRatio60m = num(forecast.predictedValue, 0) / cap;
    }

    const severity = event ? num(event.severity, 0) : 0;
    const weatherRisk = weatherRiskFromCondition(weather?.condition);
    const eventSeverity = severity;

    return {
      zone,
      zoneId,
      event,
      forecast,
      weather,
      maxRideWaitTime: maxWait,
      availableStaffNearby: staffNearby,
      currentCrowdRatio,
      forecastCrowdRatio60m,
      weatherRisk,
      eventSeverity,
    };
  }

  computeScoreAndMeta(recommendation, ctx) {
    const reasons = [];
    let score = 0;

    if (ctx.currentCrowdRatio > 0.75) {
      score += 20;
      reasons.push(`Zone crowd ratio is ${(ctx.currentCrowdRatio * 100).toFixed(0)}% of capacity (>75%).`);
    }
    if (ctx.forecastCrowdRatio60m > 0.85) {
      score += 25;
      reasons.push(
        `60-minute crowd forecast ratio is ${(ctx.forecastCrowdRatio60m * 100).toFixed(0)}% (>85%).`
      );
    }
    if (ctx.forecastCrowdRatio60m > 0.95) {
      score += 10;
      reasons.push('Forecast exceeds 95% capacity within 60 minutes.');
    }
    if (ctx.maxRideWaitTime > 45) {
      score += 15;
      reasons.push(`Maximum ride wait in zone is ${ctx.maxRideWaitTime} minutes (>45).`);
    }
    if (ctx.eventSeverity >= 4) {
      score += 15;
      reasons.push(`Event severity is ${ctx.eventSeverity} (≥4).`);
    }
    if (ctx.weatherRisk !== 'NONE') {
      score += 10;
      reasons.push(`Weather risk flagged as ${ctx.weatherRisk}.`);
    }
    if (ctx.availableStaffNearby === 0) {
      score += 10;
      reasons.push('No available staff in this zone or adjacent zones.');
    } else {
      score -= 5;
    }

    score = clamp(score, 0, 100);

    const factors = {
      currentCrowdRatio: Math.round(ctx.currentCrowdRatio * 1000) / 1000,
      forecastCrowdRatio60m: Math.round(ctx.forecastCrowdRatio60m * 1000) / 1000,
      maxRideWaitTime: ctx.maxRideWaitTime,
      availableStaffNearby: ctx.availableStaffNearby,
      weatherRisk: ctx.weatherRisk,
      eventSeverity: ctx.eventSeverity,
    };

    const urgency = urgencyFromScore(score);
    const impact = impactFromType(recommendation.recommendationType, score, factors);
    const confidence = confidenceFromSignals(
      Boolean(ctx.event),
      Boolean(ctx.zone),
      Boolean(ctx.forecast),
      Boolean(ctx.weather)
    );

    const expectedBenefit = expectedBenefitFromFactors(factors, recommendation.recommendationType);

    const summaryParts = [
      `Operational risk score ${score}/100 with ${urgency} urgency for ${recommendation.recommendationType.replace(/_/g, ' ')}.`,
    ];
    if (!ctx.forecast) {
      summaryParts.push('Limited forecast data; confidence is reduced.');
    }
    const explanation = {
      summary: summaryParts.join(' '),
      reasons: reasons.length ? reasons : ['Baseline scoring applied with limited contributing signals.'],
    };

    return { score, urgency, impact, confidence, expectedBenefit, explanation, factors };
  }

  async scoreRecommendationById(recommendationId, { emitSocket = true } = {}) {
    const recommendation = await this.recommendationRepository.findById(recommendationId);
    if (!recommendation) {
      throw new AppError('Recommendation not found', 404, { code: 'NOT_FOUND' });
    }
    if (recommendation.status !== 'OPEN') {
      throw new AppError('Only OPEN recommendations can be scored', 422, { code: 'INVALID_STATUS' });
    }

    const ctx = await this.buildContext(recommendation);
    const meta = this.computeScoreAndMeta(recommendation, ctx);
    let modelVersionId = null;
    try {
      const mv = await this.modelRepository.getOrCreateBaseline();
      modelVersionId = mv.id;
    } catch (e) {
      logger.warn({ err: e.message }, 'ml model version for recommendation score skipped');
    }

    const row = await this.scoreRepository.upsertForRecommendation(recommendation.id, {
      score: meta.score,
      urgency: meta.urgency,
      impact: meta.impact,
      confidence: meta.confidence,
      expectedBenefit: meta.expectedBenefit,
      explanation: meta.explanation,
      factors: meta.factors,
      modelVersionId,
    });

    const hydrated = await this.recommendationRepository.findById(recommendation.id);
    if (emitSocket) {
      const { emitAiRecommendationScored } = require('../sockets');
      emitAiRecommendationScored({
        recommendation: hydrated.toJSON ? hydrated.toJSON() : hydrated,
        score: row.toJSON ? row.toJSON() : row,
      });
    }
    return { recommendation: hydrated, score: row };
  }

  async scoreAllOpen({ emitSocket = true } = {}) {
    const rows = await this.recommendationRepository.findAllOpen({ limit: 500 });
    let scored = 0;
    for (const rec of rows) {
      try {
        await this.scoreRecommendationById(rec.id, { emitSocket });
        scored += 1;
      } catch (e) {
        logger.warn({ err: e.message, recommendationId: rec.id }, 'skip scoring recommendation');
      }
    }
    return { scored };
  }
}

module.exports = { AiRecommendationScoringService };
