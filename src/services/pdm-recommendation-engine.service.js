'use strict';

const PRIORITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * @param {Record<string, unknown>} health
 * @param {Array<Record<string, unknown>>} failureModes
 * @param {Array<Record<string, unknown>>} metricTrends
 * @param {Array<Record<string, unknown>>} signals
 */
function buildPdMaintenanceRecommendations(health, failureModes, metricTrends, signals) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];
  const state = String(health?.healthState || 'OK');
  const trend = String(health?.healthTrend || 'STABLE');

  if (state === 'CRITICAL' || state === 'WARNING') {
    out.push({
      action: 'Schedule on-site mechanical / electrical inspection',
      priority: state === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      reason: `Composite health state is ${state} with score ${health?.healthScore}.`,
      recommendedWithinHours: state === 'CRITICAL' ? 4 : 24,
    });
  }

  for (const fm of Array.isArray(failureModes) ? failureModes.slice(0, 3) : []) {
    const sev = String(fm.severity || 'MEDIUM').toUpperCase();
    const pr = sev === 'HIGH' ? 'HIGH' : 'MEDIUM';
    const actions = Array.isArray(fm.recommendedActions) ? fm.recommendedActions : [];
    out.push({
      action: actions[0] != null ? String(actions[0]) : `Investigate ${String(fm.label || fm.code)}`,
      priority: pr,
      reason: String(fm.explanation || fm.label || ''),
      recommendedWithinHours: pr === 'HIGH' ? 12 : 72,
      failureModeCode: fm.code,
    });
  }

  const declining = (Array.isArray(metricTrends) ? metricTrends : []).filter((t) => String(t.trend) === 'DECLINING');
  if (declining.length && trend === 'DECLINING') {
    out.push({
      action: 'Trend follow-up — confirm against historian',
      priority: 'MEDIUM',
      reason: `Metrics ${declining.map((d) => d.metricName).join(', ')} show declining stability in the evaluation window.`,
      recommendedWithinHours: 48,
    });
  }

  const critSignals = (Array.isArray(signals) ? signals : []).filter((s) => s.status === 'CRITICAL');
  for (const s of critSignals.slice(0, 2)) {
    out.push({
      action: `Containment review: ${String(s.label || s.metricName)}`,
      priority: 'CRITICAL',
      reason: 'Rule threshold indicates CRITICAL band.',
      recommendedWithinHours: 6,
      metricName: s.metricName,
    });
  }

  out.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0));

  /** @type {Map<string, boolean>} */
  const seen = new Map();
  return out.filter((r) => {
    const k = `${r.action}|${r.reason}`;
    if (seen.has(k)) return false;
    seen.set(k, true);
    return true;
  });
}

module.exports = {
  buildPdMaintenanceRecommendations,
};
