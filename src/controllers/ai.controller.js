/**
 * AI HTTP surface: recommendations, park/entity forecasts, training dataset, calendar.
 * Forecast numbers are computed in services (see ADR); this controller does not add heuristics.
 * @see docs/adr/0001-forecast-architecture.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { Op } = require('sequelize');
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { AiOrchestratorService } = require('../services/ai-orchestrator.service');
const { AiForecastService } = require('../services/ai-forecast.service');
const { AiRecommendationScoringService } = require('../services/ai-recommendation-scoring.service');
const { AiParkForecastService } = require('../services/ai-park-forecast.service');
const { ForecastAccuracyService } = require('../services/forecast-accuracy.service');
const { TimeseriesService } = require('../services/timeseries.service');
const { buildRideQueueTrainingDataset } = require('../services/ai-training-dataset.service');
const { RecommendationRepository } = require('../repositories/recommendation.repository');
const { AuditLogService } = require('../services/audit-log.service');
const { AiPipelineRun } = require('../models');
const { getWeatherOpenMeteoSchedulerHealth } = require('../services/weather-open-meteo-scheduler.service');
const { getPlatformSettingsService } = require('../services/platform-settings.service');
const { ZoneRepository } = require('../repositories/zone.repository');
const AUDIT = require('../constants/audit-actions');
const { jsonSnapshot } = require('../utils/json-snapshot');
const { parseRequiredUtcOrOffsetInstant } = require('../utils/utc-query-instant.util');
const {
  assertExternalParkMatchesContext,
  assertEntityBelongsToPark,
  resolveExternalParkForPlatformPark,
} = require('../utils/ai-park-scope.util');

const orchestrator = new AiOrchestratorService();
const forecastService = new AiForecastService();
const zoneRepository = new ZoneRepository();
const scoringService = new AiRecommendationScoringService();
const parkForecastService = new AiParkForecastService();
const forecastAccuracyService = new ForecastAccuracyService();
const timeseriesService = new TimeseriesService();
const recommendationRepository = new RecommendationRepository();
const auditLogService = new AuditLogService();

function num(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function serializeForecast(row) {
  const j = row.toJSON ? row.toJSON() : row;
  const mv = j.modelVersion
    ? {
        id: j.modelVersion.id,
        modelName: j.modelVersion.modelName,
        modelType: j.modelVersion.modelType,
        version: j.modelVersion.version,
      }
    : null;
  if (j.modelVersion) {
    delete j.modelVersion;
  }
  return { ...j, modelVersion: mv };
}

const getHealth = asyncHandler(async (req, res) => {
  const ps = getPlatformSettingsService();
  const enabled = await ps.getBoolean('AI_SAMPLING_ENABLED', true);
  const intervalSeconds = await ps.getNumber('AI_SAMPLING_INTERVAL_SECONDS', 300);
  res.json({
    success: true,
    data: {
      status: 'ok',
      sampling: {
        enabled,
        intervalSeconds,
      },
      modelName: 'baseline-crowd-moving-average',
    },
  });
});

/**
 * Optional `data/ai-smoke-status.json`.
 * Legacy top-level `euromir` / `wodan`; preferred `referenceRides`; park-wide `rideForecastAll`.
 */
function readOptionalSmokeStatus() {
  const empty = { smokeEuromir: null, smokeWodan: null, smokeRideForecastAll: null };
  try {
    const p = path.join(process.cwd(), 'data', 'ai-smoke-status.json');
    if (!fs.existsSync(p)) return empty;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const norm = (x) => {
      if (!x || typeof x !== 'object') return null;
      const passed = Boolean(x.passed ?? x.ok);
      const checkedAt = x.checkedAt || x.at || null;
      if (!checkedAt) return null;
      return { passed, checkedAt };
    };
    const normRideAll = (x) => {
      if (!x || typeof x !== 'object') return null;
      const checkedAt = x.checkedAt || null;
      if (!checkedAt) return null;
      return {
        passed: Boolean(x.passed),
        checkedAt,
        summary: x.summary && typeof x.summary === 'object' ? x.summary : null,
        topIssues: Array.isArray(x.topIssues) ? x.topIssues : undefined,
      };
    };
    return {
      smokeEuromir: norm(j.referenceRides?.euromir ?? j.euromir),
      smokeWodan: norm(j.referenceRides?.wodan ?? j.wodan),
      smokeRideForecastAll: normRideAll(j.rideForecastAll),
    };
  } catch {
    return empty;
  }
}

function serializePipelineRunRow(row) {
  if (!row) return null;
  const startedAt = row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt;
  const finishedAt = row.finishedAt
    ? row.finishedAt instanceof Date
      ? row.finishedAt.toISOString()
      : row.finishedAt
    : null;
  return {
    id: row.id,
    parkId: row.parkId ?? null,
    startedAt,
    finishedAt,
    durationMs: row.durationMs,
    status: row.status,
    parkSnapshotsWritten: row.parkSnapshotsWritten,
    rideSnapshotsWritten: row.rideSnapshotsWritten,
    labelsWritten: row.labelsWritten,
    featureStoreError: row.featureStoreError,
    scoringError: row.scoringError,
  };
}

async function insightsScopeFromRequest(req) {
  const parkId = req.parkContext?.id || null;
  if (!parkId) return { parkId: null, zoneIds: null };
  const zones = await zoneRepository.findAllActive({ parkId });
  return { parkId, zoneIds: zones.map((z) => z.id) };
}

const getPipelineHealth = asyncHandler(async (_req, res) => {
  const last = await AiPipelineRun.findOne({
    where: { finishedAt: { [Op.ne]: null } },
    order: [['finishedAt', 'DESC']],
    attributes: [
      'id',
      'startedAt',
      'finishedAt',
      'durationMs',
      'status',
      'parkSnapshotsWritten',
      'rideSnapshotsWritten',
      'labelsWritten',
      'featureStoreError',
      'scoringError',
    ],
  });
  const smoke = readOptionalSmokeStatus();
  const ps = getPlatformSettingsService();
  const eff = await ps.getEffectiveForPipelineHealth();
  const ai = eff.aiSampling;
  const wx = eff.weatherOpenMeteo;
  const ad = eff.adapters;
  const lastRun = serializePipelineRunRow(last);
  res.json({
    success: true,
    data: {
      lastRun,
      schedulerEnabled: ai.enabled.value,
      intervalSeconds: ai.intervalSeconds.value,
      aiSampling: {
        enabled: ai.enabled.value,
        intervalSeconds: ai.intervalSeconds.value,
        enabledSource: ai.enabled.source,
        intervalSecondsSource: ai.intervalSeconds.source,
      },
      weatherOpenMeteo: getWeatherOpenMeteoSchedulerHealth(),
      weatherOpenMeteoConfig: {
        enabled: wx.enabled.value,
        intervalSeconds: wx.intervalSeconds.value,
        rebuildSnapshots: wx.rebuildSnapshots.value,
        enabledSource: wx.enabled.source,
        intervalSecondsSource: wx.intervalSeconds.source,
        rebuildSnapshotsSource: wx.rebuildSnapshots.source,
      },
      externalParkData: {
        enabled: ad.externalParkDataEnabled.value,
        pollIntervalSeconds: ad.externalPollIntervalSeconds.value,
        enabledSource: ad.externalParkDataEnabled.source,
        pollIntervalSecondsSource: ad.externalPollIntervalSeconds.source,
      },
      adapterScheduler: {
        enabled: ad.schedulerEnabled.value,
        enabledSource: ad.schedulerEnabled.source,
      },
      ...smoke,
    },
  });
});

const listPipelineRuns = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const limit = Number(q.limit) || 25;
  const where = {};
  if (req.parkContext?.id) where.parkId = req.parkContext.id;
  const rows = await AiPipelineRun.findAll({
    where,
    order: [['startedAt', 'DESC']],
    limit,
    attributes: [
      'id',
      'startedAt',
      'finishedAt',
      'durationMs',
      'status',
      'parkSnapshotsWritten',
      'rideSnapshotsWritten',
      'labelsWritten',
      'featureStoreError',
      'scoringError',
    ],
  });
  const data = rows.map((r) => serializePipelineRunRow(r));
  res.json({ success: true, data });
});

const listForecasts = asyncHandler(async (req, res) => {
  const v = req.validated || req.query;
  const scope = await insightsScopeFromRequest(req);
  const rows = await forecastService.getForecasts({
    horizonMinutes: v.horizonMinutes,
    subjectType: v.subjectType,
    targetMetric: v.targetMetric,
    limit: v.limit,
    zoneIds: scope.zoneIds,
  });
  const zoneIds = new Set();
  for (const f of rows) {
    if (f.subjectType === 'ZONE' && f.subjectId) zoneIds.add(f.subjectId);
  }
  const zoneList = zoneIds.size ? await zoneRepository.findByIds([...zoneIds]) : [];
  const zoneNameById = new Map(zoneList.map((z) => [z.id, z.name]));
  const data = rows.map((f) => {
    const s = serializeForecast(f);
    if (s.subjectType === 'ZONE' && s.subjectId) {
      s.zoneName = zoneNameById.get(s.subjectId) || null;
    }
    return s;
  });
  res.json({ success: true, data });
});

const refreshForecasts = asyncHandler(async (req, res) => {
  const parkId = req.parkContext?.id || null;
  const out = await orchestrator.runFullPipeline({ parkId });
  res.json({ success: true, data: out });
});

const insightsSummary = asyncHandler(async (req, res) => {
  const scope = await insightsScopeFromRequest(req);
  const data = await forecastService.getInsightsSummary(scope);
  res.json({ success: true, data });
});

const postScoreAllRecommendations = asyncHandler(async (req, res) => {
  const parkId = req.parkContext?.id || null;
  const out = await scoringService.scoreAllOpen({ emitSocket: true, parkId });
  await auditLogService.log({
    action: AUDIT.RECOMMENDATION_AI_SCORE,
    entityType: 'recommendation',
    entityId: null,
    oldValue: null,
    newValue: { scope: 'all_open', scored: out.scored },
  });
  res.json({ success: true, data: out });
});

const postScoreOneRecommendation = asyncHandler(async (req, res) => {
  const { id } = req.validated || req.params;
  const out = await scoringService.scoreRecommendationById(id, { emitSocket: true });
  await auditLogService.log({
    action: AUDIT.RECOMMENDATION_AI_SCORE,
    entityType: 'recommendation',
    entityId: id,
    oldValue: null,
    newValue: jsonSnapshot({ score: out.score?.toJSON?.() || out.score }),
  });
  res.json({ success: true, data: out });
});

const listScoredRecommendations = asyncHandler(async (req, res) => {
  const parkId = req.parkContext?.id || null;
  const rows = await recommendationRepository.findAllOpen({
    limit: 300,
    ...(parkId ? { parkId } : {}),
  });
  const sorted = [...rows].sort((a, b) => {
    const sa = a.score ? num(a.score.score) : -1;
    const sb = b.score ? num(b.score.score) : -1;
    return sb - sa;
  });
  const data = sorted.map((r) => (r.toJSON ? r.toJSON() : r));
  res.json({ success: true, data });
});

const getRecommendationExplanation = asyncHandler(async (req, res) => {
  const { id } = req.validated || req.params;
  const rec = await recommendationRepository.findById(id);
  if (!rec) throw new AppError('Recommendation not found', 404, { code: 'NOT_FOUND' });
  if (!rec.score) throw new AppError('Recommendation has not been scored yet', 404, { code: 'NOT_FOUND' });
  res.json({
    success: true,
    data: {
      recommendationId: rec.id,
      explanation: rec.score.explanation,
      factors: rec.score.factors,
      score: num(rec.score.score),
      urgency: rec.score.urgency,
      impact: rec.score.impact,
      confidence: num(rec.score.confidence),
      expectedBenefit: rec.score.expectedBenefit,
    },
  });
});

const recommendationScoringSummary = asyncHandler(async (req, res) => {
  const parkId = req.parkContext?.id || null;
  const rows = await recommendationRepository.findAllOpen({
    limit: 300,
    ...(parkId ? { parkId } : {}),
  });
  const withScore = rows.filter((r) => r.score);
  withScore.sort((a, b) => num(b.score.score) - num(a.score.score));
  const topRisky = withScore.slice(0, 5).map((r) => {
    const j = r.toJSON ? r.toJSON() : r;
    return {
      recommendation: j,
      score: j.score,
    };
  });
  const criticalCount = withScore.filter((r) => r.score.urgency === 'CRITICAL').length;
  const confs = withScore.map((r) => num(r.score.confidence));
  const averageConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  res.json({
    success: true,
    data: {
      topRiskyRecommendations: topRisky,
      criticalRecommendationsCount: criticalCount,
      averageConfidence,
      generatedAt: new Date().toISOString(),
    },
  });
});

/** `data` includes `mlFactorCurrents` (object, possibly empty) from mergeMlEnterpriseLayer — see OpenAPI ParkForecastSummary. */
const parkForecastSummary = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  await assertExternalParkMatchesContext(req, req.params.externalParkId, q.provider);
  const data = await parkForecastService.getSummary(req.params.externalParkId, { provider: q.provider });
  res.json({ success: true, data });
});

const parkForecastSeries = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  await assertExternalParkMatchesContext(req, req.params.externalParkId, q.provider);
  const points = await parkForecastService.getSeries(req.params.externalParkId, {
    provider: q.provider,
    horizon: q.horizon ? Number(q.horizon) : 60,
    step: q.step ? Number(q.step) : 5,
  });
  res.json({ success: true, data: points });
});

const parkForecastExplanation = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  await assertExternalParkMatchesContext(req, req.params.externalParkId, q.provider);
  const data = await parkForecastService.getExplanation(req.params.externalParkId, {
    provider: q.provider,
    horizon: q.horizon ? Number(q.horizon) : 60,
  });
  res.json({ success: true, data });
});

const entityForecastExplanation = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const extPark = q.externalParkId;
  if (extPark) await assertExternalParkMatchesContext(req, extPark, q.provider);
  await assertEntityBelongsToPark(req, req.params.externalEntityId, extPark);
  const data = await parkForecastService.getEntityExplanation(req.params.externalEntityId, {
    provider: q.provider,
    externalParkId: q.externalParkId,
    entityType: q.entityType,
    horizon: q.horizon ? Number(q.horizon) : 60,
  });
  res.json({ success: true, data });
});

/** `data` includes `mlFactorCurrents` when ML merge ran (same shape as park summary). */
const entityForecastSummary = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const extPark = q.externalParkId;
  if (extPark) await assertExternalParkMatchesContext(req, extPark, q.provider);
  await assertEntityBelongsToPark(req, req.params.externalEntityId, extPark);
  const data = await parkForecastService.getEntitySummary(req.params.externalEntityId, {
    provider: q.provider,
    externalParkId: q.externalParkId,
    entityType: q.entityType,
  });
  res.json({ success: true, data });
});

/** Each array element includes `mlFactorCurrents` when merge ran for that entity. */
const parkEntityForecastSummaries = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  await assertExternalParkMatchesContext(req, req.params.externalParkId, q.provider);
  const data = await parkForecastService.getEntitySummariesForPark(req.params.externalParkId, {
    provider: q.provider,
    limit: q.limit ? Number(q.limit) : 150,
  });
  res.json({ success: true, data });
});

const zoneCrowdForecastAccuracy = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const data = await forecastAccuracyService.getZoneCrowdForecastAccuracy({
    days: q.days,
    horizonMinutes: q.horizonMinutes,
    limitForecasts: q.limitForecasts,
  });
  res.json({ success: true, data });
});

const getFactorConfigs = asyncHandler(async (_req, res) => {
  const data = await parkForecastService.getFactorConfigs();
  res.json({ success: true, data });
});

const rideCurrentWaits = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const data = await timeseriesService.getCurrentRideWaitsForPark({
    parkId: req.parkContext.id,
    hours: q.hours ? Number(q.hours) : 24,
  });
  res.json({ success: true, data });
});

function coerceQueryInstant(label, value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return parseRequiredUtcOrOffsetInstant(label, value);
}

const rideWaitTimeseries = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const from = coerceQueryInstant('from', q.from);
  const to = coerceQueryInstant('to', q.to);
  if (from.getTime() >= to.getTime()) {
    throw new AppError('"from" must be before "to"', 400, { code: 'INVALID_RANGE' });
  }
  const maxMs = 35 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) {
    throw new AppError('Range too large (max 35 days)', 400, { code: 'INVALID_RANGE' });
  }
  const data = await timeseriesService.getRideWaitTimeseries({
    parkId,
    assetId: q.assetId,
    from,
    to,
    includeContext: q.includeContext !== false,
  });
  res.json({ success: true, data });
});

const upsertParkCalendarContext = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  const row = await timeseriesService.upsertParkCalendarRow({
    parkId,
    contextDate: body.contextDate,
    patch: {
      isPublicHoliday: body.isPublicHoliday,
      isSchoolBreak: body.isSchoolBreak,
      holidayName: body.holidayName,
      regionCode: body.regionCode,
      source: body.source,
      extra: body.extra,
    },
  });
  res.json({ success: true, data: row.get({ plain: true }) });
});

const trainingDataset = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const parkId = req.parkContext.id;
  const data = await buildRideQueueTrainingDataset(parkId, {
    target: q.target,
    limit: q.limit,
  });
  res.json({ success: true, data });
});

module.exports = {
  getHealth,
  getPipelineHealth,
  listPipelineRuns,
  listForecasts,
  refreshForecasts,
  insightsSummary,
  postScoreAllRecommendations,
  postScoreOneRecommendation,
  listScoredRecommendations,
  getRecommendationExplanation,
  recommendationScoringSummary,
  parkForecastSummary,
  parkForecastSeries,
  parkForecastExplanation,
  entityForecastExplanation,
  entityForecastSummary,
  parkEntityForecastSummaries,
  getFactorConfigs,
  zoneCrowdForecastAccuracy,
  rideCurrentWaits,
  rideWaitTimeseries,
  upsertParkCalendarContext,
  trainingDataset,
};
