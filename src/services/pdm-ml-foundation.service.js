'use strict';

/**
 * PdM ML readiness envelope — heuristic scores until external model I/O is wired.
 * Values are rule/trend-derived (not trained models) but stable for APIs and Influx streaming.
 */

/** @param {string|null|undefined} label */
function confidenceLabelToNumeric(label) {
  const m = { HIGH: 0.9, MEDIUM: 0.65, LOW: 0.35 };
  const v = m[String(label || '').toUpperCase()];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} health
 * @param {Array<Record<string, unknown>>} metricTrends
 * @returns {number|null}
 */
function computeHeuristicAnomalyScore(health, metricTrends) {
  if (!health || typeof health.healthScore !== 'number' || !Number.isFinite(health.healthScore)) {
    return null;
  }
  let score = Math.max(0, Math.min(1, (100 - health.healthScore) / 100));
  for (const t of Array.isArray(metricTrends) ? metricTrends : []) {
    if (String(t.trend || '') === 'UNSTABLE') score += 0.08;
    if (t.degradationTrend === true) score += 0.06;
  }
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

/**
 * @param {Record<string, unknown>|null|undefined} health
 * @returns {number|null}
 */
function computeHeuristicRulDays(health) {
  if (!health || typeof health.healthScore !== 'number' || !Number.isFinite(health.healthScore)) {
    return null;
  }
  const h = Math.max(0, Math.min(100, health.healthScore));
  const days = 7 + (h / 100) * 723;
  return Math.round(days * 10) / 10;
}

/**
 * @param {Record<string, unknown>} ctx
 */
function buildPdmMlReadinessEnvelope(ctx) {
  const health = ctx?.health;
  const metricTrends = Array.isArray(ctx?.metricTrends) ? ctx.metricTrends : [];
  const anomalyScore = computeHeuristicAnomalyScore(health, metricTrends);
  const rulDays = computeHeuristicRulDays(health);

  return {
    anomalyScore,
    rulDays,
    modelProvider: 'heuristic_rules_v1',
    predictionSource: anomalyScore != null ? 'heuristic_rules_v1' : 'rules',
    supportedModelFamilies: ['isolation_forest', 'xgboost_classifier', 'autoencoder', 'drift_detector'],
    notes:
      anomalyScore != null
        ? 'Anomaly and RUL are heuristic (health score + trend penalties) until external ML models are connected.'
        : 'ML scoring is not active. This envelope reserves fields for future isolation forest / gradient boosting / autoencoder integrations.',
  };
}

module.exports = {
  buildPdmMlReadinessEnvelope,
  confidenceLabelToNumeric,
  computeHeuristicAnomalyScore,
  computeHeuristicRulDays,
};
