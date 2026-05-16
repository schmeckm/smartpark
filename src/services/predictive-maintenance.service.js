/**
 * Predictive maintenance — Phase 0 (signal baseline per asset) + Phase 1 (rule thresholds on Sparkplug DDATA).
 */
'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const env = require('../config/env');
const { AppError } = require('../utils/app-error');
const { findLatestSparkplugLiveMetricRow } = require('./mqtt-sparkplug-live-buffer.service');
const { pdmSimNumericAt, isPdSimMetricName } = require('./pdm-sparkplug-simulator.service');
const { sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
const { ParkAsset, ParkAssetPdmRule, Park, ParkAssetPdmEvaluationLog } = require('../models');
const { sparkplugGroupIdForParkSlug } = require('./pdm-sparkplug-group-id.service');
const {
  listKnownLiveSparkplugMetricsForAsset,
  listPdSparkplugMetricSeriesForAsset,
} = require('./pdm-sparkplug-asset-live.service');
const pdmSparkplugEdgeResolve = require('./pdm-sparkplug-edge-resolve.service');
const { resolvePdmSparkplugEdgeCandidatesForAsset } = pdmSparkplugEdgeResolve;
const { enrichIndustrialPdmEvaluation } = require('./pdm-evaluation-industrial.service');
const { confidenceLabelToNumeric } = require('./pdm-ml-foundation.service');
const { writeMlMetricPoint } = require('./influx-ot-metrics.service');

function trimEdgeId(v) {
  return v == null ? '' : String(v).trim();
}

/** Allowed origins for persisted evaluation snapshots (stored verbatim in `source`). */
const PDM_EVAL_SOURCES = Object.freeze(['pdm_api', 'addon_board']);

/**
 * Stable fingerprint from rule outcomes only (metric + status), so steady-state polls do not spam the log.
 * @param {Record<string, unknown>|null|undefined} evaluation
 */
function pdmEvaluationFingerprint(evaluation) {
  const signals = Array.isArray(evaluation?.signals) ? evaluation.signals : [];
  const parts = signals.map((s) => `${String(s.metricName || '')}:${String(s.status || '')}`);
  parts.sort();
  const raw = `${String(evaluation?.riskLevel || '')}|${parts.join('|')}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Resolve latest numeric Sparkplug metric for a park asset (multi-edge probe order from Sparkplug Edge UI profile).
 * @param {Record<string, unknown>} assetPlain must include assetId; parkId strongly recommended
 * @param {string} parkSlug
 * @param {string} metricName
 * @returns {Promise<{ value: number|null; deviceId: string|null; receivedAt: string|null; resolvedEdgeNodeId?: string|null; telemetrySource: 'live'|'simulated'|'none' }>}
 */
async function resolveSparkplugMetricForAsset(assetPlain, parkSlug, metricName) {
  const groupId = sparkplugGroupIdForParkSlug(parkSlug);
  const slug = assetPlain.slug != null ? String(assetPlain.slug) : '';
  const name = assetPlain.name != null ? String(assetPlain.name) : '';
  const aid = assetPlain.assetId != null ? String(assetPlain.assetId) : '';
  const parkId = assetPlain.parkId != null ? String(assetPlain.parkId).trim() : '';

  const deviceCandidates = [
    sparkplugDeviceTopicSegment(slug),
    sparkplugDeviceTopicSegment(name),
    sparkplugDeviceTopicSegment(aid),
  ].filter((x, i, a) => x && a.indexOf(x) === i);

  const m = String(metricName || '').trim();
  if (!m) {
    return { value: null, deviceId: null, receivedAt: null, resolvedEdgeNodeId: null, telemetrySource: 'none' };
  }

  /** @type {{ attemptedEdgeNodeIds: string[] }} */
  let edgeMeta = { attemptedEdgeNodeIds: [trimEdgeId(env.sparkplugEdgeNode) || 'park_gateway'] };
  if (parkId && aid) {
    edgeMeta = await resolvePdmSparkplugEdgeCandidatesForAsset(aid, parkId);
  }

  const edgeNodeIds = edgeMeta.attemptedEdgeNodeIds.length
    ? edgeMeta.attemptedEdgeNodeIds
    : [trimEdgeId(env.sparkplugEdgeNode) || 'park_gateway'];

  for (const edgeNodeId of edgeNodeIds) {
    const e = trimEdgeId(edgeNodeId);
    if (!e) continue;
    for (const deviceId of deviceCandidates) {
      const row = findLatestSparkplugLiveMetricRow({
        groupId,
        edgeNodeId: e,
        deviceId,
        metricName: m,
      });
      if (row?.value != null && Number.isFinite(Number(row.value))) {
        return {
          value: Number(row.value),
          deviceId,
          receivedAt: row.receivedAt != null ? String(row.receivedAt) : null,
          resolvedEdgeNodeId: e,
          telemetrySource: /** @type {const} */ ('live'),
        };
      }
    }
  }

  if (isPdSimMetricName(m)) {
    const now = Date.now();
    const dev = deviceCandidates[0] || aid || 'ride';
    const v = pdmSimNumericAt(aid, m, now);
    if (v != null && Number.isFinite(v)) {
      return {
        value: v,
        deviceId: dev,
        receivedAt: new Date(now).toISOString(),
        resolvedEdgeNodeId: edgeMeta.resolvedEdgeNodeId != null ? String(edgeMeta.resolvedEdgeNodeId) : null,
        telemetrySource: /** @type {const} */ ('simulated'),
      };
    }
  }
  return { value: null, deviceId: null, receivedAt: null, resolvedEdgeNodeId: null, telemetrySource: 'none' };
}

/**
 * @param {Record<string, unknown>} rulePlain
 * @param {number|null} value
 */
function signalStatusForRule(rulePlain, value) {
  if (value == null || !Number.isFinite(value)) {
    return { status: 'NO_DATA', rank: 2 };
  }
  const v = Number(value);
  const cAbove = rulePlain.criticalAbove;
  const cBelow = rulePlain.criticalBelow;
  const wAbove = rulePlain.warnAbove;
  const wBelow = rulePlain.warnBelow;
  if (cAbove != null && Number.isFinite(Number(cAbove)) && v >= Number(cAbove)) {
    return { status: 'CRITICAL', rank: 4 };
  }
  if (cBelow != null && Number.isFinite(Number(cBelow)) && v <= Number(cBelow)) {
    return { status: 'CRITICAL', rank: 4 };
  }
  if (wAbove != null && Number.isFinite(Number(wAbove)) && v >= Number(wAbove)) {
    return { status: 'WARN', rank: 3 };
  }
  if (wBelow != null && Number.isFinite(Number(wBelow)) && v <= Number(wBelow)) {
    return { status: 'WARN', rank: 3 };
  }
  return { status: 'OK', rank: 0 };
}

/**
 * Stream computed PdM / ML outputs to Influx (`ml_metric`) when enabled.
 * @param {string} assetId
 * @param {Record<string, unknown>} evaluation
 */
function streamPdmMlMetricsToInflux(assetId, evaluation) {
  const aid = assetId != null ? String(assetId).trim() : '';
  if (!aid || !evaluation || typeof evaluation !== 'object') return;

  const ind = evaluation.industrial;
  if (!ind || typeof ind !== 'object') return;

  const health = /** @type {Record<string, unknown>|undefined} */ (ind.health);
  const conf =
    health && health.confidence != null ? confidenceLabelToNumeric(String(health.confidence)) : null;

  if (health && typeof health.healthScore === 'number' && Number.isFinite(health.healthScore)) {
    writeMlMetricPoint(aid, 'predictive_health_score', health.healthScore, conf);
  }

  const ml = /** @type {Record<string, unknown>|undefined} */ (ind.mlReadiness);
  if (ml && typeof ml.anomalyScore === 'number' && Number.isFinite(ml.anomalyScore)) {
    writeMlMetricPoint(aid, 'predictive_anomaly_score', ml.anomalyScore, conf);
  }
  if (ml && typeof ml.rulDays === 'number' && Number.isFinite(ml.rulDays)) {
    writeMlMetricPoint(aid, 'predictive_rul_days', ml.rulDays, conf);
  }

  const modes = Array.isArray(ind.failureModes) ? ind.failureModes : [];
  const top = modes[0];
  if (top && typeof top.score === 'number' && Number.isFinite(top.score)) {
    writeMlMetricPoint(aid, 'predictive_failure_mode_score', top.score, conf);
  }
}

function recommendationFromSignals(signals, riskLevel) {
  const crit = signals.filter((s) => s.status === 'CRITICAL');
  const warn = signals.filter((s) => s.status === 'WARN');
  const nodata = signals.filter((s) => s.status === 'NO_DATA');
  if (crit.length) {
    return {
      title: 'Immediate technical review suggested',
      detail: `Critical thresholds: ${crit.map((s) => s.label || s.metricName).join(', ')}`,
    };
  }
  if (warn.length) {
    return {
      title: 'Schedule inspection or monitoring',
      detail: `Warning thresholds: ${warn.map((s) => s.label || s.metricName).join(', ')}`,
    };
  }
  if (nodata.length && riskLevel === 'MEDIUM') {
    return {
      title: 'Check telemetry coverage',
      detail: 'Some configured metrics have no live Sparkplug value for this asset device mapping.',
    };
  }
  return {
    title: 'Within configured limits',
    detail: 'All enabled predictive-maintenance rules are within thresholds.',
  };
}

/**
 * @param {Record<string, unknown>} assetPlain - park_assets plain row (slug, name, assetId, parkId)
 * @param {string} parkSlug
 * @param {Array<Record<string, unknown>>} enabledRulesPlain
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function evaluatePredictiveMaintenanceForAsset(assetPlain, parkSlug, enabledRulesPlain) {
  const rules = Array.isArray(enabledRulesPlain) ? enabledRulesPlain.filter((r) => r && r.enabled !== false) : [];
  if (!rules.length) return null;

  /** @type {Array<Record<string, unknown>>} */
  const signals = [];
  let maxRank = 0;
  for (const r of rules) {
    const metricName = String(r.metricName || '').trim();
    const live = await resolveSparkplugMetricForAsset(assetPlain, parkSlug, metricName);
    const sev = signalStatusForRule(r, live.value);
    maxRank = Math.max(maxRank, sev.rank);
    signals.push({
      ruleId: r.id,
      metricName,
      label: r.label != null ? String(r.label) : null,
      unit: r.unit != null ? String(r.unit) : null,
      value: live.value,
      liveReceivedAt: live.receivedAt,
      sparkplugDeviceId: live.deviceId,
      sparkplugEdgeNodeId: live.resolvedEdgeNodeId != null ? String(live.resolvedEdgeNodeId) : null,
      telemetrySource: live.telemetrySource != null ? String(live.telemetrySource) : 'none',
      trendArrow: '→',
      status: sev.status,
      thresholds: {
        warnAbove: r.warnAbove,
        criticalAbove: r.criticalAbove,
        warnBelow: r.warnBelow,
        criticalBelow: r.criticalBelow,
      },
    });
  }

  let riskLevel = 'LOW';
  if (maxRank >= 4) riskLevel = 'CRITICAL';
  else if (maxRank >= 3) riskLevel = 'HIGH';
  else if (maxRank >= 2) riskLevel = 'MEDIUM';

  const rec = recommendationFromSignals(signals, riskLevel);
  const parkId = assetPlain.parkId != null ? String(assetPlain.parkId).trim() : '';
  /** @type {Record<string, unknown>} */
  const evaluation = {
    riskLevel,
    recommendation: rec,
    evaluatedAt: new Date().toISOString(),
    enabledRuleCount: rules.length,
    signals,
  };

  const industrial = await enrichIndustrialPdmEvaluation({
    baseEvaluation: evaluation,
    assetPlain,
    parkSlug,
    parkId,
  });
  if (industrial && typeof industrial === 'object') {
    evaluation.industrial = industrial;
    const trendByMetric = new Map(
      (Array.isArray(industrial.metricTrends) ? industrial.metricTrends : []).map((t) => [String(t.metricName || ''), t])
    );
    evaluation.signals = signals.map((s) => {
      const tr = trendByMetric.get(String(s.metricName || ''));
      const trend = tr && typeof tr === 'object' ? String(tr.trend || '') : '';
      let trendArrow = '→';
      if (trend === 'IMPROVING') trendArrow = '↑';
      else if (trend === 'DECLINING') trendArrow = '↓';
      else if (trend === 'UNSTABLE') trendArrow = '⟳';
      return { ...s, trendArrow, metricTrend: trend || null };
    });
    streamPdmMlMetricsToInflux(assetPlain.assetId != null ? String(assetPlain.assetId) : '', evaluation);
  }

  return evaluation;
}

async function assertAssetInPark(assetId, parkId) {
  const row = await ParkAsset.findOne({
    where: { assetId, parkId },
    attributes: ['assetId', 'parkId'],
  });
  if (!row) {
    throw new AppError('Asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
}

function serializeRule(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    assetId: p.assetId,
    parkId: p.parkId,
    label: p.label,
    metricName: p.metricName,
    warnAbove: p.warnAbove,
    criticalAbove: p.criticalAbove,
    warnBelow: p.warnBelow,
    criticalBelow: p.criticalBelow,
    unit: p.unit,
    enabled: p.enabled,
    sortOrder: p.sortOrder,
    notes: p.notes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function listRules(assetId, parkId) {
  await assertAssetInPark(assetId, parkId);
  const rows = await ParkAssetPdmRule.findAll({
    where: { assetId, parkId },
    order: [
      ['sortOrder', 'ASC'],
      ['metricName', 'ASC'],
    ],
  });
  return rows.map(serializeRule);
}

async function createRule(assetId, parkId, body) {
  await assertAssetInPark(assetId, parkId);
  try {
    const row = await ParkAssetPdmRule.create({
      assetId,
      parkId,
      metricName: String(body.metricName || '').trim(),
      label: body.label != null && String(body.label).trim() ? String(body.label).trim() : null,
      warnAbove: body.warnAbove,
      criticalAbove: body.criticalAbove,
      warnBelow: body.warnBelow,
      criticalBelow: body.criticalBelow,
      unit: body.unit != null && String(body.unit).trim() ? String(body.unit).trim() : null,
      notes: body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null,
      enabled: body.enabled !== false,
      sortOrder: body.sortOrder != null ? Number(body.sortOrder) : 0,
    });
    return serializeRule(row);
  } catch (e) {
    if (e && e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('A rule for this metric already exists on the asset', 409, {
        code: 'PDM_RULE_DUPLICATE_METRIC',
      });
    }
    throw e;
  }
}

async function patchRule(ruleId, assetId, parkId, body) {
  await assertAssetInPark(assetId, parkId);
  const row = await ParkAssetPdmRule.findOne({ where: { id: ruleId, assetId, parkId } });
  if (!row) {
    throw new AppError('PdM rule not found', 404, { code: 'PDM_RULE_NOT_FOUND' });
  }
  const patch = {};
  if (body.label !== undefined) patch.label = body.label != null && String(body.label).trim() ? String(body.label).trim() : null;
  if (body.metricName !== undefined) patch.metricName = String(body.metricName || '').trim();
  if (body.warnAbove !== undefined) patch.warnAbove = body.warnAbove;
  if (body.criticalAbove !== undefined) patch.criticalAbove = body.criticalAbove;
  if (body.warnBelow !== undefined) patch.warnBelow = body.warnBelow;
  if (body.criticalBelow !== undefined) patch.criticalBelow = body.criticalBelow;
  if (body.unit !== undefined) patch.unit = body.unit != null && String(body.unit).trim() ? String(body.unit).trim() : null;
  if (body.notes !== undefined) patch.notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder);
  try {
    await row.update(patch);
  } catch (e) {
    if (e && e.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('A rule for this metric already exists on the asset', 409, {
        code: 'PDM_RULE_DUPLICATE_METRIC',
      });
    }
    throw e;
  }
  return serializeRule(row);
}

async function deleteRule(ruleId, assetId, parkId) {
  await assertAssetInPark(assetId, parkId);
  const n = await ParkAssetPdmRule.destroy({ where: { id: ruleId, assetId, parkId } });
  if (!n) {
    throw new AppError('PdM rule not found', 404, { code: 'PDM_RULE_NOT_FOUND' });
  }
}

/**
 * Persist evaluation snapshot when risk/signal outcome changed vs last stored row.
 * @param {{ assetId: string; parkId: string; source: string; evaluation: Record<string, unknown> }} args
 */
async function maybeAppendPdmEvaluationLog(args) {
  const assetId = args?.assetId != null ? String(args.assetId) : '';
  const parkId = args?.parkId != null ? String(args.parkId) : '';
  const evaluation = args?.evaluation;
  if (!assetId || !parkId || !evaluation || typeof evaluation !== 'object') return;

  let source = String(args.source || '').slice(0, 32);
  if (!PDM_EVAL_SOURCES.includes(source)) source = 'other';

  const fp = pdmEvaluationFingerprint(evaluation);
  const last = await ParkAssetPdmEvaluationLog.findOne({
    where: { assetId, parkId },
    order: [['evaluatedAt', 'DESC']],
    attributes: ['fingerprint'],
  });
  if (last && last.fingerprint === fp) return;

  let evaluatedAt = evaluation.evaluatedAt ? new Date(String(evaluation.evaluatedAt)) : new Date();
  if (Number.isNaN(evaluatedAt.getTime())) evaluatedAt = new Date();

  await ParkAssetPdmEvaluationLog.create({
    assetId,
    parkId,
    source,
    evaluatedAt,
    riskLevel: String(evaluation.riskLevel || 'LOW').slice(0, 16),
    fingerprint: fp,
    snapshotJson: evaluation,
  });
}

function serializeEvaluationLog(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  const at = p.evaluatedAt;
  return {
    id: p.id,
    assetId: p.assetId,
    parkId: p.parkId,
    source: p.source,
    evaluatedAt: at instanceof Date ? at.toISOString() : at,
    riskLevel: p.riskLevel,
    fingerprint: p.fingerprint,
    snapshot: p.snapshotJson,
  };
}

/**
 * @param {string} assetId
 * @param {string} parkId
 * @param {{ limit?: number }} [opts]
 */
async function listPdmEvaluationLogs(assetId, parkId, opts = {}) {
  await assertAssetInPark(assetId, parkId);
  const lim = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const rows = await ParkAssetPdmEvaluationLog.findAll({
    where: { assetId, parkId },
    order: [['evaluatedAt', 'DESC']],
    limit: lim,
  });
  return rows.map(serializeEvaluationLog);
}

async function loadEnabledRulesByAssetIds(parkId, assetIds) {
  const ids = [...new Set(assetIds.map(String))].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await ParkAssetPdmRule.findAll({
    where: {
      parkId,
      assetId: { [Op.in]: ids },
      enabled: true,
    },
    order: [
      ['sortOrder', 'ASC'],
      ['metricName', 'ASC'],
    ],
  });
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const m = new Map();
  for (const row of rows) {
    const p = row.get({ plain: true });
    const aid = String(p.assetId);
    if (!m.has(aid)) m.set(aid, []);
    m.get(aid).push(p);
  }
  return m;
}

module.exports = {
  sparkplugGroupIdForParkSlug,
  resolveSparkplugMetricForAsset,
  evaluatePredictiveMaintenanceForAsset,
  streamPdmMlMetricsToInflux,
  signalStatusForRule,
  PDM_EVAL_SOURCES,
  pdmEvaluationFingerprint,
  maybeAppendPdmEvaluationLog,
  listPdmEvaluationLogs,
  listRules,
  createRule,
  patchRule,
  deleteRule,
  loadEnabledRulesByAssetIds,
  listKnownLiveSparkplugMetricsForAsset,
  listPdSparkplugMetricSeriesForAsset,
  /** @type {typeof import('./pdm-sparkplug-edge-resolve.service').resolvePdmSparkplugEdgeCandidatesForAsset} */
  resolvePdmSparkplugEdgeCandidatesForAsset: pdmSparkplugEdgeResolve.resolvePdmSparkplugEdgeCandidatesForAsset,
  /** @type {typeof import('./pdm-sparkplug-edge-resolve.service').buildPdmEdgeCandidateOrder} */
  buildPdmEdgeCandidateOrder: pdmSparkplugEdgeResolve.buildPdmEdgeCandidateOrder,
};
