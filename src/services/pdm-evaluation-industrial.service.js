'use strict';

const { getFlags } = require('../bootstrap/feature-flags');
const { listRecentSparkplugNumericSamples } = require('./mqtt-sparkplug-live-buffer.service');
const { buildSimulatedSparkplugSeries } = require('./pdm-sparkplug-simulator.service');
const { sparkplugGroupIdForParkSlug } = require('./pdm-sparkplug-group-id.service');
const { resolvePdmSparkplugEdgeCandidatesForAsset } = require('./pdm-sparkplug-edge-resolve.service');
const { loadParkDefaultScoringProfile, computePdHealthScore } = require('./pdm-health-score.service');
const { analyzeMetricTrendFromSamples } = require('./pdm-metric-trend.service');
const { classifyPdFailureModes } = require('./pdm-failure-mode.service');
const { parkTelemetryCoverageSummary } = require('./pdm-telemetry-quality.service');
const { getRideTelemetryProfileForAsset } = require('./pdm-ride-type-templates.service');
const { buildPdMaintenanceRecommendations } = require('./pdm-recommendation-engine.service');
const { buildPdmMlReadinessEnvelope } = require('./pdm-ml-foundation.service');
const { buildPdmSparkplugVisibility } = require('./pdm-sparkplug-visibility.service');

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Pull recent numeric samples for trend math (live edges first, then simulated series).
 * @param {object} p
 * @param {string} p.assetId
 * @param {string} p.parkId
 * @param {string} p.parkSlug
 * @param {string} p.metricName
 * @param {string|null} p.deviceId
 * @param {'live'|'simulated'|'none'} p.telemetrySource
 */
async function resolveTrendPointsForSignal(p) {
  const metricName = trim(p.metricName);
  const dev = p.deviceId != null ? trim(p.deviceId) : '';
  const groupId = sparkplugGroupIdForParkSlug(p.parkSlug);
  if (!metricName || !dev || !p.assetId || !p.parkId) {
    if (p.telemetrySource === 'simulated') {
      return buildSimulatedSparkplugSeries(p.assetId, metricName, { points: 36, stepSeconds: 120 });
    }
    return [];
  }

  const edgePack = await resolvePdmSparkplugEdgeCandidatesForAsset(p.assetId, p.parkId);
  const edges = edgePack.attemptedEdgeNodeIds.length ? edgePack.attemptedEdgeNodeIds : ['park_gateway'];

  if (p.telemetrySource === 'live') {
    for (const eid of edges) {
      const e = trim(eid);
      if (!e) continue;
      const live = listRecentSparkplugNumericSamples(
        { groupId, edgeNodeId: e, deviceId: dev, metricName },
        { limit: 48 }
      );
      if (live.length >= 6) return live;
    }
  }

  return buildSimulatedSparkplugSeries(p.assetId, metricName, { points: 36, stepSeconds: 300 });
}

/**
 * @param {object} ctx
 * @param {Record<string, unknown>} ctx.baseEvaluation
 * @param {Record<string, unknown>} ctx.assetPlain
 * @param {string} ctx.parkSlug
 * @param {string} ctx.parkId
 */
async function enrichIndustrialPdmEvaluation(ctx) {
  const flags = getFlags();
  if (!flags.pdm?.industrialPlatformEnabled) return null;

  const base = ctx.baseEvaluation;
  if (!base || typeof base !== 'object') return null;

  const assetPlain = ctx.assetPlain || {};
  const assetId = assetPlain.assetId != null ? String(assetPlain.assetId) : '';
  const parkId = String(ctx.parkId || assetPlain.parkId || '').trim();
  const parkSlug = String(ctx.parkSlug || '').trim();

  const signals = Array.isArray(base.signals) ? base.signals : [];

  /** @type {Array<Record<string, unknown>>} */
  const metricTrends = [];
  for (const s of signals) {
    const metricName = String(s.metricName || '');
    const points = await resolveTrendPointsForSignal({
      assetId,
      parkId,
      parkSlug,
      metricName,
      deviceId: s.sparkplugDeviceId != null ? String(s.sparkplugDeviceId) : null,
      telemetrySource: /** @type {'live'|'simulated'|'none'} */ (String(s.telemetrySource || 'none')),
    });
    metricTrends.push(analyzeMetricTrendFromSamples(metricName, points));
  }

  const profile = loadParkDefaultScoringProfile();
  const rideProfile = getRideTelemetryProfileForAsset(assetPlain);

  const health = computePdHealthScore(profile, assetPlain, signals, metricTrends);
  const failureModes = classifyPdFailureModes(signals, metricTrends);
  const telemetryQuality = parkTelemetryCoverageSummary(signals);
  const structuredRecommendations = buildPdMaintenanceRecommendations(
    health,
    failureModes,
    metricTrends,
    signals
  );
  const mlReadiness = buildPdmMlReadinessEnvelope({ base, signals, health, metricTrends });
  const sparkplugContext = await buildPdmSparkplugVisibility({
    parkSlug,
    assetId,
    parkId,
    assetPlain,
    signals,
  });

  return {
    platformVersion: 1,
    health: {
      healthScore: health.healthScore,
      healthState: health.healthState,
      healthTrend: health.healthTrend,
      confidence: health.confidence,
      deductions: health.deductions,
    },
    rideTelemetryProfile: rideProfile,
    metricTrends,
    failureModes,
    telemetryQuality,
    structuredRecommendations,
    mlReadiness,
    sparkplugContext,
  };
}

module.exports = {
  enrichIndustrialPdmEvaluation,
  resolveTrendPointsForSignal,
};
