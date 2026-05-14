'use strict';

/**
 * Phase 4 — manual business weights for ride-wait training features.
 * Keys must match `TRAINING_FEATURE_NAMES`; defaults 1.0; ride overrides park.
 */

const { TRAINING_FEATURE_NAMES } = require('./ride-feature-vector.util');

const ALLOWED_FEATURE_KEYS = new Set(TRAINING_FEATURE_NAMES);

/** Prefer ≤ 5; values above require explicit documentation — enforced at API boundary (max 5). */
const MAX_MANUAL_FEATURE_WEIGHT = 5;

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * Validates and returns a clean weight map (only known keys, finite numbers).
 * @param {unknown} weightsJson
 * @param {{ maxWeight?: number }} [opts]
 * @returns {Record<string, number>}
 */
function normalizeFeatureWeights(weightsJson, opts = {}) {
  const maxW = opts.maxWeight != null ? opts.maxWeight : MAX_MANUAL_FEATURE_WEIGHT;
  if (weightsJson == null) return {};
  if (typeof weightsJson !== 'object' || Array.isArray(weightsJson)) {
    const err = new Error('featureWeightsJson must be a JSON object');
    err.statusCode = 400;
    err.code = 'INVALID_FEATURE_WEIGHTS';
    throw err;
  }
  const out = {};
  for (const key of Object.keys(weightsJson)) {
    if (!ALLOWED_FEATURE_KEYS.has(key)) {
      const err = new Error(`Unknown feature weight key "${key}" (must be a TRAINING_FEATURE_NAMES entry)`);
      err.statusCode = 400;
      err.code = 'UNKNOWN_FEATURE_WEIGHT_KEY';
      throw err;
    }
    const w = Number(weightsJson[key]);
    if (!Number.isFinite(w)) {
      const err = new Error(`Weight for "${key}" must be a finite number`);
      err.statusCode = 400;
      err.code = 'INVALID_FEATURE_WEIGHT_VALUE';
      throw err;
    }
    if (w < 0) {
      const err = new Error(`Weight for "${key}" must be >= 0`);
      err.statusCode = 400;
      err.code = 'INVALID_FEATURE_WEIGHT_VALUE';
      throw err;
    }
    if (w > maxW) {
      const err = new Error(`Weight for "${key}" must be <= ${maxW}`);
      err.statusCode = 400;
      err.code = 'FEATURE_WEIGHT_ABOVE_MAX';
      throw err;
    }
    out[key] = w;
  }
  return out;
}

/**
 * Start at 1.0 for all training features, apply park, then ride (ride wins).
 * @param {Record<string, number>} parkWeights - normalized subset
 * @param {Record<string, number>} rideWeights - normalized subset
 * @returns {{ merged: Record<string, number>, sources: Record<string, 'default'|'park_profile'|'ride_profile'> }}
 */
function mergeParkAndRideWeights(parkWeights, rideWeights) {
  const merged = {};
  const sources = {};
  for (const name of TRAINING_FEATURE_NAMES) {
    merged[name] = 1;
    sources[name] = 'default';
  }
  const p = parkWeights || {};
  for (const name of Object.keys(p)) {
    if (!ALLOWED_FEATURE_KEYS.has(name)) continue;
    merged[name] = p[name];
    sources[name] = 'park_profile';
  }
  const r = rideWeights || {};
  for (const name of Object.keys(r)) {
    if (!ALLOWED_FEATURE_KEYS.has(name)) continue;
    merged[name] = r[name];
    sources[name] = 'ride_profile';
  }
  return { merged, sources };
}

/**
 * Per-feature explainability row for traces / UI.
 * @param {Record<string, unknown>} featureMap - masked feature map (same as forecast X semantics)
 * @param {Record<string, number>} mergedWeights - full vector of weights after merge
 * @param {Record<string, 'default'|'park_profile'|'ride_profile'>} weightSources
 * @param {Record<string, string>} [featureStatusJson] - optional Phase-1 status per key
 */
function buildWeightedFeatureVector(featureMap, mergedWeights, weightSources, featureStatusJson) {
  const map = featureMap && typeof featureMap === 'object' ? featureMap : {};
  const st = featureStatusJson && typeof featureStatusJson === 'object' ? featureStatusJson : {};
  /** @type {Record<string, object>} */
  const out = {};
  for (const name of TRAINING_FEATURE_NAMES) {
    const raw = map[name];
    const normalizedValue = n(raw, 0);
    const weight = mergedWeights[name] != null ? mergedWeights[name] : 1;
    const weightedValue = normalizedValue * weight;
    const statusLabel = st[name];
    let status = 'ok';
    if (statusLabel === 'missing') {
      status = 'missing';
    } else if (statusLabel === 'masked') {
      status = 'ok';
    } else if ((weightSources[name] || 'default') === 'default') {
      status = 'default_weight';
    } else {
      status = 'ok';
    }
    out[name] = {
      rawValue: raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw),
      normalizedValue,
      weight,
      weightedValue,
      source: weightSources[name] || 'default',
      status,
    };
  }
  return out;
}

module.exports = {
  TRAINING_FEATURE_NAMES,
  ALLOWED_FEATURE_KEYS,
  MAX_MANUAL_FEATURE_WEIGHT,
  normalizeFeatureWeights,
  mergeParkAndRideWeights,
  buildWeightedFeatureVector,
};
