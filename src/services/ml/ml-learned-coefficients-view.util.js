'use strict';

/**
 * Phase 5 — read-only projection of ridge modelPayload (ml_model_registry) for Feature Monitor UI.
 * Does not affect training or inference.
 */

const EPS = 1e-9;

/**
 * @param {string|null|undefined} modelName
 * @returns {boolean}
 */
function isMlRegistryModelName(modelName) {
  const s = String(modelName || '').trim();
  if (!s) return false;
  return (
    s !== 'baseline_forecast' &&
    s !== 'no_governed_snapshot' &&
    s !== 'ride_wait_forecast' &&
    s !== 'closed_period_forecast'
  );
}

/**
 * Prefer the 60m horizon ML model id from results; else trace.modelVersion; else highest-horizon ML result.
 * @param {{ modelVersion?: string|null }|null} trace
 * @param {Array<{ horizonMinutes?: number|null, modelName?: string|null }>} results
 * @returns {string|null}
 */
function pickRegistryModelIdFromTrace(trace, results) {
  const arr = Array.isArray(results) ? results : [];
  const r60 = arr.find((r) => Number(r.horizonMinutes) === 60 && isMlRegistryModelName(r.modelName));
  if (r60) return String(r60.modelName);
  if (trace && isMlRegistryModelName(trace.modelVersion)) return String(trace.modelVersion);
  const sorted = arr
    .filter((r) => isMlRegistryModelName(r.modelName))
    .sort((a, b) => Number(b.horizonMinutes || 0) - Number(a.horizonMinutes || 0));
  if (sorted.length) return String(sorted[0].modelName);
  return null;
}

/**
 * @param {object} modelPayload
 * @param {string} modelId
 * @param {object} registryRow - plain row (horizonMinutes, modelType, scopeType, scopeId)
 * @returns {{ modelId: string, kind: string, horizonMinutes: number|null, modelType: string|null, scopeType: string|null, scopeId: string|null, intercept: number|null, rows: Array<{ feature: string, coefficient: number, direction: 'positive'|'negative'|'neutral', absImpactRank: number }> }|null}
 */
function buildLearnedCoefficientsView(modelPayload, modelId, registryRow) {
  if (!modelPayload || typeof modelPayload !== 'object') return null;
  if (modelPayload.kind !== 'ridge_v1') return null;
  const names = modelPayload.featureNames;
  const w = modelPayload.weights;
  if (!Array.isArray(names) || !Array.isArray(w) || names.length + 1 !== w.length) return null;

  /** @type {Array<{ feature: string, coefficient: number, abs: number }>} */
  const tmp = [];
  for (let i = 0; i < names.length; i++) {
    const feature = String(names[i]);
    const coefficient = Number(w[i + 1]);
    if (!Number.isFinite(coefficient)) continue;
    tmp.push({ feature, coefficient, abs: Math.abs(coefficient) });
  }
  if (!tmp.length) return null;

  tmp.sort((a, b) => b.abs - a.abs);
  const rows = tmp.map((r, idx) => {
    let direction = 'neutral';
    if (r.coefficient > EPS) direction = 'positive';
    else if (r.coefficient < -EPS) direction = 'negative';
    return {
      feature: r.feature,
      coefficient: r.coefficient,
      direction,
      absImpactRank: idx + 1,
    };
  });

  const b0 = Number(w[0]);
  return {
    modelId,
    kind: 'ridge_v1',
    horizonMinutes: registryRow && registryRow.horizonMinutes != null ? Number(registryRow.horizonMinutes) : null,
    modelType: registryRow?.modelType != null ? String(registryRow.modelType) : null,
    scopeType: registryRow?.scopeType != null ? String(registryRow.scopeType) : null,
    scopeId: registryRow?.scopeId != null ? String(registryRow.scopeId) : null,
    intercept: Number.isFinite(b0) ? b0 : null,
    rows,
  };
}

module.exports = {
  pickRegistryModelIdFromTrace,
  buildLearnedCoefficientsView,
  isMlRegistryModelName,
};
